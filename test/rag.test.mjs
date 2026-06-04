import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { afterEach, beforeEach, test } from "node:test"
import { promisify } from "node:util"
import {
  ragContextForTool,
  buildRagQuery,
  buildRagQueries,
  clearRagTableCache,
  ragDiagnostics,
  searchIndex,
} from "../plugin/rag.mjs"
import { NiftyPlugin } from "../plugin/nifty.js"

const execFileAsync = promisify(execFile)

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
  clearRagTableCache()
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

test("RAG: fast search clears timeout timer so child process exits immediately", async () => {
  const script = `
    import { ragContextForTool } from ${JSON.stringify(new URL("../plugin/rag.mjs", import.meta.url).href)};
    await ragContextForTool("nifty_get_task", {}, {
      timeoutMs: 2000,
      _openFn: async () => ({}),
      _searchFn: async () => [],
    });
    console.log("done");
  `

  const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "-e", script], {
    timeout: 1500,
    maxBuffer: 1024 * 1024,
  })
  assert.match(stdout, /done/)
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

test("RAG: default enabled means maybeInjectRagContext calls ragContextForTool", async () => {
  delete process.env.NIFTY_RAG_ENABLED
  const { maybeInjectRagContext } = NiftyPlugin.__test
  const metadataWrites = []
  let ragCalled = false
  const mockRagFn = async (toolName, args) => {
    ragCalled = true
    assert.equal(toolName, "nifty_update_task")
    assert.deepEqual(args, { task_id: "t1" })
    return {
      historical_context: [{ text: "prior task context", doc_id: "task-1" }],
      policy_citations: [],
    }
  }
  const ctx = {
    abort: new AbortController().signal,
    metadata(key, value) {
      metadataWrites.push({ key, value })
    },
    ask() {},
  }

  await maybeInjectRagContext("nifty_update_task", { task_id: "t1" }, ctx, {}, mockRagFn)

  assert.equal(ragCalled, true, "RAG should be enabled by default")
  assert.equal(metadataWrites[0].key, "nifty:auto_context")
  assert.equal(metadataWrites[0].value.title, "Nifty RAG context")
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
  assert.equal(result.historical_context.length, 1)
  assert.equal(result.historical_context[0].text, taskResults[0].text)
  assert.equal(result.historical_context[0].doc_id, taskResults[0].doc_id)
  assert.equal(result.historical_context[0].source_table, "nifty-tasks")
  assert.deepEqual(result.policy_citations, [])
})

// ── Test 6: buildRagQuery constructs a useful query string ────────────────────

test("RAG: buildRagQuery strips nifty_ prefix and includes task_id and name", () => {
  const q = buildRagQuery("nifty_update_task", { name: "Fix auth bug", task_id: "t42" })
  // Tool label: prefix stripped, underscores removed
  assert.ok(q.includes("update task"), `expected stripped tool label in query: ${q}`)
  assert.ok(!q.startsWith("nifty "), `should not start with 'nifty ': ${q}`)
  assert.ok(q.includes("Fix auth bug"), `expected task name in query: ${q}`)
  assert.ok(q.includes("task t42"), `expected task_id in query: ${q}`)
})

// ── Test 7: buildRagQuery deduplicates identical tokens ───────────────────────

test("RAG: buildRagQuery deduplicates repeated tokens case-insensitively", () => {
  // title and name are the same value — should contribute only one part to the query
  const q = buildRagQuery("nifty_create_task", { name: "auth bug", title: "Auth Bug" })
  const parts = q.split(". ")
  const authBugParts = parts.filter((p) => p.toLowerCase() === "auth bug")
  assert.equal(authBugParts.length, 1, `"auth bug" / "Auth Bug" should appear as exactly one part: ${q}`)
})

// ── Test 8: buildRagQuery includes all semantic fields ────────────────────────

test("RAG: buildRagQuery includes message, content, status, and project_id", () => {
  const q = buildRagQuery("nifty_create_comment", {
    task_id: "MBC-1",
    project_id: "PROJ-X",
    message: "Deployed hotfix",
    status: "done",
  })
  assert.ok(q.includes("task MBC-1"), `task_id: ${q}`)
  assert.ok(q.includes("project PROJ-X"), `project_id: ${q}`)
  assert.ok(q.includes("Deployed hotfix"), `message: ${q}`)
  assert.ok(q.includes("done"), `status: ${q}`)
})

// ── Test 9: buildRagQuery truncates excessively long description fields ────────

test("RAG: buildRagQuery truncates description at 400 chars", () => {
  const longDesc = "x".repeat(1000)
  const q = buildRagQuery("nifty_create_task", { name: "short", description: longDesc })
  // The description portion should not exceed 400 chars
  const parts = q.split(". ")
  const descPart = parts.find((p) => p.startsWith("x"))
  assert.ok(descPart, "description should be present in query")
  assert.ok(descPart.length <= 400, `description portion should be truncated: ${descPart.length} chars`)
})

// ── Test 10: buildRagQuery returns non-empty string for minimal args ──────────

