import { homedir } from "node:os"
import { join } from "node:path"

const TASK_TABLE = "nifty-tasks"
const POLICY_TABLE = "nifty-policy"
const RAG_TABLES = [TASK_TABLE, POLICY_TABLE]
const DEFAULT_TASK_LIMIT = 5
const DEFAULT_POLICY_LIMIT = 3
const DEFAULT_TIMEOUT_MS = 2000
const DEFAULT_CACHE_TTL_MS = 300_000
const DEFAULT_MAX_QUERIES = 4
const DEFAULT_MAX_QUERY_CHARS = 700
const DEFAULT_MAX_RESULT_TEXT_CHARS = 1200
const DEFAULT_ENABLED = true
const MAX_COLLECTED_PARTS = 32
const tableCache = new Map()
const openFunctionIDs = new WeakMap()
let nextOpenFunctionID = 1

function resolveIndexPath(env = process.env) {
  const indexPath = env.NIFTY_RAG_INDEX_PATH
  if (!indexPath) return join(homedir(), ".config", "opencode", "nifty-rag")
  return indexPath.replace(/^~(?=\/|$)/, homedir())
}

function envInt(name, fallback, env = process.env) {
  const value = Number.parseInt(env[name] ?? "", 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function envBoolean(name, fallback = false, env = process.env) {
  const value = env[name]
  if (value === undefined || value === null || value === "") return fallback
  return /^(1|true|yes|on)$/i.test(String(value))
}

function boundedInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(value ?? "", 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function truncateText(value, maxChars) {
  const text = normalizeText(value)
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars).trim()
}

function pushPart(parts, value, maxChars = 300) {
  const text = truncateText(value, maxChars)
  if (text) parts.push(text)
}

function collectValueParts(value, parts, { depth = 0, maxDepth = 2, maxChars = 260 } = {}) {
  if (parts.length >= MAX_COLLECTED_PARTS || value === undefined || value === null) return
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    pushPart(parts, value, maxChars)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 8)) collectValueParts(item, parts, { depth, maxDepth, maxChars })
    return
  }
  if (typeof value !== "object" || depth >= maxDepth) return
  for (const [key, nested] of Object.entries(value).slice(0, 16)) {
    if (parts.length >= MAX_COLLECTED_PARTS) return
    if (/token|secret|password|authorization|cookie/i.test(key)) continue
    if (typeof nested === "string" || typeof nested === "number" || typeof nested === "boolean") {
      pushPart(parts, `${key.replace(/_/g, " ")} ${nested}`, maxChars)
    } else {
      collectValueParts(nested, parts, { depth: depth + 1, maxDepth, maxChars })
    }
  }
}

function collectIdentifierParts(args = {}) {
  const parts = []
  if (args.task_id) pushPart(parts, `task ${args.task_id}`, 120)
  if (args.parent_task_id) pushPart(parts, `task ${args.parent_task_id}`, 120)
  if (args.project_id) pushPart(parts, `project ${args.project_id}`, 120)
  if (args.milestone_id) pushPart(parts, `milestone ${args.milestone_id}`, 120)
  if (args.list_id) pushPart(parts, `list ${args.list_id}`, 120)
  if (args.status_id) pushPart(parts, `status ${args.status_id}`, 120)
  return parts
}

function collectSemanticParts(args = {}) {
  const parts = []
  const weightedFields = [
    ["title", 200],
    ["name", 200],
    ["summary", 240],
    ["description", 400],
    ["query", 400],
    ["message", 300],
    ["content", 300],
    ["comment", 300],
    ["text", 300],
    ["status", 160],
    ["state", 160],
    ["status_name", 160],
    ["branch", 160],
  ]
  for (const [field, maxChars] of weightedFields) {
    if (args[field] !== undefined) pushPart(parts, args[field], maxChars)
  }
  for (const field of ["files", "changed_files", "external_files"]) {
    if (Array.isArray(args[field])) pushPart(parts, args[field].slice(0, 12).join(" "), 300)
  }
  return parts
}

function collectNestedEvidenceParts(args = {}) {
  const parts = []
  for (const field of [
    "delivery_evidence",
    "evidence",
    "acceptance_criteria",
    "implementation_notes",
    "custom_fields",
    "metadata",
  ]) {
    if (args[field] !== undefined) collectValueParts(args[field], parts, { maxChars: 280 })
  }
  return parts
}

function dedupeParts(parts = []) {
  const seen = new Set()
  const deduped = []
  for (const part of parts) {
    const text = normalizeText(part)
    if (!text) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(text)
  }
  return deduped
}

