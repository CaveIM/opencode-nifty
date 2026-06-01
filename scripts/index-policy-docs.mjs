#!/usr/bin/env node
/**
 * scripts/index-policy-docs.mjs
 *
 * Policy corpus indexer: chunks policy JSON rules and ADR markdown files
 * into the LanceDB `nifty-policy` table for Phase 3 RAG context injection.
 *
 * Usage:
 *   node scripts/index-policy-docs.mjs [options]
 *
 * Options:
 *   --reset    Drop and rebuild the table from scratch
 *   --dir <p>  Workspace root to search for policy/ and docs/adr/ (default: cwd)
 *
 * Index env:
 *   NIFTY_RAG_INDEX_PATH    LanceDB root dir (default: ~/.config/opencode/nifty-rag)
 */

import { existsSync, readFileSync, readdirSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join, extname, basename } from "node:path"
import { parseArgs } from "node:util"

const { values: args } = parseArgs({
  options: {
    reset: { type: "boolean", default: false },
    dir: { type: "string" },
  },
  strict: false,
})

const TABLE_NAME = "nifty-policy"
const WORKSPACE_ROOT = args.dir ?? process.cwd()
const SECTION_HEADING_RE = /^#{1,3}\s+(.+)/m // Markdown H1-H3 for chunking

// ─────────────────────────────────────────────────────────────────────────────

function resolveIndexPath() {
  const p = process.env.NIFTY_RAG_INDEX_PATH
  if (!p) return join(homedir(), ".config", "opencode", "nifty-rag")
  return p.replace(/^~(?=\/|$)/, homedir())
}

function nowIso() {
  return new Date().toISOString()
}

// ─────────────────────────────────────────────────────────────────────────────
// Policy JSON → chunks (one chunk per rule)

function policyJsonChunks(policyPath) {
  const raw = readFileSync(policyPath, "utf8")
  let policy
  try {
    policy = JSON.parse(raw)
  } catch (err) {
    console.warn(`  [warn] Could not parse ${policyPath}: ${err.message}`)
    return []
  }

  const chunks = []
  const policyId = policy.policy_id ?? basename(policyPath, ".json")
  const effectiveDate = policy.effective_date ?? nowIso().slice(0, 10)

  // One chunk for the policy header
  chunks.push({
    doc_id: `${policyId}:header`,
    doc_type: "policy_header",
    project_id: null,
    chunk_index: 0,
    chunk_total: (policy.rules?.length ?? 0) + 1,
    created_at: `${effectiveDate}T00:00:00Z`,
    updated_at: nowIso(),
    text: [
      `Policy: ${policyId}`,
      policy.description ?? "",
      `Default effect: ${policy.default_effect ?? "allow"}`,
      `Effective: ${effectiveDate}`,
    ]
      .filter(Boolean)
      .join(". "),
  })

  // One chunk for the reporting standards (global comment template, Playwright mandate)
  if (policy.reporting && typeof policy.reporting === "object") {
    const r = policy.reporting
    const reportingLines = [
      `Reporting standards for policy: ${policyId}`,
      r.suppress_routine_status_comments !== undefined
        ? `Suppress routine status comments: ${r.suppress_routine_status_comments}`
        : null,
      r.require_structured_report
        ? "REQUIRED: All AI-generated task comments must use the global structured report template."
        : null,
      r.require_playwright_proof_for_visual_changes
        ? "MANDATORY: AI must attach Playwright screenshot proof for any change affecting UI, CSS, or front-end components before marking a task Done."
        : null,
      r.comment_template
        ? `Standard comment template:\n${r.comment_template}`
        : null,
    ]
    chunks.push({
      doc_id: `${policyId}:reporting`,
      doc_type: "policy_reporting",
      project_id: null,
      chunk_index: 0,
      chunk_total: 1,
      created_at: `${effectiveDate}T00:00:00Z`,
      updated_at: nowIso(),
      text: reportingLines.filter(Boolean).join("\n"),
    })
  }

  // One chunk per rule
  for (const [i, rule] of (policy.rules ?? []).entries()) {
    const ruleId = rule.id ?? `rule-${i}`
    const condition = rule.condition
      ? `when ${rule.condition.arg} ${rule.condition.op} ${rule.condition.value ?? ""}`
      : ""
    chunks.push({
      doc_id: `${policyId}:${ruleId}`,
      doc_type: "policy_rule",
      project_id: null,
      chunk_index: i + 1,
      chunk_total: (policy.rules?.length ?? 0) + 1,
      created_at: `${effectiveDate}T00:00:00Z`,
      updated_at: nowIso(),
      text: [
        `Policy rule: ${ruleId}`,
        `Action: ${rule.action}`,
        `Effect: ${rule.effect}`,
        condition,
        rule.reason ?? "",
      ]
        .filter(Boolean)
        .join(". "),
    })
  }

  return chunks
}

