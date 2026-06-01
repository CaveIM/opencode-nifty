import assert from "node:assert/strict"
import { afterEach, beforeEach, test } from "node:test"
import { ragContextForTool, buildRagQuery, searchIndex } from "../plugin/rag.mjs"
import { NiftyPlugin } from "../plugin/nifty.js"

const originalEnv = { ...process.env }

beforeEach(() => {
  process.env.NIFTY_ACCESS_TOKEN = "test-token"
  process.env.NIFTY_BOOTSTRAP_REQUIRED = "false"
  process.env.NIFTY_AUTOCONTEXT_ENABLED = "false"
  process.env.NIFTY_AUTOPOLICY_ENABLED = "false"
  process.env.NIFTY_RAG_ENABLED = "false"
})

afterEach(() => {
  process.env = { ...originalEnv }
})

// ── Test 1: search error returns empty arrays, never throws ───────────────────

test("RAG: searchFn error returns empty arrays — tool execution is never blocked", async () => {
  const throwing = async () => {
    throw new Error("LanceDB connection failed")
  }
  const result = await ragContextForTool("nifty_update_task", { task_id: "t1" }, {
    _openFn: async () => ({}), // non-null table to reach search step
    _searchFn: throwing,
  })
  assert.deepEqual(result, { historical_context: [], policy_citations: [] })
})

// ── Test 2: timeout returns empty arrays within the deadline ──────────────────

test("RAG: search timeout returns empty arrays — resolves within deadline", async () => {
  const hanging = () => new Promise(() => {}) // never resolves
  const start = Date.now()
  const result = await ragContextForTool("nifty_update_task", {}, {
    timeoutMs: 80,
    _openFn: async () => ({}),
    _searchFn: hanging,
  })
  const elapsed = Date.now() - start
  assert.deepEqual(result, { historical_context: [], policy_citations: [] })
  assert.ok(elapsed < 500, `should resolve within 500ms, took ${elapsed}ms`)
})

// ── Test 3: null table (no index built yet) returns empty arrays ──────────────

test("RAG: null table (index not yet built) returns empty arrays without crash", async () => {
  // _openFn returns null to simulate missing LanceDB index
  // searchIndex (the real default) handles null table by returning []
  const result = await ragContextForTool("nifty_create_task", { name: "implement auth" }, {
    _openFn: async () => null,
    _searchFn: searchIndex, // real searchIndex correctly short-circuits on null
  })
  assert.deepEqual(result, { historical_context: [], policy_citations: [] })
})

// ── Test 4: NIFTY_RAG_ENABLED=false — maybeInjectRagContext never calls RAG ───

test("RAG: NIFTY_RAG_ENABLED=false means maybeInjectRagContext skips ragContextForTool", async () => {
  process.env.NIFTY_RAG_ENABLED = "false"
  const { maybeInjectRagContext } = NiftyPlugin.__test
  let ragCalled = false
  const mockRagFn = async () => {
    ragCalled = true
    return { historical_context: [], policy_citations: [] }
  }
  const ctx = { abort: new AbortController().signal, metadata() {}, ask() {} }
  await maybeInjectRagContext("nifty_update_task", {}, ctx, {}, mockRagFn)
  assert.equal(ragCalled, false, "ragContextForTool must not be called when NIFTY_RAG_ENABLED=false")
})

// ── Test 5: partial failure — task succeeds, policy index fails ───────────────

test("RAG: partial failure returns task results and empty policy citations", async () => {
  const taskResults = [
    { text: "prior auth implementation decision", doc_id: "t1", doc_type: "task", score: 0.9 },
  ]
  // _openFn returns a sentinel object whose tableName drives behavior in _searchFn
  const partialOpenFn = async (_indexPath, tableName) => ({ tableName })
  const partialSearchFn = async (table) => {
    if (table.tableName === "nifty-policy") throw new Error("policy index unavailable")
    return taskResults
  }
  const result = await ragContextForTool("nifty_update_task", { task_id: "t1" }, {
    _openFn: partialOpenFn,
    _searchFn: partialSearchFn,
  })
  assert.deepEqual(result.historical_context, taskResults)
  assert.deepEqual(result.policy_citations, [])
})

// ── Test 6: buildRagQuery constructs a useful query string ────────────────────

test("RAG: buildRagQuery includes tool name, task name, and task_id", () => {
  const q = buildRagQuery("nifty_update_task", { name: "Fix auth bug", task_id: "t42" })
  assert.ok(q.includes("nifty update task"), `expected tool name in query: ${q}`)
  assert.ok(q.includes("Fix auth bug"), `expected task name in query: ${q}`)
  assert.ok(q.includes("task t42"), `expected task_id in query: ${q}`)
})
