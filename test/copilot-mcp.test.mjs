import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, test } from "node:test"
import {
  activateMcpProgressState,
  buildMcpInputSchema,
  buildMcpToolCatalog,
  createMcpExecutionContext,
  createMcpProgressState,
  detectMcpWorktreeProgress,
  extractMcpTaskID,
  loadMcpActiveTaskForContext,
  loadNiftyPlugin,
  loadNiftyTools,
  persistMcpActiveTask,
  readGitWorktreeSnapshot,
  runNiftyTool,
  tickMcpProgressObserver,
} from "../mcp/mcp-server.mjs"

const originalEnv = { ...process.env }

beforeEach(() => {
  process.env = { ...originalEnv }
})

afterEach(() => {
  process.env = { ...originalEnv }
})

test("loads full Nifty tool catalog for MCP", async () => {
  const tools = await loadNiftyTools()
  const names = Object.keys(tools)

  assert.ok(names.length >= 58)
  assert.ok(names.includes("nifty_health_check"))
  assert.ok(names.includes("nifty_create_task"))
})

test("exports JSON schema for Nifty tool args", async () => {
  const tools = await loadNiftyTools()
  const schema = buildMcpInputSchema(tools.nifty_create_task.args)

  assert.equal(schema.type, "object")
  assert.equal(schema.properties.name.type, "string")
  assert.ok(schema.required.includes("name"))
  assert.ok(schema.required.includes("task_group_id"))
})

test("builds MCP catalog entries for every Nifty tool", async () => {
  const tools = await loadNiftyTools()
  const catalog = buildMcpToolCatalog(tools)

  assert.equal(catalog.length, Object.keys(tools).length)
  const health = catalog.find((entry) => entry.name === "nifty_health_check")

  assert.ok(health)
  assert.equal(typeof health.description, "string")
  assert.equal(health.inputSchema.type, "object")
})

test("runs tool executions with a MCP default context", async () => {
  const tools = await loadNiftyTools()
  const context = createMcpExecutionContext({
    directory: process.cwd(),
    metadataEntries: { session: "mcp-test" },
  })

  const output = await runNiftyTool(tools, "nifty_recommended_workflow", {}, context)
  const parsed = JSON.parse(output)

  assert.equal(Array.isArray(parsed.statuses), true)
  assert.equal(parsed.statuses.length > 0, true)
  assert.equal(typeof parsed.config_snippet, "object")
})

test("runNiftyTool blocks MCP task completion without explicit close confirmation", async () => {
  process.env.NIFTY_BOOTSTRAP_REQUIRED = "false"
  process.env.NIFTY_ACCESS_TOKEN = "test-token"
  process.env.NIFTY_POLICY_INLINE = JSON.stringify({
    version: 1,
    default_effect: "allow",
    automation: {
      enabled: true,
      parent_tasks: { auto_complete_when_subtasks_complete: false },
      completion: { require_explicit_close_trigger: true },
      progress_comments: {
        enabled: true,
        milestones: ["done"],
      },
    },
    rules: [],
  })

  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))
    calls.push({ path: requestURL.pathname, method: options.method || "GET", body: options.body })

    if (requestURL.pathname === "/api/v1.0/tasks/MBC-462/complete" && options.method === "POST") {
      return Response.json({ ok: true })
    }
    if (requestURL.pathname === "/api/v1.0/messages" && options.method === "POST") {
      return Response.json({ id: "comment-1" }, { status: 201 })
    }

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await loadNiftyPlugin()
  const context = createMcpExecutionContext({ metadataEntries: { session: "mbc-462" } })

  await assert.rejects(
    () => runNiftyTool(plugin, "nifty_complete_task", { task_id: "MBC-462", completed: true }, context),
    /close_confirmation.*close MBC-462/i,
  )

  assert.equal(calls.some((call) => call.path === "/api/v1.0/tasks/MBC-462/complete" && call.method === "POST"), false)
  assert.equal(calls.some((call) => call.path === "/api/v1.0/messages" && call.method === "POST"), false)
})