test("RAG: buildRagQuery returns non-empty string even with empty args", () => {
  const q = buildRagQuery("nifty_health_check", {})
  assert.ok(typeof q === "string" && q.length > 0, `expected non-empty string: ${JSON.stringify(q)}`)
  assert.ok(q.includes("health check"), `expected tool label: ${q}`)
})

test("RAG: query fanout includes identifiers, semantic text, and nested delivery evidence", () => {
  const queries = buildRagQueries("nifty_prepare_task_for_delivery", {
    task_id: "MBC-462",
    project_id: "mobile-app",
    name: "Optimize Codex RAG",
    delivery_evidence: {
      red_proof: "regression failed before cache hardening",
      green_proof: "node --test passes after fanout search",
      sad_path_proof: "gateway outage fails closed",
    },
    files: ["plugin/rag.mjs", "scripts/index-nifty-tasks.mjs"],
  }, { maxQueries: 4, maxQueryChars: 260 })

  assert.ok(queries.length >= 3, `expected multiple fanout queries: ${JSON.stringify(queries)}`)
  assert.ok(queries.every((query) => query.length <= 260), `expected bounded queries: ${JSON.stringify(queries)}`)
  assert.ok(queries.some((query) => query.includes("task MBC-462")), `expected task identifier query: ${queries.join(" | ")}`)
  assert.ok(queries.some((query) => query.includes("Optimize Codex RAG")), `expected semantic query: ${queries.join(" | ")}`)
  assert.ok(queries.some((query) => query.includes("regression failed before cache hardening")), `expected nested evidence query: ${queries.join(" | ")}`)
})

test("RAG: fanout search dedupes results, bounds text, and annotates source metadata", async () => {
  const searched = []
  const longText = "historical decision ".repeat(120)
  const result = await ragContextForTool("nifty_update_task", {
    task_id: "MBC-462",
    name: "Optimize RAG",
  }, {
    taskLimit: 3,
    policyLimit: 2,
    maxResultTextChars: 80,
    maxQueries: 3,
    _openFn: async (_indexPath, tableName) => ({ tableName }),
    _searchFn: async (table, query) => {
      searched.push({ tableName: table.tableName, query })
      if (table.tableName === "nifty-tasks" && query.includes("MBC-462")) {
        return [
          { text: longText, doc_id: "task-1", doc_type: "task", chunk_index: 0, score: 0.9 },
          { text: longText, doc_id: "task-1", doc_type: "task", chunk_index: 0, score: 0.8 },
        ]
      }
      if (table.tableName === "nifty-tasks" && query.includes("Optimize RAG")) {
        return [
          { text: "second relevant task", doc_id: "task-2", doc_type: "task", chunk_index: 0, score: 0.7 },
        ]
      }
      if (table.tableName === "nifty-policy") {
        return [
          { text: "policy citation", doc_id: "policy-1", doc_type: "policy_rule", chunk_index: 0, score: 0.5 },
        ]
      }
      return []
    },
  })

  assert.ok(searched.length > 2, `expected multi-query fanout searches: ${JSON.stringify(searched)}`)
  assert.equal(result.historical_context.length, 2)
  assert.ok(result.historical_context[0].text.length <= 120)
  assert.equal(result.historical_context[0].source_table, "nifty-tasks")
  assert.equal(result.historical_context[0].rank, 1)
  assert.equal(result.policy_citations.length, 1)
  assert.equal(result.policy_citations[0].source_table, "nifty-policy")
})

test("RAG: table cache reuses open table promises within TTL", async () => {
  clearRagTableCache()
  let openCount = 0
  const options = {
    cacheTtlMs: 60_000,
    _openFn: async (_indexPath, tableName) => {
      openCount++
      return { tableName }
    },
    _searchFn: async () => [],
  }

  await ragContextForTool("nifty_get_task", { task_id: "MBC-462" }, options)
  await ragContextForTool("nifty_get_task", { task_id: "MBC-462" }, options)

  assert.equal(openCount, 2, "two tables should be opened once each and reused on the second call")
})

test("RAG: diagnostics reports config, table availability, and cache state", async () => {
  clearRagTableCache()
  const result = await ragDiagnostics({
    enabled: true,
    cacheTtlMs: 60_000,
    _openFn: async (_indexPath, tableName) => (tableName === "nifty-tasks" ? { tableName } : null),
  })

  assert.equal(result.enabled, true)
  assert.equal(result.tables["nifty-tasks"].available, true)
  assert.equal(result.tables["nifty-policy"].available, false)
  assert.ok(result.cache.entries >= 1)
  assert.equal(result.config.cache_ttl_ms, 60_000)
})

test("RAG: diagnostics default to enabled unless explicitly disabled", async () => {
  delete process.env.NIFTY_RAG_ENABLED
  const enabled = await ragDiagnostics({
    _openFn: async () => null,
  })
  process.env.NIFTY_RAG_ENABLED = "false"
  const disabled = await ragDiagnostics({
    _openFn: async () => null,
  })

  assert.equal(enabled.enabled, true)
  assert.equal(disabled.enabled, false)
})
