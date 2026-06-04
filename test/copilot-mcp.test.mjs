import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawn } from "node:child_process"
import { afterEach, beforeEach, test } from "node:test"
import * as z from "zod"
import {
  activateMcpProgressState,
  buildMcpInputSchema,
  buildMcpToolCatalog,
  buildMcpPolicyGatewayPayload,
  callMcpPolicyGateway,
  createMcpExecutionContext,
  createMcpProgressState,
  detectMcpWorktreeProgress,
  extractMcpTaskID,
  isSensitiveNiftyTool,
  loadMcpActiveTaskForContext,
  loadNiftyPlugin,
  loadNiftyTools,
  mcpPolicyGatewayConfig,
  persistMcpActiveTask,
  readGitWorktreeSnapshot,
  runNiftyTool,
  tickMcpProgressObserver,
} from "../mcp/mcp-server.mjs"

const originalEnv = { ...process.env }
const originalFetch = globalThis.fetch

beforeEach(() => {
  process.env = { ...originalEnv }
})

afterEach(() => {
  process.env = { ...originalEnv }
  globalThis.fetch = originalFetch
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

    if (requestURL.pathname === "/api/v1.0/tasks/MBC-462" && (options.method || "GET") === "GET") {
      return Response.json({
        id: "MBC-462",
        nice_id: "MBC-462",
        name: "Parent task",
        project_id: "p1",
        task_group_id: "s1",
      })
    }
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

    if (requestURL.pathname === "/api/v1.0/tasks/MBC-462" && (options.method || "GET") === "GET") {
      return Response.json({
        id: "MBC-462",
        nice_id: "MBC-462",
        name: "Parent task",
        project_id: "p1",
        task_group_id: "s1",
      })
    }
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
  assert.match(postedText, /^🤖 Cave Updater/)
  assert.match(postedText, /Task marked complete/i)
})

test("runNiftyTool requires template for task_id comments", async () => {
  const plugin = {
    tool: {
      nifty_create_comment: {
        args: {
          task_id: z.string(),
          text: z.string(),
        },
        async execute() {
          throw new Error("local mutation should be blocked without a template")
        },
      },
    },
  }

  await assert.rejects(
    () => runNiftyTool(
      plugin,
      "nifty_create_comment",
      { task_id: "MBC-462", text: "Updated some files and finished." },
      createMcpExecutionContext(),
    ),
    /Missing or invalid sections:|Task-card update comments require a template/i,
  )
})

test("runNiftyTool accepts valid task comment template for task_id target", async () => {
  process.env.NIFTY_MCP_PROGRESS_POLL_ENABLED = "false"
  let localCalls = 0
  const plugin = {
    tool: {
      nifty_create_comment: {
        args: {
          task_id: z.string(),
          text: z.string(),
        },
        async execute() {
          localCalls += 1
          return "comment-posted"
        },
      },
    },
  }

  const output = await runNiftyTool(
    plugin,
    "nifty_create_comment",
    {
      task_id: "MBC-462",
      text: [
        "## What was done",
        "",
        "- Implemented fallback branch and tests.",
        "",
        "## Evidence / Tests",
        "",
        "- `npm test`",
        "",
        "## How to verify",
        "",
        "- Confirm the task card shows the expected status comment.",
      ].join("\n"),
    },
    createMcpExecutionContext(),
  )

  assert.equal(output, "comment-posted")
  assert.equal(localCalls, 1)
})

test("runNiftyTool keeps non-task comments permissive", async () => {
  process.env.NIFTY_MCP_PROGRESS_POLL_ENABLED = "false"
  let localCalls = 0
  const plugin = {
    tool: {
      nifty_create_comment: {
        args: {
          text: z.string(),
        },
        async execute() {
          localCalls += 1
          return "comment-posted"
        },
      },
    },
  }

  const output = await runNiftyTool(
    plugin,
    "nifty_create_comment",
    { text: "Plain status update for doc chat." },
    createMcpExecutionContext(),
  )

  assert.equal(output, "comment-posted")
  assert.equal(localCalls, 1)
})