test("runNiftyTool dispatches plugin hooks after confirmed MCP task completion", async () => {
  process.env.NIFTY_BOOTSTRAP_REQUIRED = "false"
  process.env.NIFTY_ACCESS_TOKEN = "test-token"
  process.env.NIFTY_POLICY_INLINE = JSON.stringify({
    version: 1,
    default_effect: "allow",
    automation: {
      enabled: true,
      parent_tasks: { auto_complete_when_subtasks_complete: false },
      completion: { require_explicit_close_trigger: true },
      progress_comments: {
        enabled: true,
        milestones: ["done"],
      },
    },
    rules: [],
  })

  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))
    calls.push({ path: requestURL.pathname, method: options.method || "GET", body: options.body })

    if (requestURL.pathname === "/api/v1.0/tasks/MBC-462/complete" && options.method === "POST") {
      return Response.json({ ok: true })
    }
    if (requestURL.pathname === "/api/v1.0/messages" && options.method === "POST") {
      return Response.json({ id: "comment-1" }, { status: 201 })
    }

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await loadNiftyPlugin()
  const context = createMcpExecutionContext({ metadataEntries: { session: "mbc-462" } })
  await runNiftyTool(
    plugin,
    "nifty_complete_task",
    { task_id: "MBC-462", completed: true, close_confirmation: "close MBC-462" },
    context,
  )

  const messagePost = calls.find((call) => call.path === "/api/v1.0/messages" && call.method === "POST")
  assert.ok(messagePost, "expected automation comment post")
  const postedText = JSON.parse(messagePost.body).text
  assert.match(postedText, /^🤖 McBotFace/)
  assert.match(postedText, /Task marked complete/i)
})

test("detectMcpWorktreeProgress reports every new dirty worktree signature", () => {
  const state = createMcpProgressState({ taskID: "MBC-462" })
  const clean = { dirtyFiles: [], head: "a", aheadCount: 0 }
  const firstChange = { dirtyFiles: ["M plugin/nifty.js"], head: "a", aheadCount: 0 }
  const secondChange = { dirtyFiles: ["M plugin/nifty.js", "M mcp/mcp-server.mjs"], head: "a", aheadCount: 0 }

  assert.deepEqual(detectMcpWorktreeProgress(state, clean), [])
  assert.deepEqual(detectMcpWorktreeProgress(state, firstChange).map((event) => event.type), ["worktree_changed"])
  assert.deepEqual(detectMcpWorktreeProgress(state, firstChange), [])
  assert.deepEqual(detectMcpWorktreeProgress(state, secondChange).map((event) => event.type), ["worktree_changed"])
})

test("detectMcpWorktreeProgress emits worktree_changed when observer starts on a dirty worktree", () => {
  const state = createMcpProgressState({ taskID: "MBC-462" })
  const startupDirty = { dirtyFiles: ["M docs/rag-architecture.md"], head: "a", aheadCount: 0 }

  const firstEvents = detectMcpWorktreeProgress(state, startupDirty)
  assert.deepEqual(firstEvents.map((event) => event.type), ["worktree_changed"])
  assert.equal(firstEvents[0].signature.length > 0, true)

  const secondEvents = detectMcpWorktreeProgress(state, startupDirty)
  assert.deepEqual(secondEvents, [])
})

test("readGitWorktreeSnapshot preserves porcelain paths for unstaged and staged files", async () => {
  const snapshot = await readGitWorktreeSnapshot(process.cwd(), {
    runGit: async (_worktree, args) => {
      const command = args.join(" ")
      if (command === "status --porcelain=v1") return " M README.md\nM  mcp/mcp-server.mjs\n?? scripts/install-codex.sh\n"
      if (command === "rev-parse HEAD") return "abc123"
      if (command === "rev-parse --abbrev-ref HEAD") return "dev-tony"
      if (command === "rev-list --count @{u}..HEAD") return "0"
      if (command.startsWith("diff")) return "diff"
      return ""
    },
  })

  assert.deepEqual(snapshot.dirtyFiles, ["M README.md", "M mcp/mcp-server.mjs", "?? scripts/install-codex.sh"])
})

test("extractMcpTaskID prefers internal task id from full-context output over nice id args", () => {
  const output = JSON.stringify({ task: { id: "eves6NhQAe", nice_id: "MBC-462" } })

  assert.equal(extractMcpTaskID("nifty_get_task_full_context", { task_id: "MBC-462" }, output), "eves6NhQAe")
})

test("extractMcpTaskID prefers explicit task args over ambiguous generic output id", () => {
  const commentOutput = JSON.stringify({ id: "comment-abc-123" })

  assert.equal(extractMcpTaskID("nifty_create_comment", { task_id: "MBC-462" }, commentOutput), "MBC-462")
})

