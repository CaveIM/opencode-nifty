#!/usr/bin/env node
/**
 * scripts/index-nifty-tasks.mjs
 *
 * Bulk indexer: fetches all Nifty tasks + comments and populates the
 * LanceDB `nifty-tasks` table for Phase 3 RAG context injection.
 *
 * Usage:
 *   node scripts/index-nifty-tasks.mjs [options]
 *
 * Options:
 *   --project <id>    Index a single project (default: all projects)
 *   --reset           Drop and rebuild the table from scratch
 *   --since <ISO>     Only re-index tasks updated after this date (incremental)
 *
 * Required env / auth:
 *   NIFTY_ACCESS_TOKEN       Bearer token (falls back to ~/.config/opencode/nifty-auth.json)
 *
 * Index env:
 *   NIFTY_RAG_INDEX_PATH     LanceDB root dir (default: ~/.config/opencode/nifty-rag)
 */

import { existsSync, readFileSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { createHash } from "node:crypto"
import { homedir } from "node:os"
import { join } from "node:path"
import { parseArgs } from "node:util"

const { values: args } = parseArgs({
  options: {
    project: { type: "string" },
    reset: { type: "boolean", default: false },
    since: { type: "string" },
  },
  strict: false,
})

const API_BASE = "https://openapi.niftypm.com"
const TABLE_NAME = "nifty-tasks"
const PAGE_SIZE = 100
const MAX_COMMENT_TEXT = 2000 // chars per comment chunk
const CHUNK_WORDS = 400 // approximate words per text chunk
const COMMENT_FETCH_CONCURRENCY = envInt("NIFTY_RAG_COMMENT_CONCURRENCY", 8)
const WRITE_BATCH_SIZE = envInt("NIFTY_RAG_WRITE_BATCH_SIZE", 2000)

// ─────────────────────────────────────────────────────────────────────────────

function resolveIndexPath() {
  const p = process.env.NIFTY_RAG_INDEX_PATH
  if (!p) return join(homedir(), ".config", "opencode", "nifty-rag")
  return p.replace(/^~(?=\/|$)/, homedir())
}

function envInt(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? "", 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function getToken() {
  if (process.env.NIFTY_ACCESS_TOKEN) return process.env.NIFTY_ACCESS_TOKEN
  const tokenPath = join(homedir(), ".config", "opencode", "nifty-auth.json")
  if (!existsSync(tokenPath)) {
    throw new Error("No access token found. Set NIFTY_ACCESS_TOKEN or run `nifty auth`.")
  }
  const auth = JSON.parse(readFileSync(tokenPath, "utf8"))
  const token = auth.access_token || auth.token
  if (!token) throw new Error("nifty-auth.json found but contains no access_token.")
  return token
}

async function niftyGet(path, token, params = {}) {
  const url = new URL(`${API_BASE}${path}`)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`Nifty API ${res.status} ${path}: ${body.slice(0, 200)}`)
  }
  return res.json()
}

// ─────────────────────────────────────────────────────────────────────────────
// Chunking helpers

function chunkWords(text, size) {
  if (!text) return []
  const words = text.trim().split(/\s+/)
  if (!words.length) return []
  const chunks = []
  for (let i = 0; i < words.length; i += size) {
    chunks.push(words.slice(i, i + size).join(" "))
  }
  return chunks
}

function nowIso() {
  return new Date().toISOString()
}

function hashText(value) {
  return createHash("sha256").update(String(value)).digest("hex")
}

function taskToChunks(task, projectId) {
  const fullText = [task.name, task.description].filter(Boolean).join("\n\n")
  const chunks = chunkWords(fullText, CHUNK_WORDS)
  if (!chunks.length) chunks.push(task.name ?? "(untitled)")
  const base = {
    doc_id: task.id,
    doc_type: "task",
    project_id: projectId,
    created_at: task.created_at ?? nowIso(),
    updated_at: task.updated_at ?? task.created_at ?? nowIso(),
    chunk_total: chunks.length,
  }
  return chunks.map((text, i) => ({ ...base, chunk_index: i, text }))
}

function fallbackCommentId(comment, taskId, projectId, text) {
  const source = [projectId, taskId, comment.created_at || "", text].join("|")
  return `${taskId}-comment-${hashText(source).slice(0, 16)}`
}

function commentToChunk(comment, taskId, projectId) {
  const text = String(comment.text ?? comment.body ?? "").slice(0, MAX_COMMENT_TEXT)
  return {
    doc_id: comment.id ?? fallbackCommentId(comment, taskId, projectId, text),
    doc_type: "comment",
    project_id: projectId,
    task_id: taskId,
    chunk_index: 0,
    chunk_total: 1,
    created_at: comment.created_at ?? nowIso(),
    updated_at: comment.created_at ?? nowIso(),
    text,
  }
}

function chunkIdentity(chunk) {
  return [
    chunk.doc_type,
    chunk.doc_id,
    chunk.task_id || "",
    chunk.chunk_index,
    chunk.text,
  ].join("::")
}

function dedupeChunks(chunks = []) {
  const seen = new Set()
  const deduped = []
  for (const chunk of chunks) {
    const key = chunkIdentity(chunk)
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(chunk)
  }
  return deduped
}

function escapeSqlValue(value) {
  return String(value).replaceAll("'", "''")
}

