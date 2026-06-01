import { homedir } from "node:os"
import { join } from "node:path"

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3 — RAG Context Module
//
// Design invariants:
//  1. Never blocks tool execution. All errors return [] for that path only.
//  2. LanceDB is an optional dependency — missing package silently returns [].
//  3. _openFn and _searchFn are injectable via options for test isolation.
//  4. Both task-corpus and policy-corpus searches run in parallel via
//     Promise.allSettled with a per-search timeout cap.
// ─────────────────────────────────────────────────────────────────────────────

function resolveIndexPath() {
  const p = process.env.NIFTY_RAG_INDEX_PATH
  if (!p) return join(homedir(), ".config", "opencode", "nifty-rag")
  return p.replace(/^~(?=\/|$)/, homedir())
}

function envInt(name, fallback) {
  const v = process.env[name]
  if (!v) return fallback
  const n = parseInt(v, 10)
  return Number.isNaN(n) ? fallback : n
}

/**
 * Construct a text search query from a tool name and its arguments.
 * Used as the FTS query string sent to LanceDB.
 *
 * @param {string} toolName
 * @param {object} args
 * @returns {string}
 */
export function buildRagQuery(toolName, args = {}) {
  const parts = [toolName.replace(/_/g, " ")]
  if (args.name) parts.push(String(args.name))
  if (args.description) parts.push(String(args.description).slice(0, 300))
  if (args.query) parts.push(String(args.query))
  if (args.task_id) parts.push(`task ${args.task_id}`)
  return parts.filter(Boolean).join(". ")
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
    return null // Package not installed — RAG silently disabled
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

/**
 * Search a LanceDB table using full-text search (BM25).
 * Returns [] when the table is null, search fails, or no results.
 * Never throws.
 *
 * @param {object|null} table - Open LanceDB table (or null)
 * @param {string} query - Search query string
 * @param {{ limit?: number }} opts
 * @returns {Promise<Array<{ text: string, doc_id: string|null, doc_type: string|null, score: number }>>}
 */
export async function searchIndex(table, query, { limit = 5 } = {}) {
  if (!table) return []
  try {
    const rows = await table.search(query).limit(limit).toArray()
    return rows.map((r) => ({
      text: r.text ?? r.content ?? "",
      doc_id: r.doc_id ?? null,
      doc_type: r.doc_type ?? null,
      project_id: r.project_id ?? null,
      score: r._distance ?? r._relevance_score ?? r.score ?? 0,
    }))
  } catch {
    return []
  }
}

/**
 * Race a promise against a hard millisecond deadline.
 * Rejects with an Error on timeout (caught by Promise.allSettled upstream).
 *
 * @param {Promise} promise
 * @param {number} ms
 * @returns {Promise}
 */
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`RAG search timed out after ${ms}ms`)), ms),
    ),
  ])
}

/**
 * Retrieve RAG context for a tool call.
 *
 * Runs task-corpus and policy-corpus searches in parallel. Any failure
 * (error, timeout, missing index, LanceDB unavailable) returns [] for
 * that path only. Never throws; always resolves to the result object.
 *
 * @param {string} toolName
 * @param {object} args - Tool arguments
 * @param {{
 *   indexPath?: string,
 *   taskLimit?: number,
 *   policyLimit?: number,
 *   timeoutMs?: number,
 *   _openFn?: (indexPath: string, tableName: string) => Promise<any>,
 *   _searchFn?: (table: any, query: string, opts: object) => Promise<any[]>,
 * }} options
 * @returns {Promise<{ historical_context: any[], policy_citations: any[] }>}
 */
export async function ragContextForTool(toolName, args = {}, options = {}) {
  const {
    indexPath = resolveIndexPath(),
    taskLimit = envInt("NIFTY_RAG_TASK_LIMIT", 5),
    policyLimit = envInt("NIFTY_RAG_POLICY_LIMIT", 3),
    timeoutMs = envInt("NIFTY_RAG_TIMEOUT_MS", 2000),
    _openFn = openIndex,
    _searchFn = searchIndex,
  } = options

  const query = buildRagQuery(toolName, args)

  const [taskResult, policyResult] = await Promise.allSettled([
    withTimeout(
      (async () => {
        const table = await _openFn(indexPath, "nifty-tasks")
        return _searchFn(table, query, { limit: taskLimit })
      })(),
      timeoutMs,
    ),
    withTimeout(
      (async () => {
        const table = await _openFn(indexPath, "nifty-policy")
        return _searchFn(table, query, { limit: policyLimit })
      })(),
      timeoutMs,
    ),
  ])

  return {
    historical_context: taskResult.status === "fulfilled" ? taskResult.value : [],
    policy_citations: policyResult.status === "fulfilled" ? policyResult.value : [],
  }
}
