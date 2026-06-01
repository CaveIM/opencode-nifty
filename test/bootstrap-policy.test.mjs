import assert from "node:assert/strict"
import { afterEach, beforeEach, test } from "node:test"
import { NiftyPlugin } from "../plugin/nifty.js"

const originalFetch = globalThis.fetch
const originalEnv = { ...process.env }

beforeEach(() => {
  process.env.NIFTY_ACCESS_TOKEN = "test-token"
  process.env.NIFTY_AUTOPOLICY_ENABLED = "false"
  process.env.NIFTY_AUTOCONTEXT_ENABLED = "false"
  process.env.NIFTY_BOOTSTRAP_REQUIRED = "true"
  process.env.NIFTY_POLICY_ALLOW_ANONYMOUS_READS = "true"
})

afterEach(() => {
  globalThis.fetch = originalFetch
  process.env = { ...originalEnv }
})

function context(overrides = {}) {
  return {
    abort: new AbortController().signal,
    directory: undefined,
    worktree: undefined,
    metadata() {},
    ask() {
      throw new Error("ask not supported in tests")
    },
    ...overrides,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Context Bootstrap Gate
// ─────────────────────────────────────────────────────────────────────────────

test("bootstrap gate blocks mutating tool call without prior context resolution", async () => {
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))
    if (requestURL.pathname.startsWith("/api/v1.0/tasks/t1") && (options.method || "GET") === "PUT") {
      return Response.json({ id: "t1" })
    }
    if (requestURL.pathname.startsWith("/api/v1.0/tasks/t1")) {
      return Response.json({ id: "t1", project_id: "p1", task_group_id: "s1" })
    }
    if (requestURL.pathname === "/api/v1.0/taskgroups") {
      return Response.json({ items: [{ id: "s1", name: "To Do" }] })
    }
    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  await assert.rejects(
    () => plugin.tool.nifty_update_task.execute({ task_id: "t1", name: "New Name" }, context()),
    /bootstrap.*context/i,
  )
})

test("bootstrap gate allows read-only tools without prior context resolution", async () => {
  globalThis.fetch = async (url) => {
    const requestURL = new URL(String(url))
    if (requestURL.pathname === "/api/v1.0/tasks/t1") {
      return Response.json({ id: "t1", name: "Test Task", project_id: "p1" })
    }
    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  const output = await plugin.tool.nifty_get_task.execute({ task_id: "t1" }, context())
  const parsed = JSON.parse(output)
  assert.equal(parsed.id, "t1")
})

test("bootstrap gate allows mutating tool after explicit full context resolution", async () => {
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))
    calls.push({ path: requestURL.pathname, method: options.method || "GET" })

    if (requestURL.pathname === "/api/v1.0/tasks/t1") {
      if ((options.method || "GET") === "PUT") return Response.json({ id: "t1", name: "New Name" })
      return Response.json({ id: "t1", name: "Original", project_id: "p1", task_group_id: "s1" })
    }
    if (requestURL.pathname === "/api/v1.0/tasks") {
      return Response.json({ tasks: [{ id: "t1", name: "Original", project_id: "p1", task_group_id: "s1" }], hasMore: false })
    }
    if (requestURL.pathname === "/api/v1.0/messages") {
      return Response.json({ items: [{ id: "m1", text: "comment" }] })
    }
    if (requestURL.pathname === "/api/v1.0/projects") {
      return Response.json({ projects: [{ id: "p1", name: "Project One", nice_id: "P1" }] })
    }
    if (requestURL.pathname === "/api/v1.0/taskgroups") {
      return Response.json({ items: [{ id: "s1", name: "In Progress" }] })
    }
    if (requestURL.pathname === "/api/v1.0/milestones") {
      return Response.json({ items: [], hasMore: false })
    }

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const bootstrapState = { resolvedTasks: new Set() }
  const plugin = await NiftyPlugin()

  // First resolve full context
  await plugin.tool.nifty_get_task_full_context.execute(
    { task_id: "t1" },
    context({ bootstrapState }),
  )

  // Now mutate should pass
  const output = await plugin.tool.nifty_update_task.execute(
    { task_id: "t1", name: "New Name" },
    context({ bootstrapState }),
  )
  const parsed = JSON.parse(output)
  assert.equal(parsed.task.id, "t1")
})

