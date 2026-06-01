#!/usr/bin/env node
/**
 * scripts/rag-webhook.mjs
 *
 * Webhook-driven incremental re-index server.
 * Listens for Nifty webhook events (task.updated, task.created, comment.created)
 * and triggers a scoped re-index of the affected project within a debounce window.
 *
 * Usage:
 *   node scripts/rag-webhook.mjs
 *
 * Env:
 *   NIFTY_RAG_WEBHOOK_PORT           HTTP port to listen on (default: 7779)
 *   NIFTY_RAG_REINDEX_WEBHOOK_SECRET HMAC-SHA256 secret for signature validation
 *                                    (unset = dev mode, validation skipped)
 *   NIFTY_RAG_DEBOUNCE_MS            Min ms between re-indexes per entity (default: 30000)
 *   NIFTY_RAG_REINDEX_CRON           "nightly" to also schedule a midnight full re-sync
 *                                    (any truthy value enables it, default: true)
 *
 * Webhook signature header:
 *   x-nifty-signature: sha256=<hex>   (HMAC-SHA256 over raw request body)
 */

import { createHmac, timingSafeEqual } from "node:crypto"
import { createServer } from "node:http"
import { execFile } from "node:child_process"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = fileURLToPath(new URL(".", import.meta.url))
const SCRIPTS_DIR = __dirname

const PORT = parseInt(process.env.NIFTY_RAG_WEBHOOK_PORT ?? "7779", 10)
const SECRET = process.env.NIFTY_RAG_REINDEX_WEBHOOK_SECRET || null
const DEBOUNCE_MS = parseInt(process.env.NIFTY_RAG_DEBOUNCE_MS ?? "30000", 10)
const ENABLE_NIGHTLY = process.env.NIFTY_RAG_REINDEX_CRON !== "false"

// Map of entity key → debounce timeout handle
const pending = new Map()

// ─────────────────────────────────────────────────────────────────────────────
// HMAC signature validation

/**
 * Validate x-nifty-signature: sha256=<hex> against the raw request body.
 * Returns true if no SECRET is configured (dev mode).
 *
 * @param {Buffer} body
 * @param {string|undefined} signatureHeader
 * @returns {boolean}
 */
function validateSignature(body, signatureHeader) {
  if (!SECRET) return true // Dev mode — skip validation
  if (!signatureHeader) return false

  const prefix = "sha256="
  const raw = signatureHeader.startsWith(prefix) ? signatureHeader.slice(prefix.length) : signatureHeader

  const expected = createHmac("sha256", SECRET).update(body).digest("hex")

  // Constant-time comparison to prevent timing attacks
  const expectedBuf = Buffer.from(expected, "utf8")
  const actualBuf = Buffer.from(raw, "utf8")
  if (expectedBuf.length !== actualBuf.length) return false
  return timingSafeEqual(expectedBuf, actualBuf)
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-index scheduling

/**
 * Schedule a debounced re-index for a given entity key.
 * Multiple events for the same project/task within DEBOUNCE_MS are coalesced.
 *
 * @param {string} key   - Debounce key (project ID or task ID)
 * @param {string|null} projectId
 * @param {string|null} taskId
 */
function scheduleReindex(key, projectId, taskId) {
  if (pending.has(key)) {
    clearTimeout(pending.get(key))
  }

  const handle = setTimeout(() => {
    pending.delete(key)
    const scriptArgs = projectId ? ["--project", projectId] : []
    const scriptPath = join(SCRIPTS_DIR, "index-nifty-tasks.mjs")

    execFile(
      process.execPath,
      [scriptPath, ...scriptArgs],
      { env: process.env, cwd: process.cwd() },
      (err, stdout, stderr) => {
        if (err) {
          console.error(`[webhook] Re-index failed for ${key}:`, err.message)
          if (stderr) console.error(stderr.trim())
        } else {
          console.log(`[webhook] Re-indexed ${key}`)
          if (stdout.trim()) console.log(stdout.trim())
        }
      },
    )
  }, DEBOUNCE_MS)

  pending.set(key, handle)
  console.log(
    `[webhook] Re-index scheduled for ${key} in ${DEBOUNCE_MS}ms` +
      (projectId ? ` (project ${projectId})` : ""),
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP server

const server = createServer(async (req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "text/plain" }).end("Method Not Allowed")
    return
  }
  if (req.url !== "/webhook") {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not Found")
    return
  }

  // Read body
  const bodyChunks = []
  for await (const chunk of req) bodyChunks.push(chunk)
  const body = Buffer.concat(bodyChunks)

  // Validate HMAC
  const sig = req.headers["x-nifty-signature"] ?? req.headers["x-hub-signature-256"]
  if (!validateSignature(body, sig)) {
    console.warn(`[webhook] Rejected request — invalid signature`)
    res.writeHead(401, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "Unauthorized" }))
    return
  }

  // Parse event
  let event
  try {
    event = JSON.parse(body.toString("utf8"))
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "Invalid JSON" }))
    return
  }

  const eventType = event.type ?? event.event ?? "unknown"
  const taskId = event.data?.task?.id ?? event.data?.id ?? event.task_id ?? null
  const projectId =
    event.data?.task?.project ?? event.data?.project?.id ?? event.project_id ?? null

  const handledEvents = new Set([
    "task.updated",
    "task.created",
    "comment.created",
    "doc.updated",
  ])

  if (!handledEvents.has(eventType)) {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ ok: true, skipped: true, event: eventType }))
    return
  }

  // Debounce key: prefer project-level so multiple task events collapse
  const key = projectId ?? taskId ?? `event-${Date.now()}`
  scheduleReindex(key, projectId, taskId)

  console.log(`[webhook] ${eventType} | task=${taskId} project=${projectId}`)

  res.writeHead(200, { "Content-Type": "application/json" })
  res.end(JSON.stringify({ ok: true, scheduled: key }))
})

server.on("error", (err) => {
  console.error("[webhook] Server error:", err.message)
})

// ─────────────────────────────────────────────────────────────────────────────
// Nightly full re-sync

function scheduleMidnightReindex() {
  const now = new Date()
  const midnight = new Date(now)
  midnight.setHours(24, 0, 0, 0) // next midnight
  const delay = midnight.getTime() - now.getTime()

  setTimeout(() => {
    console.log("[cron] Running nightly full re-index...")
    const scriptPath = join(SCRIPTS_DIR, "index-nifty-tasks.mjs")
    execFile(
      process.execPath,
      [scriptPath, "--reset"],
      { env: process.env, cwd: process.cwd() },
      (err) => {
        if (err) console.error("[cron] Nightly re-index failed:", err.message)
        else console.log("[cron] Nightly re-index complete.")
        scheduleMidnightReindex() // schedule next night
      },
    )
  }, delay)

  const h = Math.floor(delay / 3600000)
  const m = Math.floor((delay % 3600000) / 60000)
  console.log(`[cron] Nightly full re-index scheduled in ${h}h ${m}m`)
}

// ─────────────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`[webhook] RAG re-index webhook server listening on port ${PORT}`)
  console.log(`[webhook] POST /webhook  — accepted events: task.updated, task.created, comment.created, doc.updated`)
  console.log(`[webhook] HMAC validation: ${SECRET ? "enabled (sha256)" : "DISABLED (dev mode — set NIFTY_RAG_REINDEX_WEBHOOK_SECRET)"}`)
  console.log(`[webhook] Debounce: ${DEBOUNCE_MS}ms per entity`)

  if (ENABLE_NIGHTLY) scheduleMidnightReindex()
})