test("policy gateway shadow mode audits sensitive tools then runs local execution", async () => {
  process.env.NIFTY_POLICY_GATEWAY_URL = "https://gateway.example"
  process.env.NIFTY_POLICY_GATEWAY_TOKEN = "gateway-token"
  process.env.NIFTY_POLICY_GATEWAY_MODE = "shadow"

  const calls = []
  let localCalls = 0
  globalThis.fetch = async (url, options = {}) => {
    calls.push({
      url: String(url),
      authorization: options.headers.authorization,
      body: JSON.parse(options.body),
    })
    return Response.json({ decision: "allow", audit_id: "audit-shadow" })
  }

  const plugin = {
    tool: {
      nifty_create_task: {
        args: {},
        async execute() {
          localCalls += 1
          return "local-ok"
        },
      },
    },
  }

  const context = createMcpExecutionContext({ metadataEntries: { session: "shadow-session" } })
  const output = await runNiftyTool(plugin, "nifty_create_task", {}, context, { callID: "call-1" })

  assert.equal(output, "local-ok")
  assert.equal(localCalls, 1)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, "https://gateway.example/v1/tool-calls")
  assert.equal(calls[0].authorization, "Bearer gateway-token")
  assert.equal(calls[0].body.mode, "shadow")
  assert.equal(calls[0].body.tool, "nifty_create_task")
})

test("policy gateway enforce mode skips local mutation and returns gateway text", async () => {
  process.env.NIFTY_POLICY_GATEWAY_URL = "https://gateway.example"
  process.env.NIFTY_POLICY_GATEWAY_MODE = "enforce"

  let localCalls = 0
  globalThis.fetch = async () => Response.json({
    decision: "allow",
    audit_id: "audit-enforce",
    result: { text: "gateway-ok" },
  })

  const plugin = {
    tool: {
      nifty_update_task: {
        args: {},
        async execute() {
          localCalls += 1
          throw new Error("local mutation should not run")
        },
      },
    },
  }

  const output = await runNiftyTool(plugin, "nifty_update_task", {}, createMcpExecutionContext())

  assert.equal(output, "gateway-ok")
  assert.equal(localCalls, 0)
})

test("policy gateway enforce mode fails closed on gateway denial", async () => {
  process.env.NIFTY_POLICY_GATEWAY_URL = "https://gateway.example"
  process.env.NIFTY_POLICY_GATEWAY_MODE = "enforce"

  let localCalls = 0
  globalThis.fetch = async () => Response.json({
    decision: "deny",
    audit_id: "audit-deny",
    reason: "missing delivery evidence",
    violations: [{ id: "delivery-proof", reason: "green proof required" }],
  })

  const plugin = {
    tool: {
      nifty_move_task_to_status: {
        args: {},
        async execute() {
          localCalls += 1
          return "local"
        },
      },
    },
  }

  await assert.rejects(
    () => runNiftyTool(plugin, "nifty_move_task_to_status", {}, createMcpExecutionContext()),
    /Policy gateway denied nifty_move_task_to_status: missing delivery evidence/i,
  )
  assert.equal(localCalls, 0)
})

test("policy gateway enforce mode fails closed on timeout and malformed response", async () => {
  process.env.NIFTY_POLICY_GATEWAY_URL = "https://gateway.example"
  process.env.NIFTY_POLICY_GATEWAY_MODE = "enforce"
  process.env.NIFTY_POLICY_GATEWAY_TIMEOUT_MS = "1"

  await assert.rejects(
    () => callMcpPolicyGateway({
      toolName: "nifty_delete_task",
      args: {},
      context: createMcpExecutionContext(),
      sessionID: "timeout-session",
    }, {
      fetchFn: (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("aborted")))
      }),
    }),
    /Policy gateway failed before executing nifty_delete_task: aborted/i,
  )

  process.env.NIFTY_POLICY_GATEWAY_TIMEOUT_MS = "1000"
  await assert.rejects(
    () => callMcpPolicyGateway({
      toolName: "nifty_delete_task",
      args: {},
      context: createMcpExecutionContext(),
      sessionID: "malformed-session",
    }, {
      fetchFn: async () => new Response("{not-json", { status: 200 }),
    }),
    /Policy gateway failed before executing nifty_delete_task: Policy gateway returned malformed JSON/i,
  )
})

test("policy gateway bypasses read-only tools even in enforce mode", async () => {
  process.env.NIFTY_POLICY_GATEWAY_URL = "https://gateway.example"
  process.env.NIFTY_POLICY_GATEWAY_MODE = "enforce"

  globalThis.fetch = async () => {
    throw new Error("gateway should not be called")
  }

  const plugin = {
    tool: {
      nifty_health_check: {
        args: {},
        async execute() {
          return "healthy"
        },
      },
    },
  }

  const output = await runNiftyTool(plugin, "nifty_health_check", {}, createMcpExecutionContext())

  assert.equal(output, "healthy")
})

