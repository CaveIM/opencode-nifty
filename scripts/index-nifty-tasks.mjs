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

// ─────────────────────────────────────────────────────────────────────────────

function resolveIndexPath() {
  const p = process.env.NIFTY_RAG_INDEX_PATH
  if (!p) return join(homedir(), ".config", "opencode", "nifty-rag")
  return p.replace(/^~(?=\/|$)/, homedir())
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

function commentToChunk(comment, taskId, projectId) {
  const text = String(comment.text ?? comment.body ?? "").slice(0, MAX_COMMENT_TEXT)
  return {
    doc_id: comment.id ?? `${taskId}-comment-${Date.now()}`,
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

// ─────────────────────────────────────────────────────────────────────────────

async function collectProjectIds(token) {
  if (args.project) return [args.project]
  const data = await niftyGet("/api/v1.0/projects", token)
  return (data.projects ?? []).map((p) => p.id).filter(Boolean)
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

      // Comments — best-effort; skip on error
      try {
        const msgData = await niftyGet(`/api/v1.0/tasks/${task.id}/messages`, token, { limit: 200 })
        const comments = msgData.messages ?? msgData.comments ?? []
        for (const c of comments) {
          const chunk = commentToChunk(c, task.id, projectId)
          if (chunk.text) {
            chunks.push(chunk)
            commentCount++
          }
        }
      } catch {
        // Comments are best-effort
      }
    }

    hasMore = tasks.length === PAGE_SIZE
    page++
  }

  return { chunks, taskCount, commentCount }
}

// ─────────────────────────────────────────────────────────────────────────────

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

  if (args.reset) {
    try {
      await conn.dropTable(TABLE_NAME)
      console.log(`Dropped existing table '${TABLE_NAME}'.`)
    } catch {
      // Table may not exist yet
    }
  }

  const sinceDate = args.since ?? null
  const projectIds = await collectProjectIds(token)
  console.log(`Indexing ${projectIds.length} project(s)${sinceDate ? ` updated after ${sinceDate}` : ""}...`)

  const allChunks = []
  let totalTasks = 0
  let totalComments = 0

  for (const projectId of projectIds) {
    process.stdout.write(`  project ${projectId}... `)
    const { chunks, taskCount, commentCount } = await indexProject(projectId, token, sinceDate)
    allChunks.push(...chunks)
    totalTasks += taskCount
    totalComments += commentCount
    process.stdout.write(`${taskCount} tasks, ${commentCount} comments\n`)
  }

  if (!allChunks.length) {
    console.log("No data to index.")
    return
  }

  // Write to LanceDB (create or append)
  const tableNames = await conn.tableNames()
  let table
  if (tableNames.includes(TABLE_NAME)) {
    table = await conn.openTable(TABLE_NAME)
    await table.add(allChunks)
    console.log(`Appended ${allChunks.length} chunks to existing table '${TABLE_NAME}'.`)
  } else {
    table = await conn.createTable(TABLE_NAME, allChunks)
    console.log(`Created table '${TABLE_NAME}' with ${allChunks.length} chunks.`)
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
    `Done. ${totalTasks} tasks + ${totalComments} comments → ${allChunks.length} chunks indexed.`,
  )
}

main().catch((err) => {
  console.error("Indexing failed:", err.message)
  process.exit(1)
})