test("activateMcpProgressState keeps only the latest task active per session and worktree", () => {
  const states = new Map()
  const activeKeys = new Map()
  const context = createMcpExecutionContext({ directory: "/repo", worktree: "/repo" })

  const first = activateMcpProgressState(states, activeKeys, { sessionID: "s1", taskID: "task-a", context })
  const second = activateMcpProgressState(states, activeKeys, { sessionID: "s1", taskID: "task-b", context })

  assert.notEqual(first.key, second.key)
  assert.equal(states.has(first.key), false)
  assert.equal(states.has(second.key), true)
  assert.equal(second.state.taskID, "task-b")
})

test("persistMcpActiveTask lets a restarted MCP server recover the active task for the worktree", () => {
  const dir = mkdtempSync(join(tmpdir(), "nifty-active-task-"))
  const statePath = join(dir, "active-task.json")
  const context = createMcpExecutionContext({ directory: "/repo", worktree: "/repo" })

  persistMcpActiveTask({ sessionID: "s1", taskID: "task-a", context, filePath: statePath })
  persistMcpActiveTask({ sessionID: "s1", taskID: "task-b", context, filePath: statePath })

  assert.equal(loadMcpActiveTaskForContext({ sessionID: "s1", context, filePath: statePath }), "task-b")
})

test("persistMcpActiveTask prunes stale active task entries", () => {
  const dir = mkdtempSync(join(tmpdir(), "nifty-active-task-prune-"))
  const statePath = join(dir, "active-task.json")
  const context = createMcpExecutionContext({ directory: "/repo", worktree: "/repo" })
  const staleDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()

  writeFileSync(statePath, `${JSON.stringify({
    version: 1,
    entries: [
      { sessionID: "old-session", worktree: "/old-repo", taskID: "old-task", updatedAt: staleDate },
    ],
  }, null, 2)}\n`, "utf8")

  persistMcpActiveTask({ sessionID: "s1", taskID: "fresh-task", context, filePath: statePath })

  assert.equal(loadMcpActiveTaskForContext({ sessionID: "old-session", context: createMcpExecutionContext({ directory: "/old-repo", worktree: "/old-repo" }), filePath: statePath }), null)
  assert.equal(loadMcpActiveTaskForContext({ sessionID: "s1", context, filePath: statePath }), "fresh-task")
})

test("tickMcpProgressObserver posts an autonomous MCP progress comment when git state changes", async () => {
  const calls = []
  const context = createMcpExecutionContext({
    directory: process.cwd(),
    metadataEntries: { session: "mbc-462", mcp_tool: "nifty_get_task_full_context" },
  })
  const plugin = {
    tool: {
      nifty_create_comment: {
        args: {},
        async execute(args) {
          calls.push(args)
          return { id: "comment-1" }
        },
      },
    },
  }
  const state = createMcpProgressState({ taskID: "MBC-462" })
  const snapshots = [
    { dirtyFiles: [], head: "a", aheadCount: 0, branch: "dev-tony" },
    { dirtyFiles: ["M plugin/nifty.js", "A scripts/install-codex.sh"], head: "a", aheadCount: 0, branch: "dev-tony" },
  ]

  await tickMcpProgressObserver({
    plugin,
    taskID: "MBC-462",
    context,
    state,
    readSnapshot: async () => snapshots.shift(),
  })
  await tickMcpProgressObserver({
    plugin,
    taskID: "MBC-462",
    context,
    state,
    readSnapshot: async () => snapshots.shift(),
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].task_id, "MBC-462")
  assert.match(calls[0].text, /MCP autonomous progress update/i)
  assert.match(calls[0].text, /plugin\/nifty\.js/)
  assert.match(calls[0].text, /scripts\/install-codex\.sh/)
})

test("tickMcpProgressObserver posts a catch-up comment on first tick when worktree is already dirty", async () => {
  const calls = []
  const context = createMcpExecutionContext({
    directory: process.cwd(),
    metadataEntries: { session: "mbc-462", mcp_tool: "mcp_startup" },
  })
  const plugin = {
    tool: {
      nifty_create_comment: {
        args: {},
        async execute(args) {
          calls.push(args)
          return { id: "comment-1" }
        },
      },
    },
  }
  const state = createMcpProgressState({ taskID: "MBC-462" })

  await tickMcpProgressObserver({
    plugin,
    taskID: "MBC-462",
    context,
    state,
    readSnapshot: async () => ({
      dirtyFiles: ["M docs/rag-architecture.md"],
      head: "a",
      aheadCount: 0,
      branch: "dev-tony",
    }),
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].task_id, "MBC-462")
  assert.match(calls[0].text, /MCP autonomous progress update/i)
  assert.match(calls[0].text, /docs\/rag-architecture\.md/)
})