test("policy gateway sensitive tool patterns and idempotency key are stable", () => {
  for (const toolName of [
    "nifty_create_task",
    "nifty_run_task",
    "nifty_update_task",
    "nifty_delete_status",
    "nifty_move_task_to_status",
    "nifty_complete_task",
    "nifty_complete_child_task",
    "nifty_archive_task",
    "nifty_clone_task",
    "nifty_attach_task_document",
    "nifty_link_tasks",
    "nifty_batch_capture_backlog_items",
    "nifty_prepare_task_for_delivery",
    "nifty_setup_recommended_workflow",
  ]) {
    assert.equal(isSensitiveNiftyTool(toolName), true, `${toolName} should be gateway-sensitive`)
  }
  assert.equal(isSensitiveNiftyTool("nifty_get_task"), false)
  assert.equal(isSensitiveNiftyTool("nifty_list_projects"), false)

  const context = createMcpExecutionContext({
    directory: "/repo",
    worktree: "/repo",
    metadataEntries: { session: "idempotency-session", active_task_id: "MBC-462" },
  })
  const first = buildMcpPolicyGatewayPayload({
    toolName: "nifty_update_task",
    args: { task_id: "MBC-462", name: "Fix auth" },
    context,
    sessionID: "idempotency-session",
    callID: "call-42",
  })
  const second = buildMcpPolicyGatewayPayload({
    toolName: "nifty_update_task",
    args: { task_id: "MBC-462", name: "Fix auth" },
    context,
    sessionID: "idempotency-session",
    callID: "call-42",
  })

  assert.equal(first.idempotency_key, second.idempotency_key)
  assert.equal(first.context.active_task_id, "MBC-462")
})

test("policy gateway config reads timeout from injected env", () => {
  const config = mcpPolicyGatewayConfig({
    NIFTY_POLICY_GATEWAY_MODE: "enforce",
    NIFTY_POLICY_GATEWAY_URL: "https://gateway.example",
    NIFTY_POLICY_GATEWAY_TOKEN: "token",
    NIFTY_POLICY_GATEWAY_TIMEOUT_MS: "1234",
  })

  assert.equal(config.mode, "enforce")
  assert.equal(config.url, "https://gateway.example")
  assert.equal(config.token, "token")
  assert.equal(config.timeoutMs, 1234)
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

test("persistMcpActiveTask keeps both entries when two MCP processes persist concurrently", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nifty-active-task-race-"))
  const writerPath = join(dir, "persist-writer.mjs")
  writeFileSync(
    writerPath,
    `
      import { setTimeout as wait } from "node:timers/promises"
      import { createMcpExecutionContext, persistMcpActiveTask } from ${JSON.stringify(new URL("../mcp/mcp-server.mjs", import.meta.url).href)}

      const [filePath, sessionID, taskID, startAt] = process.argv.slice(2)
      const context = createMcpExecutionContext({ directory: "/repo", worktree: "/repo" })
      while (Date.now() < Number(startAt)) await wait(1)
      persistMcpActiveTask({ sessionID, taskID, context, filePath })
    `,
    "utf8",
  )

  try {
    let missingRuns = 0

    for (let run = 0; run < 60; run++) {
      const statePath = join(dir, `active-task-${run}.json`)
      const startAt = String(Date.now() + 60)
      const writers = [
        spawn(process.execPath, [writerPath, statePath, "session-a", "task-a", startAt], { stdio: "ignore" }),
        spawn(process.execPath, [writerPath, statePath, "session-b", "task-b", startAt], { stdio: "ignore" }),
      ]

      await Promise.all(
        writers.map(
          (child) =>
            new Promise((resolve, reject) => {
              child.once("exit", (code) => {
                if (code === 0) {
                  resolve()
                  return
                }
                reject(new Error(`writer exited with ${code}`))
              })
            }),
        ),
      )

      const store = JSON.parse(readFileSync(statePath, "utf8"))
      const sessions = new Set((store.entries || []).map((entry) => entry.sessionID))
      if (!sessions.has("session-a") || !sessions.has("session-b")) {
        missingRuns++
      }
    }

    assert.equal(missingRuns, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("tickMcpProgressObserver does not post dirty-only autonomous progress comments", async () => {
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
    config: { enabled: true, testCommand: "" },
    readSnapshot: async () => snapshots.shift(),
  })
  const events = await tickMcpProgressObserver({
    plugin,
    taskID: "MBC-462",
    context,
    state,
    config: { enabled: true, testCommand: "" },
    readSnapshot: async () => snapshots.shift(),
  })

  assert.equal(events.length, 1)
  assert.equal(events[0].type, "worktree_changed")
  assert.equal(calls.length, 0)
})

test("tickMcpProgressObserver does not post dirty-only catch-up comments on first tick", async () => {
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

  const events = await tickMcpProgressObserver({
    plugin,
    taskID: "MBC-462",
    context,
    state,
    config: { enabled: true, testCommand: "" },
    readSnapshot: async () => ({
      dirtyFiles: ["M docs/rag-architecture.md"],
      head: "a",
      aheadCount: 0,
      branch: "dev-tony",
    }),
  })

  assert.equal(events.length, 1)
  assert.equal(events[0].type, "worktree_changed")
  assert.equal(calls.length, 0)
})

test("tickMcpProgressObserver posts when worktree change has passing verification command", async () => {
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
  const snapshots = [
    { dirtyFiles: [], head: "a", aheadCount: 0, branch: "dev-tony" },
    { dirtyFiles: ["M plugin/nifty.js"], head: "a", aheadCount: 0, branch: "dev-tony" },
  ]

  await tickMcpProgressObserver({
    plugin,
    taskID: "MBC-462",
    context,
    state,
    config: { enabled: true, testCommand: `${process.execPath} -e "console.log('green')"`, testTimeoutMs: 30000 },
    readSnapshot: async () => snapshots.shift(),
  })
  const events = await tickMcpProgressObserver({
    plugin,
    taskID: "MBC-462",
    context,
    state,
    config: { enabled: true, testCommand: `${process.execPath} -e "console.log('green')"`, testTimeoutMs: 30000 },
    readSnapshot: async () => snapshots.shift(),
  })

  assert.deepEqual(events.map((event) => event.type), ["worktree_changed"])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].task_id, "MBC-462")
  assert.match(calls[0].text, /passing verification command/i)
  assert.match(calls[0].text, /green/)
})

test("tickMcpProgressObserver posts repository sync comments when branch is no longer ahead", async () => {
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
  const snapshots = [
    { dirtyFiles: [], head: "a", aheadCount: 2, branch: "dev-tony" },
    { dirtyFiles: [], head: "b", aheadCount: 0, branch: "dev-tony" },
  ]

  await tickMcpProgressObserver({
    plugin,
    taskID: "MBC-462",
    context,
    state,
    config: { enabled: true, testCommand: "" },
    readSnapshot: async () => snapshots.shift(),
  })
  const events = await tickMcpProgressObserver({
    plugin,
    taskID: "MBC-462",
    context,
    state,
    config: { enabled: true, testCommand: "" },
    readSnapshot: async () => snapshots.shift(),
  })

  assert.deepEqual(events.map((event) => event.type), ["push"])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].task_id, "MBC-462")
  assert.match(calls[0].text, /repository sync/i)
})