function joinQueryParts(parts, maxQueryChars) {
  return truncateText(dedupeParts(parts).join(". "), maxQueryChars)
}

function toolLabel(toolName) {
  return normalizeText(String(toolName || "").replace(/^nifty_/, "").replace(/_/g, " "))
}

function ragRuntimeConfig(options = {}, env = process.env) {
  return {
    indexPath: options.indexPath ?? resolveIndexPath(env),
    taskLimit: boundedInt(options.taskLimit ?? env.NIFTY_RAG_TASK_LIMIT, DEFAULT_TASK_LIMIT, { min: 1, max: 25 }),
    policyLimit: boundedInt(options.policyLimit ?? env.NIFTY_RAG_POLICY_LIMIT, DEFAULT_POLICY_LIMIT, { min: 1, max: 25 }),
    timeoutMs: boundedInt(options.timeoutMs ?? env.NIFTY_RAG_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, { min: 50, max: 30_000 }),
    cacheTtlMs: boundedInt(options.cacheTtlMs ?? env.NIFTY_RAG_CACHE_TTL_MS, DEFAULT_CACHE_TTL_MS, { min: 0, max: 3_600_000 }),
    maxQueries: boundedInt(options.maxQueries ?? env.NIFTY_RAG_QUERY_FANOUT, DEFAULT_MAX_QUERIES, { min: 1, max: 8 }),
    maxQueryChars: boundedInt(options.maxQueryChars ?? env.NIFTY_RAG_MAX_QUERY_CHARS, DEFAULT_MAX_QUERY_CHARS, { min: 120, max: 2000 }),
    maxResultTextChars: boundedInt(
      options.maxResultTextChars ?? env.NIFTY_RAG_MAX_RESULT_TEXT_CHARS,
      DEFAULT_MAX_RESULT_TEXT_CHARS,
      { min: 120, max: 4000 },
    ),
  }
}

/**
 * Construct a fanout query list from a tool name and arguments.
 *
 * The first query remains backward-compatible with buildRagQuery() and combines
 * tool, identifier, semantic, and evidence terms. Additional queries target
 * exact identifiers, semantic prose, nested evidence, and file-path context.
 *
 * @param {string} toolName
 * @param {object} args
 * @param {{ maxQueries?: number, maxQueryChars?: number }} options
 * @returns {string[]}
 */
export function buildRagQueries(toolName, args = {}, options = {}) {
  const config = ragRuntimeConfig(options)
  const label = toolLabel(toolName)
  const identifiers = collectIdentifierParts(args)
  const semantic = collectSemanticParts(args)
  const evidence = collectNestedEvidenceParts(args)
  const fileContext = []
  for (const field of ["files", "changed_files", "external_files"]) {
    if (Array.isArray(args[field])) pushPart(fileContext, args[field].slice(0, 16).join(" "), 400)
  }

  const candidates = [
    [label, ...identifiers, ...semantic, ...evidence.slice(0, 4)],
    [label, ...identifiers],
    [label, ...semantic],
    [label, ...evidence],
    [label, ...fileContext],
  ]

  const seen = new Set()
  const queries = []
  for (const parts of candidates) {
    const query = joinQueryParts(parts, config.maxQueryChars)
    if (!query) continue
    const key = query.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    queries.push(query)
    if (queries.length >= config.maxQueries) break
  }

  return queries.length ? queries : [label || "nifty task"]
}

/**
 * Construct a single backward-compatible text search query from a tool call.
 *
 * @param {string} toolName
 * @param {object} args
 * @returns {string}
 */
export function buildRagQuery(toolName, args = {}) {
  return buildRagQueries(toolName, args, { maxQueries: 1 })[0]
}

function openFunctionID(openFn) {
  if (!openFunctionIDs.has(openFn)) {
    openFunctionIDs.set(openFn, nextOpenFunctionID++)
  }
  return openFunctionIDs.get(openFn)
}

function cacheKey(indexPath, tableName, openFn) {
  return `${openFunctionID(openFn)}\0${indexPath}\0${tableName}`
}

async function openTableCached(indexPath, tableName, { openFn, cacheTtlMs }) {
  if (!cacheTtlMs) return openFn(indexPath, tableName)
  const key = cacheKey(indexPath, tableName, openFn)
  const now = Date.now()
  const cached = tableCache.get(key)
  if (cached && cached.expiresAt > now) return cached.promise

  const promise = Promise.resolve()
    .then(() => openFn(indexPath, tableName))
    .catch((error) => {
      tableCache.delete(key)
      throw error
    })
  tableCache.set(key, { tableName, indexPath, expiresAt: now + cacheTtlMs, promise })
  return promise
}