test("bootstrap gate hard-fails on project-scoped mutations without project context", async () => {
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))
    if (requestURL.pathname === "/api/v1.0/tasks" && options.method === "POST") {
      return Response.json({ id: "t2", name: "New Task" })
    }
    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  await assert.rejects(
    () => plugin.tool.nifty_create_task.execute(
      { task_group_id: "s1", name: "New Task", project_id: "p1" },
      context(),
    ),
    /bootstrap.*context/i,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// Central Policy-as-Code Enforcement
// ─────────────────────────────────────────────────────────────────────────────

test("policy module exposes evaluatePolicy with allow/deny result", () => {
  const { __test } = NiftyPlugin
  assert.ok(typeof __test.evaluatePolicy === "function", "evaluatePolicy must be exported")

  const result = __test.evaluatePolicy("nifty_update_task", { task_id: "t1" }, {
    rules: [{ action: "nifty_update_task", effect: "allow" }],
  })
  assert.equal(result.allowed, true)
  assert.ok(Array.isArray(result.matched_rules))
})

test("policy module denies explicitly forbidden actions", () => {
  const { __test } = NiftyPlugin
  const result = __test.evaluatePolicy("nifty_delete_task", { task_id: "t1" }, {
    rules: [{ action: "nifty_delete_task", effect: "deny", reason: "Deletions require manager approval." }],
  })
  assert.equal(result.allowed, false)
  assert.match(result.reason || result.matched_rules?.[0]?.reason || "", /manager/i)
})

test("policy module deny overrides allow when both match", () => {
  const { __test } = NiftyPlugin
  const result = __test.evaluatePolicy("nifty_delete_task", { task_id: "t1" }, {
    default_effect: "allow",
    rules: [
      { action: "*", effect: "allow" },
      { action: "nifty_delete_task", effect: "deny", reason: "Explicit deny wins." },
    ],
  })
  assert.equal(result.allowed, false)
})

test("policy module uses default_effect when no rule matches", () => {
  const { __test } = NiftyPlugin
  const denyDefault = __test.evaluatePolicy("nifty_unrecognized_tool", {}, {
    default_effect: "deny",
    rules: [],
  })
  assert.equal(denyDefault.allowed, false)

  const allowDefault = __test.evaluatePolicy("nifty_unrecognized_tool", {}, {
    default_effect: "allow",
    rules: [],
  })
  assert.equal(allowDefault.allowed, true)
})

test("policy module supports glob action patterns", () => {
  const { __test } = NiftyPlugin
  const result = __test.evaluatePolicy("nifty_delete_status", {}, {
    rules: [{ action: "nifty_delete_*", effect: "deny", reason: "No deletes in policy." }],
  })
  assert.equal(result.allowed, false)
})

test("policy module supports condition matching on args", () => {
  const { __test } = NiftyPlugin
  // Deny bulk deletes over threshold
  const blocked = __test.evaluatePolicy("nifty_delete_tasks", { task_ids: ["t1", "t2", "t3", "t4", "t5", "t6"] }, {
    rules: [{
      action: "nifty_delete_tasks",
      effect: "deny",
      condition: { arg: "task_ids", op: "count_gt", value: 5 },
      reason: "Bulk delete over 5 tasks requires manager approval.",
    }],
  })
  assert.equal(blocked.allowed, false)

  const allowed = __test.evaluatePolicy("nifty_delete_tasks", { task_ids: ["t1", "t2"] }, {
    rules: [{
      action: "nifty_delete_tasks",
      effect: "deny",
      condition: { arg: "task_ids", op: "count_gt", value: 5 },
      reason: "Bulk delete over 5 tasks requires manager approval.",
    }],
  })
  assert.equal(allowed.allowed, true)
})

test("policy is enforced at tool call boundary and hard-fails on deny", async () => {
  process.env.NIFTY_POLICY_PATH = "/dev/null"
  process.env.NIFTY_POLICY_INLINE = JSON.stringify({
    version: 1,
    default_effect: "allow",
    rules: [{ action: "nifty_delete_*", effect: "deny", reason: "Deletions are locked by company policy." }],
  })

  globalThis.fetch = async () => {
    throw new Error("Should not reach fetch")
  }

  const plugin = await NiftyPlugin()
  await assert.rejects(
    () => plugin.tool.nifty_delete_status.execute({ status_id: "s1" }, context()),
    /company policy/i,
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// Policy + Bootstrap composition
// ─────────────────────────────────────────────────────────────────────────────

test("policy block fires before bootstrap check — policy is authoritative first", async () => {
  process.env.NIFTY_POLICY_INLINE = JSON.stringify({
    version: 1,
    default_effect: "allow",
    rules: [{ action: "nifty_update_task", effect: "deny", reason: "Updates locked by policy." }],
  })

  globalThis.fetch = async () => { throw new Error("Should not reach API") }

  const plugin = await NiftyPlugin()
  await assert.rejects(
    () => plugin.tool.nifty_update_task.execute({ task_id: "t1", name: "x" }, context()),
    /locked by policy/i,
  )
})

test("policy audit log records every tool call result", () => {
  const { __test } = NiftyPlugin
  const log = []
  const policy = {
    version: 1,
    default_effect: "allow",
    rules: [],
  }

  __test.evaluatePolicy("nifty_get_task", { task_id: "t1" }, policy, { auditLog: log })
  __test.evaluatePolicy("nifty_delete_task", { task_id: "t1" }, policy, { auditLog: log })

  assert.equal(log.length, 2)
  assert.equal(log[0].tool, "nifty_get_task")
  assert.equal(log[0].allowed, true)
  assert.ok(log[0].timestamp)
})