async function clearProjectScope(table, projectIds = []) {
  if (!projectIds.length) return
  if (typeof table.delete !== "function") {
    throw new Error(
      "Installed @lancedb/lancedb does not expose table.delete(); run with --reset or upgrade LanceDB for idempotent project-scoped updates.",
    )
  }
  for (const projectId of projectIds) {
    await table.delete(`project_id = '${escapeSqlValue(projectId)}'`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────

async function collectProjectIds(token) {
  if (args.project) return [args.project]
  const data = await niftyGet("/api/v1.0/projects", token)
  return (data.projects ?? []).map((p) => p.id).filter(Boolean)
}

async function fetchTaskComments(taskId, token) {
  try {
    const msgData = await niftyGet(`/api/v1.0/tasks/${taskId}/messages`, token, { limit: 200 })
    return msgData.messages ?? msgData.comments ?? []
  } catch {
    return []
  }
}

async function indexProject(projectId, token, sinceDate) {
  const chunks = []
  let page = 1
  let taskCount = 0
  let commentCount = 0
  let hasMore = true

  while (hasMore) {
    const params = {
      project_id: projectId,
      limit: PAGE_SIZE,
      page,
      include_subtasks: "true",
    }
    if (sinceDate) params.updated_after = sinceDate

    let data
    try {
      data = await niftyGet("/api/v1.0/tasks", token, params)
    } catch (err) {
      console.warn(`  [warn] Failed to fetch page ${page} for project ${projectId}: ${err.message}`)
      break
    }

    const tasks = data.tasks ?? []
    if (!tasks.length) { hasMore = false; break }

    for (const task of tasks) {
      chunks.push(...taskToChunks(task, projectId))
      taskCount++
    }

    for (let index = 0; index < tasks.length; index += COMMENT_FETCH_CONCURRENCY) {
      const batch = tasks.slice(index, index + COMMENT_FETCH_CONCURRENCY)
      const batchComments = await Promise.all(
        batch.map(async (task) => ({
          taskId: task.id,
          comments: await fetchTaskComments(task.id, token),
        })),
      )
      for (const taskComments of batchComments) {
        for (const comment of taskComments.comments) {
          const chunk = commentToChunk(comment, taskComments.taskId, projectId)
          if (!chunk.text) continue
          chunks.push(chunk)
          commentCount++
        }
      }
    }

    hasMore = tasks.length === PAGE_SIZE
    page++
  }

  return { chunks, taskCount, commentCount }
}

// ─────────────────────────────────────────────────────────────────────────────

async function flushChunkBatch(conn, table, chunks = []) {
  if (!chunks.length) return table
  if (!table) {
    return conn.createTable(TABLE_NAME, chunks)
  }
  await table.add(chunks)
  return table
}

async function main() {
  // Guard: require LanceDB
  let lancedb
  try {
    lancedb = await import("@lancedb/lancedb")
  } catch {
    console.error("ERROR: @lancedb/lancedb is not installed.")
    console.error("       Run: npm install @lancedb/lancedb")
    process.exit(1)
  }

  const token = getToken()
  const indexPath = resolveIndexPath()
  await mkdir(indexPath, { recursive: true })

  const conn = await lancedb.connect(indexPath)

  const sinceDate = args.since ?? null
  const projectIds = await collectProjectIds(token)
  console.log(`Indexing ${projectIds.length} project(s)${sinceDate ? ` updated after ${sinceDate}` : ""}...`)

  if (args.reset || (!sinceDate && !args.project)) {
    try {
      await conn.dropTable(TABLE_NAME)
      console.log(`Dropped existing table '${TABLE_NAME}'.`)
    } catch {
      // Table may not exist yet
    }
  }

  const tableNames = await conn.tableNames()
  let table = tableNames.includes(TABLE_NAME) ? await conn.openTable(TABLE_NAME) : null
  if (table && (args.project || sinceDate)) {
    await clearProjectScope(table, projectIds)
    console.log(`Cleared existing index rows for ${projectIds.length} project scope(s).`)
  }

  const pendingChunks = []
  const seenChunkKeys = new Set()
  let totalTasks = 0
  let totalComments = 0
  let totalChunks = 0

  for (const projectId of projectIds) {
    process.stdout.write(`  project ${projectId}... `)
    const { chunks: projectChunks, taskCount, commentCount } = await indexProject(projectId, token, sinceDate)
    const dedupedProjectChunks = dedupeChunks(projectChunks)

    for (const chunk of dedupedProjectChunks) {
      const key = chunkIdentity(chunk)
      if (seenChunkKeys.has(key)) continue
      seenChunkKeys.add(key)
      pendingChunks.push(chunk)
      totalChunks++
    }

    if (pendingChunks.length >= WRITE_BATCH_SIZE) {
      table = await flushChunkBatch(conn, table, pendingChunks.splice(0, pendingChunks.length))
    }

    totalTasks += taskCount
    totalComments += commentCount
    process.stdout.write(`${taskCount} tasks, ${commentCount} comments, ${dedupedProjectChunks.length} chunk(s)\n`)
  }

  if (pendingChunks.length) {
    table = await flushChunkBatch(conn, table, pendingChunks.splice(0, pendingChunks.length))
  }

  if (!totalChunks) {
    console.log("No data to index.")
    return
  }

  // Create full-text search index — best-effort (API varies by LanceDB version)
  try {
    if (typeof lancedb.Index?.fts === "function") {
      await table.createIndex("text", { config: lancedb.Index.fts() })
      console.log("FTS index created on 'text' column.")
    }
  } catch {
    // FTS index creation is optional — search still works without it (table scan)
  }

  console.log(
    `Done. ${totalTasks} tasks + ${totalComments} comments → ${totalChunks} chunks indexed.`,
  )
}

main().catch((err) => {
  console.error("Indexing failed:", err.message)
  process.exit(1)
})