export function clearRagTableCache() {
  tableCache.clear()
}

export function ragCacheStats() {
  const now = Date.now()
  let liveEntries = 0
  for (const [key, entry] of tableCache.entries()) {
    if (entry.expiresAt <= now) {
      tableCache.delete(key)
    } else {
      liveEntries++
    }
  }
  return {
    entries: liveEntries,
    ttl_active: liveEntries > 0,
  }
}

/**
 * Open a named LanceDB table. Returns null when:
 *  - @lancedb/lancedb is not installed
 *  - The index directory does not exist
 *  - The named table has not been created yet
 * Never throws.
 *
 * @param {string} indexPath - Root directory of the LanceDB index
 * @param {string} tableName - Table name to open ('nifty-tasks' or 'nifty-policy')
 * @returns {Promise<object|null>}
 */
export async function openIndex(indexPath, tableName) {
  let lancedb
  try {
    lancedb = await import("@lancedb/lancedb")
  } catch {
    return null
  }
  try {
    const conn = await lancedb.connect(indexPath)
    const names = await conn.tableNames()
    if (!names.includes(tableName)) return null
    return await conn.openTable(tableName)
  } catch {
    return null
  }
}

function resultIdentity(result = {}) {
  return [
    result.source_table || "",
    result.doc_type || "",
    result.doc_id || "",
    result.task_id || "",
    result.chunk_index ?? "",
    normalizeText(result.text).slice(0, 160),
  ].join("::")
}

function rawScore(row = {}) {
  return row._relevance_score ?? row.score ?? row._distance ?? 0
}

export function normalizeSearchResults(rows = [], {
  limit = 5,
  maxResultTextChars = DEFAULT_MAX_RESULT_TEXT_CHARS,
  sourceTable = null,
  queryIndex = 0,
} = {}) {
  const results = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const text = truncateText(row.text ?? row.content ?? "", maxResultTextChars)
    if (!text) continue
    results.push({
      text,
      doc_id: row.doc_id ?? null,
      doc_type: row.doc_type ?? null,
      project_id: row.project_id ?? null,
      task_id: row.task_id ?? null,
      chunk_index: row.chunk_index ?? null,
      chunk_total: row.chunk_total ?? null,
      score: rawScore(row),
      source_table: row.source_table ?? sourceTable,
      query_index: row.query_index ?? queryIndex,
    })
    if (results.length >= limit) break
  }
  return results
}

function mergeSearchResults(resultSets = [], { limit, maxResultTextChars, sourceTable }) {
  const seen = new Set()
  const merged = []
  for (const [queryIndex, rows] of resultSets.entries()) {
    const normalized = normalizeSearchResults(rows, {
      limit,
      maxResultTextChars,
      sourceTable,
      queryIndex,
    })
    for (const row of normalized) {
      const key = resultIdentity(row)
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(row)
      if (merged.length >= limit) break
    }
    if (merged.length >= limit) break
  }
  return merged.map((row, index) => ({ ...row, rank: index + 1 }))
}

/**
 * Search a LanceDB table using full-text search.
 * Returns [] when the table is null, search fails, or no results.
 * Never throws.
 *
 * @param {object|null} table - Open LanceDB table (or null)
 * @param {string} query - Search query string
 * @param {{ limit?: number, maxResultTextChars?: number, sourceTable?: string, queryIndex?: number }} opts
 * @returns {Promise<Array<{ text: string, doc_id: string|null, doc_type: string|null, score: number }>>}
 */
export async function searchIndex(table, query, {
  limit = 5,
  maxResultTextChars = DEFAULT_MAX_RESULT_TEXT_CHARS,
  sourceTable = null,
  queryIndex = 0,
} = {}) {
  if (!table || !query) return []
  try {
    const rows = await table.search(query).limit(limit).toArray()
    return normalizeSearchResults(rows, { limit, maxResultTextChars, sourceTable, queryIndex })
  } catch {
    return []
  }
}