// ─────────────────────────────────────────────────────────────────────────────
// Markdown → chunks (split on H1-H3 headings)

function markdownChunks(filePath, docType = "adr") {
  const raw = readFileSync(filePath, "utf8")
  const fileName = basename(filePath, extname(filePath))

  // Split on headings
  const sections = raw.split(/(?=^#{1,3}\s)/m).filter((s) => s.trim())
  if (!sections.length) {
    return [
      {
        doc_id: `${fileName}:0`,
        doc_type: docType,
        project_id: null,
        chunk_index: 0,
        chunk_total: 1,
        created_at: nowIso(),
        updated_at: nowIso(),
        text: raw.slice(0, 2000),
      },
    ]
  }

  return sections.map((section, i) => {
    const headingMatch = SECTION_HEADING_RE.exec(section)
    const heading = headingMatch?.[1] ?? `${fileName} section ${i}`
    return {
      doc_id: `${fileName}:${i}`,
      doc_type: docType,
      project_id: null,
      chunk_index: i,
      chunk_total: sections.length,
      created_at: nowIso(),
      updated_at: nowIso(),
      text: `${heading}. ${section.replace(/^#{1,3}\s+.+\n/, "").trim()}`.slice(0, 2000),
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────

function collectSources() {
  const sources = []

  // Policy JSON files in policy/
  const policyDir = join(WORKSPACE_ROOT, "policy")
  if (existsSync(policyDir)) {
    for (const f of readdirSync(policyDir)) {
      if (f.endsWith(".json") && !f.includes("schema")) {
        sources.push({ type: "policy_json", path: join(policyDir, f) })
      }
    }
  }

  // ADR markdown files in docs/adr/ or docs/decisions/
  for (const adrDir of ["docs/adr", "docs/decisions"]) {
    const dir = join(WORKSPACE_ROOT, adrDir)
    if (existsSync(dir)) {
      for (const f of readdirSync(dir)) {
        if (f.endsWith(".md")) {
          sources.push({ type: "adr", path: join(dir, f) })
        }
      }
    }
  }

  // README policy sections (the main README)
  const readme = join(WORKSPACE_ROOT, "README.md")
  if (existsSync(readme)) {
    sources.push({ type: "readme", path: readme })
  }

  return sources
}

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  let lancedb
  try {
    lancedb = await import("@lancedb/lancedb")
  } catch {
    console.error("ERROR: @lancedb/lancedb is not installed.")
    console.error("       Run: npm install @lancedb/lancedb")
    process.exit(1)
  }

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

  const sources = collectSources()
  if (!sources.length) {
    console.log("No policy documents or ADRs found. Nothing to index.")
    console.log(`  Searched: ${WORKSPACE_ROOT}/policy/, docs/adr/, docs/decisions/, README.md`)
    return
  }

  console.log(`Found ${sources.length} source(s) to index into '${TABLE_NAME}'...`)

  const allChunks = []
  for (const src of sources) {
    try {
      let chunks
      if (src.type === "policy_json") {
        chunks = policyJsonChunks(src.path)
        console.log(`  [policy_json] ${basename(src.path)}: ${chunks.length} chunks`)
      } else if (src.type === "adr") {
        chunks = markdownChunks(src.path, "adr")
        console.log(`  [adr] ${basename(src.path)}: ${chunks.length} chunks`)
      } else {
        chunks = markdownChunks(src.path, "readme")
        console.log(`  [readme] ${basename(src.path)}: ${chunks.length} chunks`)
      }
      allChunks.push(...chunks)
    } catch (err) {
      console.warn(`  [warn] Skipped ${src.path}: ${err.message}`)
    }
  }

  if (!allChunks.length) {
    console.log("No chunks produced. Nothing to write.")
    return
  }

  // Upsert: drop + recreate for idempotency (policy corpus is small)
  const tableNames = await conn.tableNames()
  let table
  if (tableNames.includes(TABLE_NAME) && !args.reset) {
    table = await conn.openTable(TABLE_NAME)
    await table.add(allChunks)
    console.log(`Appended ${allChunks.length} chunks to existing table '${TABLE_NAME}'.`)
  } else {
    table = await conn.createTable(TABLE_NAME, allChunks)
    console.log(`Created table '${TABLE_NAME}' with ${allChunks.length} chunks.`)
  }

  // Create FTS index — best-effort
  try {
    if (typeof lancedb.Index?.fts === "function") {
      await table.createIndex("text", { config: lancedb.Index.fts() })
      console.log("FTS index created on 'text' column.")
    }
  } catch {
    // Silently skip — search still works without FTS index via table scan
  }

  console.log(`Done. ${allChunks.length} total chunks indexed into '${TABLE_NAME}'.`)
}

main().catch((err) => {
  console.error("Policy indexing failed:", err.message)
  process.exit(1)
})