test("tickMcpProgressObserver skips overlapping ticks for the same active state", async () => {
  const context = createMcpExecutionContext({
    directory: process.cwd(),
    metadataEntries: { session: "mbc-462", mcp_tool: "mcp_startup" },
  })
  const plugin = {
    tool: {
      nifty_create_comment: {
        args: {},
        async execute() {
          return { id: "comment-1" }
        },
      },
    },
  }
  const state = createMcpProgressState({ taskID: "MBC-462" })
  let reads = 0

  const readSnapshot = async () => {
    reads++
    await new Promise((resolve) => setTimeout(resolve, 20))
    return {
      dirtyFiles: ["M plugin/nifty.js"],
      head: "a",
      aheadCount: 0,
      branch: "dev-tony",
    }
  }

  await Promise.all([
    tickMcpProgressObserver({ plugin, taskID: "MBC-462", context, state, readSnapshot }),
    tickMcpProgressObserver({ plugin, taskID: "MBC-462", context, state, readSnapshot }),
  ])

  assert.equal(reads, 1)
})

test("readGitWorktreeSnapshot limits polling to lightweight git commands", async () => {
  const calls = []
  await readGitWorktreeSnapshot(process.cwd(), {
    runGit: async (_worktree, args) => {
      const command = args.join(" ")
      calls.push(command)
      if (command === "status --porcelain=v1") return " M README.md\n"
      if (command === "rev-parse HEAD") return "abc123"
      if (command === "rev-parse --abbrev-ref HEAD") return "dev-tony"
      if (command === "rev-list --count @{u}..HEAD") return "0"
      return ""
    },
  })

  assert.equal(calls.some((command) => command.startsWith("diff ")), false)
  assert.equal(calls.length, 4)
})