function withTimeout(promise, ms) {
  let timeoutID
  const timeout = new Promise((_, reject) => {
    timeoutID = setTimeout(() => reject(new Error(`RAG search timed out after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutID) clearTimeout(timeoutID)
  })
}

async function searchCorpus({
  indexPath,
  tableName,
  limit,
  queries,
  timeoutMs,
  cacheTtlMs,
  maxResultTextChars,
  openFn,
  searchFn,
}) {
  return withTimeout(
    (async () => {
      const table = await openTableCached(indexPath, tableName, { openFn, cacheTtlMs })
      if (!table) return []
      const searchResults = await Promise.allSettled(
        queries.map((query, queryIndex) =>
          searchFn(table, query, {
            limit,
            maxResultTextChars,
            sourceTable: tableName,
            queryIndex,
          })),
      )
      return mergeSearchResults(
        searchResults.map((result) => (result.status === "fulfilled" ? result.value : [])),
        { limit, maxResultTextChars, sourceTable: tableName },
      )
    })(),
    timeoutMs,
  )
}

/**
 * Retrieve RAG context for a tool call.
 *
 * Runs task-corpus and policy-corpus fanout searches in parallel. Any failure
 * (error, timeout, missing index, LanceDB unavailable) returns [] for that path
 * only. Never throws; always resolves to the result object.
 *
 * @param {string} toolName
 * @param {object} args - Tool arguments
 * @param {{
 *   indexPath?: string,
 *   taskLimit?: number,
 *   policyLimit?: number,
 *   timeoutMs?: number,
 *   cacheTtlMs?: number,
 *   maxQueries?: number,
 *   maxQueryChars?: number,
 *   maxResultTextChars?: number,
 *   includeDiagnostics?: boolean,
 *   _openFn?: (indexPath: string, tableName: string) => Promise<any>,
 *   _searchFn?: (table: any, query: string, opts: object) => Promise<any[]>,
 * }} options
 * @returns {Promise<{ historical_context: any[], policy_citations: any[], diagnostics?: object }>}
 */
export async function ragContextForTool(toolName, args = {}, options = {}) {
  const config = ragRuntimeConfig(options)
  const openFn = options._openFn ?? openIndex
  const searchFn = options._searchFn ?? searchIndex
  const queries = buildRagQueries(toolName, args, config)

  const [taskResult, policyResult] = await Promise.allSettled([
    searchCorpus({
      indexPath: config.indexPath,
      tableName: TASK_TABLE,
      limit: config.taskLimit,
      queries,
      timeoutMs: config.timeoutMs,
      cacheTtlMs: config.cacheTtlMs,
      maxResultTextChars: config.maxResultTextChars,
      openFn,
      searchFn,
    }),
    searchCorpus({
      indexPath: config.indexPath,
      tableName: POLICY_TABLE,
      limit: config.policyLimit,
      queries,
      timeoutMs: config.timeoutMs,
      cacheTtlMs: config.cacheTtlMs,
      maxResultTextChars: config.maxResultTextChars,
      openFn,
      searchFn,
    }),
  ])

  const context = {
    historical_context: taskResult.status === "fulfilled" ? taskResult.value : [],
    policy_citations: policyResult.status === "fulfilled" ? policyResult.value : [],
  }

  if (options.includeDiagnostics || envBoolean("NIFTY_RAG_INCLUDE_DIAGNOSTICS", false)) {
    context.diagnostics = {
      queries,
      config: {
        index_path: config.indexPath,
        task_limit: config.taskLimit,
        policy_limit: config.policyLimit,
        timeout_ms: config.timeoutMs,
        cache_ttl_ms: config.cacheTtlMs,
        max_queries: config.maxQueries,
        max_query_chars: config.maxQueryChars,
        max_result_text_chars: config.maxResultTextChars,
      },
      task_error: taskResult.status === "rejected" ? taskResult.reason?.message || String(taskResult.reason) : null,
      policy_error: policyResult.status === "rejected" ? policyResult.reason?.message || String(policyResult.reason) : null,
      cache: ragCacheStats(),
    }
  }

  return context
}

export async function ragDiagnostics(options = {}) {
  const config = ragRuntimeConfig(options)
  const openFn = options._openFn ?? openIndex
  const tables = {}

  await Promise.all(RAG_TABLES.map(async (tableName) => {
    try {
      const table = await withTimeout(
        openTableCached(config.indexPath, tableName, { openFn, cacheTtlMs: config.cacheTtlMs }),
        config.timeoutMs,
      )
      tables[tableName] = { available: Boolean(table), error: null }
    } catch (error) {
      tables[tableName] = { available: false, error: error.message }
    }
  }))

  return {
    enabled: options.enabled ?? envBoolean("NIFTY_RAG_ENABLED", DEFAULT_ENABLED),
    index_path: config.indexPath,
    config: {
      task_limit: config.taskLimit,
      policy_limit: config.policyLimit,
      timeout_ms: config.timeoutMs,
      cache_ttl_ms: config.cacheTtlMs,
      max_queries: config.maxQueries,
      max_query_chars: config.maxQueryChars,
      max_result_text_chars: config.maxResultTextChars,
    },
    tables,
    cache: ragCacheStats(),
  }
}
