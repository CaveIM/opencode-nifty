import assert from "node:assert/strict"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, test } from "node:test"
import { NiftyPlugin } from "../plugin/nifty.js"

const originalFetch = globalThis.fetch
const originalEnv = { ...process.env }

beforeEach(() => {
  process.env.NIFTY_ACCESS_TOKEN = "test-token"
  process.env.NIFTY_AUTOPOLICY_ENABLED = "false"
  process.env.NIFTY_AUTOCONTEXT_ENABLED = "false"
  process.env.NIFTY_BOOTSTRAP_REQUIRED = "false"
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

function taskCommentTemplate() {
  return [
    "## What was done",
    "",
    "- Updated the task card with the requested implementation status.",
    "",
    "## Evidence / Tests",
    "",
    "- Plugin unit test fixture.",
    "",
    "## How to verify",
    "",
    "- Confirm the posted comment includes all required headings.",
  ].join("\n")
}

test("nifty_auth_exchange_code reads OAuth config from tool context", async () => {
  const projectDir = await mkdtemp(join(tmpdir(), "nifty-auth-context-"))
  await writeFile(
    join(projectDir, ".nifty.env"),
    [
      "NIFTY_CLIENT_ID=context-client-id",
      "NIFTY_CLIENT_SECRET=context-client-secret",
      "NIFTY_REDIRECT_URI=http://127.0.0.1:8787/callback",
    ].join("\n"),
    "utf8",
  )
  delete process.env.NIFTY_CLIENT_ID
  delete process.env.NIFTY_CLIENT_SECRET
  delete process.env.NIFTY_REDIRECT_URI
  process.env.NIFTY_TOKEN_PATH = join(projectDir, "nifty-auth.json")

  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))
    assert.equal(requestURL.pathname, "/oauth/token")
    assert.equal(options.method, "POST")
    assert.equal(
      options.headers.Authorization,
      `Basic ${Buffer.from("context-client-id:context-client-secret").toString("base64")}`,
    )
    assert.deepEqual(JSON.parse(options.body), {
      grant_type: "authorization_code",
      code: "returned-code",
      redirect_uri: "http://127.0.0.1:8787/callback",
    })
    return Response.json({
      access_token: "access-token",
      refresh_token: "refresh-token",
      token_type: "bearer",
      expires_in: 3600,
      scope: "default",
    })
  }

  const { NiftyPlugin: AuthNiftyPlugin } = await import(`../plugin/nifty.js?auth-context=${Date.now()}`)
  const plugin = await AuthNiftyPlugin()
  const output = await plugin.tool.nifty_auth_exchange_code.execute(
    { code: "returned-code" },
    context({ directory: projectDir }),
  )
  const parsed = JSON.parse(output)

  assert.equal(parsed.ok, true)
  assert.equal(parsed.token_type, "bearer")
  assert.equal(parsed.scope, "default")
})

test("workflow config ignores env path and uses project-local config", async () => {
  const envDir = await mkdtemp(join(tmpdir(), "nifty-env-config-"))
  const projectDir = await mkdtemp(join(tmpdir(), "nifty-project-config-"))
  const envConfig = join(envDir, "env-workflows.json")
  const projectConfig = join(projectDir, "nifty-workflows.json")
  await writeFile(
    envConfig,
    JSON.stringify({ workflows: { envAlias: { project: { name: "Env Project" }, states: {} } } }),
    "utf8",
  )
  await writeFile(
    projectConfig,
    JSON.stringify({ workflows: { projectAlias: { project: { name: "Project Config" }, states: {} } } }),
    "utf8",
  )
  process.env.NIFTY_WORKFLOW_CONFIG = envConfig

  globalThis.fetch = async (url) => {
    const requestURL = new URL(String(url))
    if (requestURL.pathname === "/api/v1.0/projects") return Response.json({ projects: [] })
    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  const output = await plugin.tool.nifty_list_workflows.execute({}, context({ directory: projectDir }))
  const parsed = JSON.parse(output)

  assert.equal(parsed.config_path, projectConfig)
  assert.deepEqual(parsed.workflows.map((workflow) => workflow.alias), ["projectAlias"])
})

test("nifty_health_check reports Ira local Ollama Gemma readiness and install guidance", async () => {
  process.env.NIFTY_IRA_OLLAMA_BINARY = join(tmpdir(), "missing-ollama-binary")

  globalThis.fetch = async (url) => {
    const requestURL = new URL(String(url))
    if (requestURL.pathname === "/api/v1.0/users/me") return Response.json({ id: "u1" })
    if (requestURL.pathname === "/api/v1.0/projects") return Response.json({ projects: [] })
    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  const output = await plugin.tool.nifty_health_check.execute({}, context())
  const parsed = JSON.parse(output)

  assert.equal(parsed.checks.ira.agent_name, "Ira")
  assert.equal(parsed.checks.ira.model_required, "gemma4:e2b")
  assert.equal(parsed.checks.ira.ollama.installed, false)
  assert.equal(parsed.checks.ira.model.installed, false)
  assert.match(parsed.checks.ira.install.ollama, /ollama/i)
  assert.match(parsed.checks.ira.install.model, /ollama pull gemma4:e2b/)
})

test("workflow config can use an explicit tool config path", async () => {
  const explicitDir = await mkdtemp(join(tmpdir(), "nifty-explicit-config-"))
  const projectDir = await mkdtemp(join(tmpdir(), "nifty-default-config-"))
  const explicitConfig = join(explicitDir, "custom-workflows.json")
  await writeFile(
    explicitConfig,
    JSON.stringify({ workflows: { customAlias: { project: { name: "Custom Project" }, states: {} } } }),
    "utf8",
  )

  globalThis.fetch = async (url) => {
    const requestURL = new URL(String(url))
    if (requestURL.pathname === "/api/v1.0/projects") return Response.json({ projects: [] })
    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  const output = await plugin.tool.nifty_list_workflows.execute(
    { config_path: explicitConfig },
    context({ directory: projectDir }),
  )
  const parsed = JSON.parse(output)

  assert.equal(parsed.config_path, explicitConfig)
  assert.deepEqual(parsed.workflows.map((workflow) => workflow.alias), ["customAlias"])
})

test("workflow config falls back to project-local file from tool context", async () => {
  const projectDir = await mkdtemp(join(tmpdir(), "nifty-local-config-"))
  const projectConfig = join(projectDir, "nifty-workflows.json")
  await writeFile(
    projectConfig,
    JSON.stringify({ workflows: { localAlias: { project: { name: "Local Project" }, states: {} } } }),
    "utf8",
  )
  delete process.env.NIFTY_WORKFLOW_CONFIG

  globalThis.fetch = async (url) => {
    const requestURL = new URL(String(url))
    if (requestURL.pathname === "/api/v1.0/projects") return Response.json({ projects: [] })
    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  const output = await plugin.tool.nifty_list_workflows.execute({}, context({ directory: projectDir }))
  const parsed = JSON.parse(output)

  assert.equal(parsed.config_path, projectConfig)
  assert.deepEqual(parsed.workflows.map((workflow) => workflow.alias), ["localAlias"])
})

test("workflow validation reports configured custom fields", async () => {
  const projectDir = await mkdtemp(join(tmpdir(), "nifty-custom-validate-"))
  await writeFile(
    join(projectDir, "nifty-workflows.json"),
    JSON.stringify({
      workflows: {
        addons: {
          project: { name: "Addons" },
          states: { backlog: "Backlog", todo: "To Do" },
          custom_fields: {
            area_of_concern: {
              id: "field-1",
              name: "Area of concern",
              type: "select",
              values: { deployment: "Deployment" },
            },
          },
        },
      },
    }),
    "utf8",
  )

  globalThis.fetch = async (url) => {
    const requestURL = new URL(String(url))
    if (requestURL.pathname === "/api/v1.0/projects") {
      return Response.json({ projects: [{ id: "p1", name: "Addons", nice_id: "ADD" }] })
    }
    if (requestURL.pathname === "/api/v1.0/taskgroups") {
      return Response.json({ items: [{ id: "s1", name: "Backlog" }, { id: "s2", name: "To Do" }] })
    }
    if (requestURL.pathname === "/api/v1.0/milestones") return Response.json({ items: [] })
    if (requestURL.pathname === "/api/v1.0/tasks") {
      return Response.json({ tasks: [{ id: "t1", fields: [{ id: "field-1", value: "Deployment" }] }] })
    }
    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  const output = await plugin.tool.nifty_validate_workflows.execute({}, context({ directory: projectDir }))
  const parsed = JSON.parse(output)

  assert.equal(parsed.workflows[0].custom_fields.area_of_concern.observed_on_sampled_tasks, true)
})

test("nifty_list_workflow_tasks filters returned tasks to the requested status", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nifty-workflow-"))
  const configPath = join(dir, "nifty-workflows.json")
  await writeFile(
    configPath,
    JSON.stringify({
      workflows: {
        addons: {
          project: { name: "Addons" },
          states: { backlog: "Backlog", review: "DEV Review" },
          custom_fields: {
            area_of_concern: {
              id: "field-1",
              name: "Area of concern",
              type: "select",
              values: { deployment: "Deployment", editor: "Editor" },
            },
          },
        },
      },
    }),
    "utf8",
  )

  globalThis.fetch = async (url) => {
    const requestURL = new URL(String(url))

    if (requestURL.pathname === "/api/v1.0/projects") {
      return Response.json({ projects: [{ id: "p1", name: "Addons", nice_id: "ADD" }] })
    }

    if (requestURL.pathname === "/api/v1.0/taskgroups") {
      return Response.json({
        items: [
          { id: "s1", name: "Backlog" },
          { id: "s2", name: "DEV Review" },
        ],
      })
    }

    if (requestURL.pathname === "/api/v1.0/milestones") {
      return Response.json({ items: [] })
    }

    if (requestURL.pathname === "/api/v1.0/tasks") {
      return Response.json({
        tasks: [
          { id: "1", name: "Backlog task", task_group: "s1", completed: false, fields: [{ id: "field-1", value: "Deployment" }] },
          { id: "2", name: "Review task", task_group: "s2", completed: false, fields: [{ id: "field-1", value: "Editor" }] },
          { id: "3", name: "Leaky subtask", task_group: null, completed: false },
        ],
        hasMore: false,
      })
    }

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  const output = await plugin.tool.nifty_list_workflow_tasks.execute(
    { workflow_alias: "addons", state_key: "backlog", include_subtasks: false },
    context({ directory: dir }),
  )
  const parsed = JSON.parse(output)

  assert.deepEqual(parsed.tasks.map((task) => task.id), ["1"])
  assert.equal(parsed.tasks[0].custom_fields.area_of_concern.value_key, "deployment")

  const filteredOutput = await plugin.tool.nifty_list_workflow_tasks.execute(
    {
      workflow_alias: "addons",
      custom_field_key: "area_of_concern",
      custom_field_value: "editor",
      include_subtasks: false,
    },
    context({ directory: dir }),
  )
  const filtered = JSON.parse(filteredOutput)

  assert.deepEqual(filtered.tasks.map((task) => task.id), ["2"])
})

test("nifty_batch_capture_backlog_items dry-run plans standardized creates", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nifty-batch-"))
  const configPath = join(dir, "nifty-workflows.json")
  await writeFile(
    configPath,
    JSON.stringify({
      workflows: {
        addons: {
          project: { name: "Addons" },
          states: { backlog: "Backlog" },
          lists: { sprint: "Sprint 1" },
        },
      },
    }),
    "utf8",
  )

  globalThis.fetch = async (url) => {
    const requestURL = new URL(String(url))

    if (requestURL.pathname === "/api/v1.0/projects") {
      return Response.json({ projects: [{ id: "p1", name: "Addons", nice_id: "ADD" }] })
    }
    if (requestURL.pathname === "/api/v1.0/taskgroups") {
      return Response.json({ items: [{ id: "s1", name: "Backlog" }] })
    }
    if (requestURL.pathname === "/api/v1.0/milestones") {
      return Response.json({ items: [{ id: "m1", name: "Sprint 1", is_list: true }] })
    }

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  const output = await plugin.tool.nifty_batch_capture_backlog_items.execute(
    {
      workflow_alias: "addons",
      list_key: "sprint",
      dry_run: true,
      items: [{ name: "Add batch capture", summary: "Capture multiple ideas" }],
    },
    context({ directory: dir }),
  )
  const parsed = JSON.parse(output)

  assert.equal(parsed.dry_run, true)
  assert.equal(parsed.planned[0].task_group_id, "s1")
  assert.equal(parsed.planned[0].milestone_id, "m1")
  assert.match(parsed.planned[0].description, /Capture multiple ideas/)
})

test("nifty_batch_capture_backlog_items skips items that already exist in the target status", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nifty-batch-idempotent-"))
  const configPath = join(dir, "nifty-workflows.json")
  await writeFile(
    configPath,
    JSON.stringify({
      workflows: {
        addons: {
          project: { name: "Addons" },
          states: { backlog: "Backlog" },
        },
      },
    }),
    "utf8",
  )

  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))
    calls.push({ path: requestURL.pathname, method: options.method || "GET", query: requestURL.searchParams, body: options.body })

    if (requestURL.pathname === "/api/v1.0/projects") {
      return Response.json({ projects: [{ id: "p1", name: "Addons", nice_id: "ADD" }] })
    }
    if (requestURL.pathname === "/api/v1.0/taskgroups") {
      return Response.json({ items: [{ id: "s1", name: "Backlog" }] })
    }
    if (requestURL.pathname === "/api/v1.0/milestones") {
      return Response.json({ items: [] })
    }
    if (requestURL.pathname === "/api/v1.0/tasks" && (options.method || "GET") === "GET") {
      return Response.json({ tasks: [{ id: "existing-1", name: "Duplicate item", task_group: "s1" }] })
    }
    if (requestURL.pathname === "/api/v1.0/tasks" && options.method === "POST") {
      const body = JSON.parse(options.body)
      return Response.json({ id: `new-${body.name}`, name: body.name }, { status: 201 })
    }

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  const output = await plugin.tool.nifty_batch_capture_backlog_items.execute(
    {
      workflow_alias: "addons",
      dry_run: false,
      items: [{ name: "Duplicate item" }, { name: "New item" }],
    },
    context({ directory: dir }),
  )
  const parsed = JSON.parse(output)
  const createCalls = calls.filter((call) => call.path === "/api/v1.0/tasks" && call.method === "POST")

  assert.equal(parsed.dry_run, false)
  assert.equal(createCalls.length, 1)
  assert.equal(JSON.parse(createCalls[0].body).name, "New item")
})

test("workflow capture blocks open questions before API calls", async () => {
  const calls = []
  globalThis.fetch = async (url) => {
    calls.push(String(url))
    return Response.json({ ok: true })
  }

  const plugin = await NiftyPlugin()
  await assert.rejects(
    () => plugin.tool.nifty_capture_backlog_item.execute(
      {
        workflow_alias: "addons",
        name: "Shape task",
        open_questions: ["Which user role needs this?"],
      },
      context(),
    ),
    /Which user role needs this\?/,
  )

  assert.deepEqual(calls, [])
})

test("nifty_shape_task returns one next shaping question", async () => {
  const plugin = await NiftyPlugin()
  const output = await plugin.tool.nifty_shape_task.execute(
    { title: "Export account data", idea: "Users need a way to export their data" },
    context(),
  )
  const parsed = JSON.parse(output)

  assert.equal(parsed.ready, false)
  assert.equal(parsed.next_question.field, "summary")
  assert.deepEqual(parsed.missing_fields.slice(0, 3), ["summary", "problem", "desired_outcome"])
})

test("nifty_shape_task finalizes an existing task and confirmed subtasks", async () => {
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))
    calls.push({ path: requestURL.pathname, method: options.method || "GET", body: options.body })

    if (requestURL.pathname === "/api/v1.0/tasks/t-parent" && !options.method) {
      return Response.json({ id: "t-parent", name: "Rough export idea", task_group: "s-shaping", project_id: "p1" })
    }
    if (requestURL.pathname === "/api/v1.0/tasks/t-parent" && options.method === "PUT") {
      return Response.json({ id: "t-parent", name: JSON.parse(options.body).name })
    }
    if (requestURL.pathname === "/api/v1.0/tasks" && options.method === "POST") {
      return Response.json({ id: "st1", name: JSON.parse(options.body).name })
    }

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  const output = await plugin.tool.nifty_shape_task.execute(
    {
      task_id: "t-parent",
      title: "Export account data",
      target_task_group_id: "s-shaped",
      summary: "Let users export account data.",
      problem: "Users need portable access to their data.",
      desired_outcome: "Users can download a complete export from settings.",
      user_experience: "A settings button starts export and shows completion state.",
      acceptance_criteria: ["Only account owners can export", "Export includes profile data"],
      security_privacy: "Require account-owner permissions and avoid cross-account data exposure.",
      performance: "Run export in a background job for large accounts.",
      data_integrations: "Read profile and account tables, no third-party integrations.",
      edge_cases: "Empty accounts get a valid empty export.",
      implementation_notes: "Use the existing job queue and storage abstraction.",
      test_plan: "Unit test serializer and permission checks.",
      rollout: "No feature flag required.",
      non_goals: "No admin bulk export.",
      proposed_subtasks: [{ name: "Add export permission checks" }],
      create_subtasks: true,
      subtask_confirmation: "create 1 subtask",
      finalize: true,
    },
    context(),
  )
  const parsed = JSON.parse(output)
  const updateBody = JSON.parse(calls.find((call) => call.method === "PUT").body)
  const subtaskBody = JSON.parse(calls.find((call) => call.method === "POST").body)

  assert.equal(parsed.finalized, true)
  assert.equal(updateBody.task_group_id, "s-shaped")
  assert.match(updateBody.description, /## Security \/ Privacy/)
  assert.equal(subtaskBody.task_id, "t-parent")
  assert.equal(subtaskBody.task_group_id, "s-shaped")
})

test("nifty_shape_task avoids duplicate subtask creates for existing and repeated names", async () => {
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))
    calls.push({ path: requestURL.pathname, method: options.method || "GET", body: options.body })

    if (requestURL.pathname === "/api/v1.0/tasks/t-parent" && !options.method) {
      return Response.json({
        id: "t-parent",
        name: "Rough export idea",
        task_group: "s-shaping",
        project_id: "p1",
        subtasks: [{ name: "Write docs" }],
      })
    }
    if (requestURL.pathname === "/api/v1.0/tasks/t-parent" && options.method === "PUT") {
      return Response.json({ id: "t-parent", name: JSON.parse(options.body).name })
    }
    if (requestURL.pathname === "/api/v1.0/tasks" && options.method === "POST") {
      const body = JSON.parse(options.body)
      return Response.json({ id: `st-${calls.length}`, name: body.name }, { status: 201 })
    }

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  const output = await plugin.tool.nifty_shape_task.execute(
    {
      task_id: "t-parent",
      title: "Export account data",
      target_task_group_id: "s-shaped",
      summary: "Let users export account data.",
      problem: "Users need portable access to their data.",
      desired_outcome: "Users can download a complete export from settings.",
      user_experience: "A settings button starts export and shows completion state.",
      acceptance_criteria: ["Only account owners can export", "Export includes profile data"],
      security_privacy: "Require account-owner permissions and avoid cross-account data exposure.",
      performance: "Run export in a background job for large accounts.",
      data_integrations: "Read profile and account tables, no third-party integrations.",
      edge_cases: "Empty accounts get a valid empty export.",
      implementation_notes: "Use the existing job queue and storage abstraction.",
      test_plan: "Unit test serializer and permission checks.",
      rollout: "No feature flag required.",
      non_goals: "No admin bulk export.",
      proposed_subtasks: [
        { name: "Write docs" },
        { name: "Implement API" },
        { name: "implement api" },
      ],
      create_subtasks: true,
      subtask_confirmation: "create 1 subtask",
      finalize: true,
    },
    context(),
  )
  const parsed = JSON.parse(output)
  const subtaskCalls = calls
    .filter((call) => call.path === "/api/v1.0/tasks" && call.method === "POST")
    .map((call) => JSON.parse(call.body))

  assert.equal(parsed.finalized, true)
  assert.equal(subtaskCalls.length, 1)
  assert.equal(subtaskCalls[0].name, "Implement API")
})

test("nifty_create_document resolves project from workflow alias", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nifty-doc-"))
  const configPath = join(dir, "nifty-workflows.json")
  await writeFile(
    configPath,
    JSON.stringify({
      workflows: {
        docs: {
          project: { name: "Docs Project" },
          states: {},
        },
      },
    }),
    "utf8",
  )

  let capturedBody
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))

    if (requestURL.pathname === "/api/v1.0/projects") {
      return Response.json({ projects: [{ id: "p-docs", name: "Docs Project", nice_id: "DOC" }] })
    }
    if (requestURL.pathname === "/api/v1.0/docs" && options.method === "POST") {
      capturedBody = JSON.parse(options.body)
      return Response.json({ message: "created", doc_id: "d1", folder: "f1" }, { status: 201 })
    }

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  const output = await plugin.tool.nifty_create_document.execute(
    {
      workflow_alias: "docs",
      name: "Launch Notes",
      content_text: "Ship it",
    },
    context({ directory: dir }),
  )
  const parsed = JSON.parse(output)

  assert.equal(capturedBody.project_id, "p-docs")
  assert.equal(capturedBody.name, "Launch Notes")
  assert.equal(capturedBody.content.type, "doc")
  assert.match(JSON.stringify(capturedBody.content), /Ship it/)
  assert.equal(capturedBody.content.text, undefined)
  assert.equal(parsed.document.doc_id, "d1")
})

test("nifty_prepare_task_for_delivery auto-creates checklist subtasks without attaching any document", async () => {
  process.env.NIFTY_POLICY_INLINE = JSON.stringify({
    version: 1,
    default_effect: "allow",
    automation: {
      enabled: true,
      subtasks: { auto_create_from_checklist: true },
    },
    rules: [],
  })

  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))
    calls.push({ path: requestURL.pathname, method: options.method || "GET", body: options.body })

    if (requestURL.pathname === "/api/v1.0/tasks/t1" && (options.method || "GET") === "GET") {
      return Response.json({ id: "t1", name: "Task", project_id: "p1", task_group_id: "s-todo", subtasks: [{ name: "Write docs" }] })
    }
    if (requestURL.pathname === "/api/v1.0/tasks/t1" && options.method === "PUT") {
      return Response.json({ id: "t1" })
    }
    if (requestURL.pathname === "/api/v1.0/tasks" && options.method === "POST") {
      return Response.json({ id: `sub-${calls.length}` }, { status: 201 })
    }

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  const output = await plugin.tool.nifty_prepare_task_for_delivery.execute(
    {
      task_id: "t1",
      summary: "Automate reporting",
      problem: "Manual updates are inconsistent",
      desired_outcome: "Consistent autonomous delivery updates",
      checklist: ["Implement API", "Write docs"],
    },
    context(),
  )
  const parsed = JSON.parse(output)

  assert.equal(parsed.prepared, true)
  assert.equal(parsed.created_subtasks.length, 1)
  assert.equal(parsed.created_subtasks[0].name, "Implement API")
  assert.equal(parsed.delivery_document, undefined)
  assert.equal(calls.some((call) => call.path === "/api/v1.0/docs"), false)
  assert.equal(calls.some((call) => call.path === "/api/v1.0/tasks/t1/documents"), false)
})

test("nifty_update_document sends only provided fields", async () => {
  let capturedBody
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))

    if (requestURL.pathname === "/api/v1.0/docs/d1" && options.method === "PUT") {
      capturedBody = JSON.parse(options.body)
      return Response.json({ message: "updated", doc_id: "d1" })
    }

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  await plugin.tool.nifty_update_document.execute(
    {
      document_id: "d1",
      name: "Updated",
      archived: false,
    },
    context(),
  )

  assert.deepEqual(capturedBody, { name: "Updated", archived: false })
})

test("nifty_update_document converts content_text to rich document content", async () => {
  let capturedBody
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))

    if (requestURL.pathname === "/api/v1.0/docs/d1" && options.method === "PUT") {
      capturedBody = JSON.parse(options.body)
      return Response.json({ message: "updated", doc_id: "d1" })
    }

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  await plugin.tool.nifty_update_document.execute(
    {
      document_id: "d1",
      content_text: "Updated body",
    },
    context(),
  )

  assert.equal(capturedBody.content.type, "doc")
  assert.match(JSON.stringify(capturedBody.content), /Updated body/)
  assert.equal(capturedBody.content.text, undefined)
})

test("nifty_create_task omits blank optional fields", async () => {
  let capturedBody
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))

    if (requestURL.pathname === "/api/v1.0/tasks" && options.method === "POST") {
      capturedBody = JSON.parse(options.body)
      return Response.json({ id: "t1", name: capturedBody.name })
    }

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  await plugin.tool.nifty_create_task.execute(
    {
      name: "Minimal task",
      task_group_id: "status-1",
      description: "",
      parent_task_id: "",
      milestone_id: "",
      due_date: "",
      start_date: "",
      assignee_ids: [],
      label_ids: [],
    },
    context(),
  )

  assert.deepEqual(capturedBody, { name: "Minimal task", task_group_id: "status-1" })
})

test("nifty_create_subtask sends parent task id", async () => {
  let capturedBody
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))

    if (requestURL.pathname === "/api/v1.0/tasks/parent-1" && (options.method || "GET") === "GET") {
      return Response.json({ id: "parent-1", name: "Parent task" })
    }
    if (requestURL.pathname === "/api/v1.0/tasks" && options.method === "POST") {
      capturedBody = JSON.parse(options.body)
      return Response.json({ id: "st1", name: capturedBody.name })
    }

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  await plugin.tool.nifty_create_subtask.execute(
    {
      parent_task_id: "parent-1",
      name: "Implement API detail",
      task_group_id: "status-1",
      description: "",
    },
    context(),
  )

  assert.deepEqual(capturedBody, {
    name: "Implement API detail",
    task_group_id: "status-1",
    task_id: "parent-1",
  })
})

test("nifty_get_task_full_context returns task, comments, subtasks, and project summary", async () => {
  globalThis.fetch = async (url) => {
    const requestURL = new URL(String(url))

    if (requestURL.pathname === "/api/v1.0/tasks/t1") {
      return Response.json({ id: "t1", name: "Parent", project_id: "p1", task_group_id: "s1" })
    }
    if (requestURL.pathname === "/api/v1.0/messages") {
      return Response.json({ items: [{ id: "m1", text: "latest update" }] })
    }
    if (requestURL.pathname === "/api/v1.0/projects") {
      return Response.json({ projects: [{ id: "p1", name: "Project One", nice_id: "P1" }] })
    }
    if (requestURL.pathname === "/api/v1.0/taskgroups") {
      return Response.json({ items: [{ id: "s1", name: "In Progress" }, { id: "s2", name: "Dev Review" }] })
    }
    if (requestURL.pathname === "/api/v1.0/milestones") {
      return Response.json({ items: [] })
    }
    if (requestURL.pathname === "/api/v1.0/tasks") {
      return Response.json({ tasks: [
        { id: "t1", task_group: "s1" },
        { id: "st1", task_id: "t1", task_group: "s1" },
        { id: "t2", task_group: "s2" },
      ] })
    }

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  const output = await plugin.tool.nifty_get_task_full_context.execute(
    { task_id: "t1", comment_limit: 5, project_task_limit: 20 },
    context(),
  )
  const parsed = JSON.parse(output)

  assert.equal(parsed.task.id, "t1")
  assert.equal(parsed.comments.length, 1)
  assert.equal(parsed.subtasks.length, 1)
  assert.equal(parsed.project.name, "Project One")
  assert.equal(parsed.project_status_counts["In Progress"], 1)
})

test("nifty_run_task hydrates parent context and assigns authorized user", async () => {
  process.env.NIFTY_AUTOPOLICY_DEFAULT_ASSIGNEE_IDS = "u1"
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))
    calls.push({ path: requestURL.pathname, method: options.method || "GET", body: options.body, query: requestURL.searchParams })

    if (requestURL.pathname === "/api/v1.0/tasks/MBC-495") {
      return Response.json({
        id: "parent-495",
        nice_id: "MBC-495",
        name: "Parent card",
        description: "Parent description",
        project_id: "p1",
        task_group_id: "s1",
        assignees: [],
      })
    }
    if (requestURL.pathname === "/api/v1.0/messages") {
      return Response.json({ items: [{ id: "c1", text: "Existing context" }] })
    }
    if (requestURL.pathname === "/api/v1.0/projects") {
      return Response.json({ projects: [{ id: "p1", name: "Project", nice_id: "MBC" }] })
    }
    if (requestURL.pathname === "/api/v1.0/taskgroups") {
      return Response.json({ items: [{ id: "s1", name: "In Progress" }] })
    }
    if (requestURL.pathname === "/api/v1.0/milestones") {
      return Response.json({ items: [] })
    }
    if (requestURL.pathname === "/api/v1.0/tasks" && !options.method) {
      if (requestURL.searchParams.get("task_id") === "parent-495") {
        return Response.json({ tasks: [{ id: "child-1", nice_id: "MBC-713", name: "Child task", task_id: "parent-495", completed: false }] })
      }
      return Response.json({
        tasks: [
          { id: "parent-495", nice_id: "MBC-495", name: "Parent card", project_id: "p1", task_group_id: "s1" },
          { id: "child-1", nice_id: "MBC-713", name: "Child task", task_id: "parent-495", completed: false },
        ],
      })
    }
    if (requestURL.pathname === "/api/v1.0/tasks/parent-495/assignees" && options.method === "PUT") {
      return Response.json({ ok: true })
    }

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  const output = await plugin.tool.nifty_run_task.execute({ task_id: "MBC-495" }, context())
  const parsed = JSON.parse(output)

  assert.equal(parsed.workflow, "nifty_task_work_session")
  assert.equal(parsed.active_task_id, "parent-495")
  assert.equal(parsed.assignment.assigned, true)
  assert.deepEqual(parsed.subtasks.map((item) => item.id), ["child-1"])
  const assignment = calls.find((call) => call.path === "/api/v1.0/tasks/parent-495/assignees" && call.method === "PUT")
  assert.ok(assignment)
  assert.deepEqual(JSON.parse(assignment.body), { assignees: ["u1"] })
})

test("nifty_get_project_full_context returns whole project snapshot", async () => {
  globalThis.fetch = async (url) => {
    const requestURL = new URL(String(url))

    if (requestURL.pathname === "/api/v1.0/taskgroups") {
      return Response.json({ items: [{ id: "s1", name: "To Do" }, { id: "s2", name: "In Progress" }] })
    }
    if (requestURL.pathname === "/api/v1.0/milestones") {
      return Response.json({ items: [{ id: "m1", name: "Current", is_list: true }], hasMore: false })
    }
    if (requestURL.pathname === "/api/v1.0/tasks") {
      return Response.json({ tasks: [{ id: "t1", task_group: "s1" }, { id: "t2", task_group: "s2" }] })
    }
    if (requestURL.pathname === "/api/v1.0/docs") {
      return Response.json({ items: [{ id: "d1", name: "Spec" }] })
    }
    if (requestURL.pathname === "/api/v1.0/projects") {
      return Response.json({ projects: [{ id: "p1", name: "Project One", nice_id: "P1" }] })
    }

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  const output = await plugin.tool.nifty_get_project_full_context.execute({ project_id: "p1", task_limit: 20 }, context())
  const parsed = JSON.parse(output)

  assert.equal(parsed.project.id, "p1")
  assert.equal(parsed.statuses.length, 2)
  assert.equal(parsed.tasks.length, 2)
  assert.equal(parsed.documents.length, 1)
  assert.equal(parsed.status_counts["To Do"], 1)
})

test("nifty_get_project_full_context includes subtask child rows and parent counters", async () => {
  globalThis.fetch = async (url) => {
    const requestURL = new URL(String(url))

    if (requestURL.pathname === "/api/v1.0/taskgroups") {
      return Response.json({ items: [{ id: "s1", name: "To Do" }, { id: "s2", name: "Done" }] })
    }
    if (requestURL.pathname === "/api/v1.0/milestones") {
      return Response.json({ items: [], hasMore: false })
    }
    if (requestURL.pathname === "/api/v1.0/tasks") {
      assert.equal(requestURL.searchParams.get("include_subtasks"), "true")
      return Response.json({
        tasks: [
          {
            id: "parent-1",
            name: "Parent task",
            project_id: "p1",
            task_group: "s1",
            total_subtasks: 2,
            completed_subtasks: 1,
          },
          {
            id: "child-1",
            name: "Child one",
            project_id: "p1",
            task_id: "parent-1",
            completed: true,
          },
          {
            id: "child-2",
            name: "Child two",
            project_id: "p1",
            task_id: "parent-1",
            completed: false,
          },
        ],
      })
    }
    if (requestURL.pathname === "/api/v1.0/docs") {
      return Response.json({ items: [] })
    }
    if (requestURL.pathname === "/api/v1.0/projects") {
      return Response.json({ projects: [{ id: "p1", name: "Project One", nice_id: "P1" }] })
    }

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  const output = await plugin.tool.nifty_get_project_full_context.execute({ project_id: "p1", task_limit: 20 }, context())
  const parsed = JSON.parse(output)

  assert.deepEqual(parsed.tasks.map((task) => task.id), ["parent-1"])
  assert.equal(parsed.tasks[0].total_subtasks, 2)
  assert.equal(parsed.tasks[0].completed_subtasks, 1)
  assert.equal(parsed.tasks[0].open_subtasks, 1)
  assert.deepEqual(parsed.tasks[0].subtask_ids, ["child-1", "child-2"])
  assert.deepEqual(parsed.subtasks.map((task) => task.id), ["child-1", "child-2"])
  assert.equal(parsed.subtasks_by_parent["parent-1"].length, 2)
  assert.equal(parsed.status_counts["To Do"], 1)
})

test("nifty_get_project_full_context preserves subtask counters when child rows are absent", async () => {
  globalThis.fetch = async (url) => {
    const requestURL = new URL(String(url))

    if (requestURL.pathname === "/api/v1.0/taskgroups") {
      return Response.json({ items: [{ id: "s1", name: "In Progress" }] })
    }
    if (requestURL.pathname === "/api/v1.0/milestones") {
      return Response.json({ items: [], hasMore: false })
    }
    if (requestURL.pathname === "/api/v1.0/tasks") {
      assert.equal(requestURL.searchParams.get("include_subtasks"), "true")
      return Response.json({
        tasks: [
          {
            id: "parent-1",
            nice_id: "MBC-462",
            name: "Parent task",
            project_id: "p1",
            task_group: "s1",
            total_subtasks: 6,
            completed_subtasks: 6,
          },
        ],
      })
    }
    if (requestURL.pathname === "/api/v1.0/docs") {
      return Response.json({ items: [] })
    }
    if (requestURL.pathname === "/api/v1.0/projects") {
      return Response.json({ projects: [{ id: "p1", name: "Project One", nice_id: "P1" }] })
    }

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  const output = await plugin.tool.nifty_get_project_full_context.execute({ project_id: "p1", task_limit: 20 }, context())
  const parsed = JSON.parse(output)

  assert.equal(parsed.tasks[0].total_subtasks, 6)
  assert.equal(parsed.tasks[0].completed_subtasks, 6)
  assert.equal(parsed.tasks[0].open_subtasks, 0)
  assert.equal(parsed.tasks[0].loaded_subtasks, 0)
  assert.equal(parsed.tasks[0].subtasks_fully_loaded, false)
  assert.deepEqual(parsed.subtasks, [])
})

test("auto context hydration injects full task context metadata", async () => {
  process.env.NIFTY_AUTOCONTEXT_ENABLED = "true"

  globalThis.fetch = async (url) => {
    const requestURL = new URL(String(url))

    if (requestURL.pathname === "/api/v1.0/tasks/t1") {
      return Response.json({ id: "t1", name: "Parent", project_id: "p1", task_group_id: "s1" })
    }
    if (requestURL.pathname === "/api/v1.0/messages") {
      return Response.json({ items: [{ id: "m1", text: "latest update" }] })
    }
    if (requestURL.pathname === "/api/v1.0/projects") {
      return Response.json({ projects: [{ id: "p1", name: "Project One", nice_id: "P1" }] })
    }
    if (requestURL.pathname === "/api/v1.0/taskgroups") {
      return Response.json({ items: [{ id: "s1", name: "In Progress" }] })
    }
    if (requestURL.pathname === "/api/v1.0/milestones") {
      return Response.json({ items: [] })
    }
    if (requestURL.pathname === "/api/v1.0/tasks") {
      return Response.json({ tasks: [{ id: "t1", task_group: "s1" }] })
    }

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const metadataPayloads = []
  const plugin = await NiftyPlugin()
  await plugin.tool.nifty_get_task.execute(
    { task_id: "t1" },
    context({
      metadata(payload, value) {
        metadataPayloads.push(arguments.length === 2 ? value : payload)
      },
    }),
  )

  const taskMetadata = metadataPayloads.find((payload) => payload?.metadata?.task_context?.task?.id === "t1")
  assert.equal(taskMetadata?.metadata?.task_context?.task?.id, "t1")
  assert.equal(taskMetadata?.metadata?.task_context?.comments?.length, 1)
})

test("nifty_update_task writes configured custom fields", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nifty-custom-fields-"))
  await writeFile(
    join(dir, "nifty-workflows.json"),
    JSON.stringify({
      workflows: {
        addons: {
          project: { name: "Addons" },
          custom_fields: {
            area_of_concern: {
              id: "field-1",
              values: { deployment: "Deployment" },
            },
          },
        },
      },
    }),
    "utf8",
  )
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))
    calls.push({ path: requestURL.pathname, method: options.method || "GET", body: options.body })

    if (requestURL.pathname === "/api/v1.0/tasks/t1" && (options.method || "GET") === "GET") {
      return Response.json({ id: "t1", project_id: "p1" })
    }
    if (requestURL.pathname === "/api/v1.0/tasks/t1/fields/field-1" && options.method === "PUT") {
      return Response.json({ id: "field-1", value: JSON.parse(options.body).value })
    }

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  await plugin.tool.nifty_update_task.execute(
    {
      workflow_alias: "addons",
      task_id: "t1",
      custom_fields: [{ key: "area_of_concern", value_key: "deployment" }],
    },
    context({ directory: dir }),
  )

  assert.deepEqual(calls.map((call) => [call.method, call.path]), [
    ["GET", "/api/v1.0/tasks/t1"],
    ["PUT", "/api/v1.0/tasks/t1/fields/field-1"],
  ])
  assert.deepEqual(JSON.parse(calls[1].body), { value: "Deployment" })
})

test("nifty_update_task_custom_fields never sends a generic task update", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nifty-custom-field-only-"))
  await writeFile(
    join(dir, "nifty-workflows.json"),
    JSON.stringify({
      workflows: {
        addons: {
          project: { name: "Addons" },
          custom_fields: {
            area_of_concern: {
              id: "field-1",
              values: { deployment: "Deployment" },
            },
          },
        },
      },
    }),
    "utf8",
  )
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))
    calls.push({ path: requestURL.pathname, method: options.method || "GET", body: options.body })

    if (requestURL.pathname === "/api/v1.0/tasks/t1" && (options.method || "GET") === "GET") {
      return Response.json({ id: "t1", project_id: "p1" })
    }
    if (requestURL.pathname === "/api/v1.0/tasks/t1/fields/field-1" && options.method === "PUT") {
      return Response.json({ id: "field-1", value: JSON.parse(options.body).value })
    }

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  const output = await plugin.tool.nifty_update_task_custom_fields.execute(
    {
      workflow_alias: "addons",
      task_id: "t1",
      custom_fields: [{ key: "area_of_concern", value_key: "deployment" }],
    },
    context({ directory: dir }),
  )
  const parsed = JSON.parse(output)

  assert.deepEqual(calls.map((call) => [call.method, call.path]), [
    ["GET", "/api/v1.0/tasks/t1"],
    ["PUT", "/api/v1.0/tasks/t1/fields/field-1"],
  ])
  assert.deepEqual(JSON.parse(calls[1].body), { value: "Deployment" })
  assert.equal(parsed.task_id, "t1")
  assert.deepEqual(parsed.custom_fields, [{ id: "field-1", value: "Deployment" }])
})

test("nifty_update_task separates normal fields from custom fields", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nifty-custom-and-normal-fields-"))
  await writeFile(
    join(dir, "nifty-workflows.json"),
    JSON.stringify({
      workflows: {
        addons: {
          project: { name: "Addons" },
          custom_fields: {
            area_of_concern: {
              id: "field-1",
              values: { deployment: "Deployment" },
            },
          },
        },
      },
    }),
    "utf8",
  )
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))
    calls.push({ path: requestURL.pathname, method: options.method || "GET", body: options.body })

    if (requestURL.pathname === "/api/v1.0/tasks/t1" && (options.method || "GET") === "GET") {
      return Response.json({ id: "t1", name: "Original", project_id: "p1" })
    }
    if (requestURL.pathname === "/api/v1.0/tasks/t1" && options.method === "PUT") {
      return Response.json({ id: "t1", name: JSON.parse(options.body).name })
    }
    if (requestURL.pathname === "/api/v1.0/tasks/t1/fields/field-1" && options.method === "PUT") {
      return Response.json({ id: "field-1", value: JSON.parse(options.body).value })
    }

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  await plugin.tool.nifty_update_task.execute(
    {
      workflow_alias: "addons",
      task_id: "t1",
      name: "Updated task",
      custom_fields: [{ key: "area_of_concern", value_key: "deployment" }],
    },
    context({ directory: dir }),
  )

  assert.deepEqual(calls.map((call) => [call.method, call.path]), [
    ["GET", "/api/v1.0/tasks/t1"],
    ["PUT", "/api/v1.0/tasks/t1"],
    ["PUT", "/api/v1.0/tasks/t1/fields/field-1"],
  ])
  assert.deepEqual(JSON.parse(calls[1].body), { name: "Updated task" })
  assert.deepEqual(JSON.parse(calls[2].body), { value: "Deployment" })
})

test("nifty_delete_status deletes task group by id", async () => {
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))
    calls.push({ path: requestURL.pathname, method: options.method || "GET" })
    return Response.json({ ok: true })
  }

  const plugin = await NiftyPlugin()
  await plugin.tool.nifty_delete_status.execute({ status_id: "status-1" }, context())

  assert.deepEqual(calls, [{ path: "/api/v1.0/taskgroups/status-1", method: "DELETE" }])
})

test("nifty_delete_tasks requires explicit bulk confirmation", async () => {
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))
    calls.push({ path: requestURL.pathname, method: options.method || "GET", body: options.body })
    return Response.json({ ok: true })
  }

  const plugin = await NiftyPlugin()
  await assert.rejects(
    () => plugin.tool.nifty_delete_tasks.execute(
      { project_id: "p1", task_ids: ["t1", "t2"] },
      context(),
    ),
    /confirmation.*delete 2 tasks/,
  )
  assert.deepEqual(calls, [])

  await plugin.tool.nifty_delete_tasks.execute(
    { project_id: "p1", task_ids: ["t1", "t2"], confirmation: "delete 2 tasks" },
    context(),
  )

  assert.deepEqual(calls.map((call) => [call.method, call.path]), [
    ["GET", "/api/v1.0/tasks/t1"],
    ["GET", "/api/v1.0/tasks/t2"],
    ["DELETE", "/api/v1.0/tasks"],
  ])
  assert.deepEqual(JSON.parse(calls[2].body), { project_id: "p1", task_ids: ["t1", "t2"] })
})

test("task lifecycle tools call expected endpoints and bodies", async () => {
  process.env.NIFTY_POLICY_INLINE = JSON.stringify({
    version: 1,
    default_effect: "allow",
    automation: {
      enabled: true,
      completion: { require_explicit_close_trigger: true },
    },
    rules: [],
  })

  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))
    calls.push({ path: requestURL.pathname, method: options.method || "GET", body: options.body })
    return Response.json({ ok: true })
  }

  const plugin = await NiftyPlugin()
  await plugin.tool.nifty_complete_task.execute(
    { task_id: "t1", completed: true, close_confirmation: "close t1" },
    context(),
  )
  await plugin.tool.nifty_archive_task.execute({ task_id: "t1", archived: true }, context())
  await plugin.tool.nifty_link_tasks.execute({ task_id: "t1", task_ids: ["t2"] }, context())
  await plugin.tool.nifty_update_task_labels.execute(
    { task_id: "t1", label_ids: ["l1"], mode: "add" },
    context(),
  )

  assert.deepEqual(calls.map((call) => [call.method, call.path]), [
    ["GET", "/api/v1.0/tasks/t1"],
    ["POST", "/api/v1.0/tasks/t1/complete"],
    ["GET", "/api/v1.0/tasks/t1"],
    ["POST", "/api/v1.0/tasks/t1/archive"],
    ["GET", "/api/v1.0/tasks/t1"],
    ["GET", "/api/v1.0/tasks/t2"],
    ["POST", "/api/v1.0/tasks/t1/link_task"],
    ["GET", "/api/v1.0/tasks/t1"],
    ["PUT", "/api/v1.0/tasks/t1/labels"],
  ])
  assert.deepEqual(JSON.parse(calls[1].body), { completed: true })
  assert.deepEqual(JSON.parse(calls[6].body), { tasks: ["t2"] })
  assert.deepEqual(JSON.parse(calls[8].body), { labels: ["l1"] })
})

test("nifty_complete_task blocks completion without explicit close confirmation", async () => {
  process.env.NIFTY_POLICY_INLINE = JSON.stringify({
    version: 1,
    default_effect: "allow",
    automation: {
      enabled: true,
      completion: { require_explicit_close_trigger: true },
    },
    rules: [],
  })

  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))
    calls.push({ path: requestURL.pathname, method: options.method || "GET", body: options.body })
    return Response.json({ ok: true })
  }

  const plugin = await NiftyPlugin()
  await assert.rejects(
    () => plugin.tool.nifty_complete_task.execute({ task_id: "MBC-462", completed: true }, context()),
    /close_confirmation.*close MBC-462/i,
  )

  assert.deepEqual(calls.map((call) => [call.method, call.path]), [
    ["GET", "/api/v1.0/tasks/MBC-462"],
  ])
})

test("nifty_complete_task checks off subtasks without parent-card close confirmation", async () => {
  process.env.NIFTY_POLICY_INLINE = JSON.stringify({
    version: 1,
    default_effect: "allow",
    automation: {
      enabled: true,
      completion: { require_explicit_close_trigger: true },
      parent_tasks: { auto_complete_when_subtasks_complete: false },
    },
    rules: [],
  })

  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))
    calls.push({ path: requestURL.pathname, method: options.method || "GET", body: options.body })

    if (requestURL.pathname === "/api/v1.0/tasks/child-1" && (options.method || "GET") === "GET") {
      return Response.json({ id: "child-1", nice_id: "MBC-713", task_id: "parent-1", project_id: "p1" })
    }
    if (requestURL.pathname === "/api/v1.0/tasks/child-1/complete" && options.method === "POST") {
      return Response.json({ ok: true, id: "child-1", completed: true })
    }

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  const output = await plugin.tool.nifty_complete_task.execute({ task_id: "child-1", completed: true }, context())
  const parsed = JSON.parse(output)

  assert.equal(parsed.id, "child-1")
  assert.equal(parsed.completed, true)
  assert.deepEqual(calls.map((call) => [call.method, call.path]), [
    ["GET", "/api/v1.0/tasks/child-1"],
    ["POST", "/api/v1.0/tasks/child-1/complete"],
  ])
  assert.deepEqual(JSON.parse(calls[1].body), { completed: true })
})

test("nifty_complete_child_task is idempotent under concurrent retries and posts Cave Updater once", async () => {
  const lockDir = await mkdtemp(join(tmpdir(), "nifty-workflow-lock-"))
  process.env.NIFTY_WORKFLOW_LOCK_DIR = lockDir

  let childCompleted = false
  const comments = []
  let completePosts = 0
  let commentPosts = 0

  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))
    if (requestURL.pathname === "/api/v1.0/tasks/child-1" && (options.method || "GET") === "GET") {
      return Response.json({ id: "child-1", nice_id: "MBC-713", name: "Child", task_id: "parent-1", project_id: "p1", completed: childCompleted })
    }
    if (requestURL.pathname === "/api/v1.0/tasks/child-1/complete" && options.method === "POST") {
      completePosts += 1
      childCompleted = JSON.parse(options.body).completed
      return Response.json({ ok: true, id: "child-1", completed: childCompleted })
    }
    if (requestURL.pathname === "/api/v1.0/messages" && (options.method || "GET") === "GET") {
      return Response.json({ items: comments })
    }
    if (requestURL.pathname === "/api/v1.0/messages" && options.method === "POST") {
      commentPosts += 1
      const body = JSON.parse(options.body)
      const comment = { id: `comment-${commentPosts}`, text: body.text, task_id: body.task_id }
      comments.push(comment)
      return Response.json(comment, { status: 201 })
    }

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  const args = {
    child_task_id: "child-1",
    parent_task_id: "parent-1",
    idempotency_key: "child-1-proof-a",
    what_was_done: "Implemented and verified the child task.",
    evidence_tests: [
      "RED: `npx -y node@20 --test test/tools.test.mjs --test-name-pattern child` failed before implementation.",
      "GREEN: `npx -y node@20 --test test/tools.test.mjs --test-name-pattern child` passed after implementation.",
    ].join("\n"),
    how_to_verify: [
      "Re-run the GREEN command.",
      "Visual regression proof: attached Playwright screenshot showing the child completion update on the task card.",
    ].join("\n"),
  }

  const [first, second] = await Promise.all([
    plugin.tool.nifty_complete_child_task.execute(args, context()),
    plugin.tool.nifty_complete_child_task.execute(args, context()),
  ])
  const parsed = [JSON.parse(first), JSON.parse(second)]

  assert.equal(completePosts, 1)
  assert.equal(commentPosts, 1)
  assert.equal(parsed.every((item) => item.completed === true), true)
  assert.equal(comments[0].task_id, "child-1")
  assert.match(comments[0].text, /^🤖 Cave Updater/)
  assert.match(comments[0].text, /## What was done/)
  assert.match(comments[0].text, /## Evidence \/ Tests/)
  assert.match(comments[0].text, /## How to verify/)
})

test("nifty_complete_task does not auto-complete the parent without explicit parent close confirmation", async () => {
  process.env.NIFTY_POLICY_INLINE = JSON.stringify({
    version: 1,
    default_effect: "allow",
    automation: {
      enabled: true,
      parent_tasks: { auto_complete_when_subtasks_complete: true, comment_on_auto_complete: true },
    },
    rules: [],
  })

  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))
    calls.push({ path: requestURL.pathname, method: options.method || "GET", body: options.body, query: requestURL.search })

    if (requestURL.pathname === "/api/v1.0/tasks/child-1" && (options.method || "GET") === "GET") {
      return Response.json({ id: "child-1", task_id: "parent-1", project_id: "p1", completed: true })
    }
    if (requestURL.pathname === "/api/v1.0/tasks/parent-1" && (options.method || "GET") === "GET") {
      return Response.json({ id: "parent-1", project_id: "p1", completed: false })
    }
    if (requestURL.pathname === "/api/v1.0/messages") {
      return Response.json({ items: [] })
    }
    if (requestURL.pathname === "/api/v1.0/projects") {
      return Response.json({ projects: [{ id: "p1", name: "Project 1", nice_id: "P1" }] })
    }
    if (requestURL.pathname === "/api/v1.0/taskgroups") {
      return Response.json({ items: [{ id: "s1", name: "In Progress" }] })
    }
    if (requestURL.pathname === "/api/v1.0/milestones") {
      return Response.json({ items: [] })
    }
    if (requestURL.pathname === "/api/v1.0/tasks" && !options.method) {
      return Response.json({
        tasks: [
          { id: "child-1", task_id: "parent-1", completed: true },
          { id: "child-2", task_id: "parent-1", completed: true },
        ],
      })
    }
    if (requestURL.pathname === "/api/v1.0/tasks/child-1/complete" && options.method === "POST") {
      return Response.json({ ok: true })
    }
    if (requestURL.pathname === "/api/v1.0/tasks/parent-1/complete" && options.method === "POST") {
      return Response.json({ ok: true })
    }

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  const output = await plugin.tool.nifty_complete_task.execute(
    { task_id: "child-1", completed: true, close_confirmation: "close child-1" },
    context(),
  )
  const parsed = JSON.parse(output)

  assert.equal(parsed.parent_automation.parent_task_id, "parent-1")
  assert.equal(parsed.parent_automation.completed, false)
  assert.equal(parsed.parent_automation.blocked, true)
  assert.match(parsed.parent_automation.reason, /close parent-1/i)
  assert.equal(calls.some((call) => call.path === "/api/v1.0/tasks/parent-1/complete" && call.method === "POST"), false)
})

test("nifty_move_task_to_status rejects subtasks because subtasks are checked off", async () => {
  process.env.NIFTY_AUTOPOLICY_ENABLED = "true"

  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))
    calls.push({ path: requestURL.pathname, method: options.method || "GET", body: options.body })

    if (requestURL.pathname === "/api/v1.0/tasks/sub-1" && (options.method || "GET") === "GET") {
      return Response.json({ id: "sub-1", task_id: "parent-1", project_id: "p1", task_group_id: "s-todo" })
    }

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  await assert.rejects(
    () => plugin.tool.nifty_move_task_to_status.execute(
      { task_id: "sub-1", project_id: "p1", status_name: "Dev Review" },
      context(),
    ),
    /subtask.*nifty_complete_task/i,
  )

  assert.deepEqual(calls, [{ path: "/api/v1.0/tasks/sub-1", method: "GET", body: undefined }])
})

test("nifty_update_task rejects status changes for subtasks", async () => {
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))
    calls.push({ path: requestURL.pathname, method: options.method || "GET", body: options.body })

    if (requestURL.pathname === "/api/v1.0/tasks/sub-1" && (options.method || "GET") === "GET") {
      return Response.json({ id: "sub-1", parent_task_id: "parent-1", project_id: "p1", task_group_id: "s-todo" })
    }

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  await assert.rejects(
    () => plugin.tool.nifty_update_task.execute(
      { task_id: "sub-1", task_group_id: "s-dev" },
      context(),
    ),
    /Hard gate.*nifty_update_task.*subtask/i,
  )

  assert.deepEqual(calls, [{ path: "/api/v1.0/tasks/sub-1", method: "GET", body: undefined }])
})

test("subtask entity gate blocks task-card comments on subtask targets", async () => {
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))
    calls.push({ path: requestURL.pathname, method: options.method || "GET", body: options.body })

    if (requestURL.pathname === "/api/v1.0/tasks/sub-1" && (options.method || "GET") === "GET") {
      return Response.json({ id: "sub-1", nice_id: "MBC-468", task_id: "parent-1", project_id: "p1" })
    }

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  await assert.rejects(
    () => plugin.tool.nifty_create_comment.execute(
      { task_id: "sub-1", text: taskCommentTemplate() },
      context(),
    ),
    /Hard gate.*subtask.*parent task parent-1/i,
  )

  assert.deepEqual(calls, [{ path: "/api/v1.0/tasks/sub-1", method: "GET", body: undefined }])
})

test("subtask entity gate blocks delivery preparation on subtask targets", async () => {
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))
    calls.push({ path: requestURL.pathname, method: options.method || "GET", body: options.body })

    if (requestURL.pathname === "/api/v1.0/tasks/sub-1" && (options.method || "GET") === "GET") {
      return Response.json({ id: "sub-1", task_id: "parent-1", project_id: "p1", task_group_id: "s1" })
    }

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  await assert.rejects(
    () => plugin.tool.nifty_prepare_task_for_delivery.execute(
      { task_id: "sub-1", project_id: "p1", summary: "Should be parent-only" },
      context(),
    ),
    /Hard gate.*nifty_prepare_task_for_delivery.*subtask/i,
  )

  assert.deepEqual(calls, [{ path: "/api/v1.0/tasks/sub-1", method: "GET", body: undefined }])
})

test("subtask entity gate blocks archive on subtask targets", async () => {
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))
    calls.push({ path: requestURL.pathname, method: options.method || "GET", body: options.body })

    if (requestURL.pathname === "/api/v1.0/tasks/sub-1" && (options.method || "GET") === "GET") {
      return Response.json({ id: "sub-1", task_id: "parent-1", project_id: "p1" })
    }

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  await assert.rejects(
    () => plugin.tool.nifty_archive_task.execute({ task_id: "sub-1", archived: true }, context()),
    /Hard gate.*nifty_archive_task.*subtask/i,
  )

  assert.deepEqual(calls, [{ path: "/api/v1.0/tasks/sub-1", method: "GET", body: undefined }])
})

test("subtask entity gate blocks bulk task-card moves containing subtasks", async () => {
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))
    calls.push({ path: requestURL.pathname, method: options.method || "GET", body: options.body })

    if (requestURL.pathname === "/api/v1.0/tasks/task-1" && (options.method || "GET") === "GET") {
      return Response.json({ id: "task-1", project_id: "p1" })
    }
    if (requestURL.pathname === "/api/v1.0/tasks/sub-1" && (options.method || "GET") === "GET") {
      return Response.json({ id: "sub-1", task_id: "parent-1", project_id: "p1" })
    }

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  await assert.rejects(
    () => plugin.tool.nifty_move_tasks.execute(
      { task_ids: ["task-1", "sub-1"], target_type: "task_group", target_id: "s-dev" },
      context(),
    ),
    /Hard gate.*nifty_move_tasks.*subtask/i,
  )

  assert.deepEqual(calls.map((call) => [call.method, call.path]), [
    ["GET", "/api/v1.0/tasks/task-1"],
    ["GET", "/api/v1.0/tasks/sub-1"],
  ])
})

test("subtask entity gate allows explicit subtask completion", async () => {
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))
    calls.push({ path: requestURL.pathname, method: options.method || "GET", body: options.body })

    if (requestURL.pathname === "/api/v1.0/tasks/sub-1/complete" && options.method === "POST") {
      return Response.json({ ok: true })
    }
    if (requestURL.pathname === "/api/v1.0/tasks/sub-1" && (options.method || "GET") === "GET") {
      return Response.json({ id: "sub-1", task_id: "parent-1", project_id: "p1", completed: true })
    }
    if (requestURL.pathname === "/api/v1.0/tasks/parent-1" && (options.method || "GET") === "GET") {
      return Response.json({ id: "parent-1", project_id: "p1", completed: false })
    }
    if (requestURL.pathname === "/api/v1.0/messages") return Response.json({ items: [] })
    if (requestURL.pathname === "/api/v1.0/projects") return Response.json({ projects: [{ id: "p1", name: "Project One" }] })
    if (requestURL.pathname === "/api/v1.0/taskgroups") return Response.json({ items: [] })
    if (requestURL.pathname === "/api/v1.0/milestones") return Response.json({ items: [] })
    if (requestURL.pathname === "/api/v1.0/tasks" && !options.method) return Response.json({ tasks: [] })

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  const output = await plugin.tool.nifty_complete_task.execute(
    { task_id: "sub-1", completed: true, close_confirmation: "close sub-1" },
    context(),
  )
  const parsed = JSON.parse(output)

  assert.equal(parsed.ok, true)
  assert.equal(calls.some((call) => call.path === "/api/v1.0/tasks/sub-1/complete" && call.method === "POST"), true)
})

test("auto lifecycle start hard-gates task-card comments on subtasks", async () => {
  process.env.NIFTY_AUTOPOLICY_ENABLED = "true"
  process.env.NIFTY_POLICY_INLINE = JSON.stringify({
    version: 1,
    default_effect: "allow",
    automation: { enabled: true },
    rules: [],
  })

  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))
    calls.push({ path: requestURL.pathname, method: options.method || "GET", body: options.body })

    if (requestURL.pathname === "/api/v1.0/tasks/sub-1" && (options.method || "GET") === "GET") {
      return Response.json({ id: "sub-1", task_id: "parent-1", project_id: "p1", task_group_id: "s-todo" })
    }
    if (requestURL.pathname === "/api/v1.0/messages" && options.method === "POST") {
      return Response.json({ id: "m1" }, { status: 201 })
    }

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  await assert.rejects(
    () => plugin.tool.nifty_create_comment.execute(
      { task_id: "sub-1", text: taskCommentTemplate() },
      context(),
    ),
    /Hard gate.*nifty_create_comment.*subtask/i,
  )

  assert.deepEqual(calls.map((call) => [call.method, call.path]), [
    ["GET", "/api/v1.0/tasks/sub-1"],
  ])
})

test("nifty_create_comment rejects malformed task update comments before API calls", async () => {
  globalThis.fetch = async () => {
    throw new Error("Should not reach API")
  }

  const plugin = await NiftyPlugin()
  await assert.rejects(
    () => plugin.tool.nifty_create_comment.execute(
      { task_id: "t1", text: "Fixed it." },
      context(),
    ),
    /Task-card update comments require a template/i,
  )
})

test("nifty_move_task_to_status rejects malformed task comment before status mutation", async () => {
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))
    calls.push({ path: requestURL.pathname, method: options.method || "GET", body: options.body })

    if (requestURL.pathname === "/api/v1.0/tasks/t1" && (options.method || "GET") === "GET") {
      return Response.json({ id: "t1", project_id: "p1", task_group_id: "s-todo" })
    }
    if (requestURL.pathname === "/api/v1.0/taskgroups") {
      return Response.json({ items: [{ id: "s-progress", name: "In Progress" }] })
    }

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  await assert.rejects(
    () => plugin.tool.nifty_move_task_to_status.execute(
      { task_id: "t1", project_id: "p1", status_name: "In Progress", comment: "Started." },
      context(),
    ),
    /Task-card update comments require a template/i,
  )

  assert.equal(calls.some((call) => call.path === "/api/v1.0/tasks/t1" && call.method === "PUT"), false)
  assert.equal(calls.some((call) => call.path === "/api/v1.0/messages" && call.method === "POST"), false)
})

test("tool.execute.after posts a first-edit progress comment once for the active task", async () => {
  process.env.NIFTY_POLICY_INLINE = JSON.stringify({
    version: 1,
    default_effect: "allow",
    automation: {
      enabled: true,
      progress_comments: {
        enabled: true,
        milestones: ["first_edit"],
        edit_tools: ["apply_patch"],
      },
    },
    rules: [],
  })

  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))
    calls.push({ path: requestURL.pathname, method: options.method || "GET", body: options.body })
    if (requestURL.pathname === "/api/v1.0/messages" && options.method === "POST") {
      return Response.json({ id: "m1" }, { status: 201 })
    }
    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()

  await plugin["tool.execute.after"](
    { tool: "nifty_get_task", sessionID: "sess-1", callID: "1", args: { task_id: "t1" } },
    { title: "Task", output: JSON.stringify({ id: "t1" }), metadata: {} },
  )
  await plugin["tool.execute.after"](
    { tool: "apply_patch", sessionID: "sess-1", callID: "2", args: {} },
    { title: "Patch", output: "patched", metadata: {} },
  )
  await plugin["tool.execute.after"](
    { tool: "apply_patch", sessionID: "sess-1", callID: "3", args: {} },
    { title: "Patch", output: "patched again", metadata: {} },
  )

  const messagePosts = calls.filter((call) => call.path === "/api/v1.0/messages" && call.method === "POST")
  assert.equal(messagePosts.length, 1)
  const postedText = JSON.parse(messagePosts[0].body).text
  assert.match(postedText, /^🤖 Cave Updater/)
  assert.match(postedText, /First edit/i)
})

test("tool.execute.after prompts for task card when automation loses task context", async () => {
  process.env.NIFTY_POLICY_INLINE = JSON.stringify({
    version: 1,
    default_effect: "allow",
    automation: {
      enabled: true,
      progress_comments: {
        enabled: true,
        milestones: ["first_edit"],
        edit_tools: ["apply_patch"],
      },
      task_context_gate: {
        enabled: true,
        prompt_on_context_loss: true,
        hard_fail_if_unresolved: true,
      },
    },
    rules: [],
  })

  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))
    calls.push({ path: requestURL.pathname, method: options.method || "GET", body: options.body })
    if (requestURL.pathname === "/api/v1.0/messages" && options.method === "POST") {
      return Response.json({ id: "m2" }, { status: 201 })
    }
    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  let askCalls = 0
  const plugin = await NiftyPlugin()
  await plugin["tool.execute.after"](
    {
      tool: "apply_patch",
      sessionID: "sess-ctx-prompt",
      callID: "ctx-1",
      args: {},
      context: context({
        ask: async () => {
          askCalls += 1
          return "MBC-999"
        },
      }),
    },
    { title: "Patch", output: "patched", metadata: {} },
  )

  assert.equal(askCalls, 1)
  const messagePosts = calls.filter((call) => call.path === "/api/v1.0/messages" && call.method === "POST")
  assert.equal(messagePosts.length, 1)
  const payload = JSON.parse(messagePosts[0].body)
  assert.equal(payload.task_id, "MBC-999")
  assert.match(payload.text, /First edit/i)
})

test("tool.execute.after hard-fails when task context is missing and prompt cannot recover task card", async () => {
  process.env.NIFTY_POLICY_INLINE = JSON.stringify({
    version: 1,
    default_effect: "allow",
    automation: {
      enabled: true,
      progress_comments: {
        enabled: true,
        milestones: ["first_edit"],
        edit_tools: ["apply_patch"],
      },
      task_context_gate: {
        enabled: true,
        prompt_on_context_loss: true,
        hard_fail_if_unresolved: true,
      },
    },
    rules: [],
  })

  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))
    calls.push({ path: requestURL.pathname, method: options.method || "GET", body: options.body })
    if (requestURL.pathname === "/api/v1.0/messages" && options.method === "POST") {
      return Response.json({ id: "m3" }, { status: 201 })
    }
    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  await assert.rejects(
    () => plugin["tool.execute.after"](
      {
        tool: "apply_patch",
        sessionID: "sess-ctx-fail",
        callID: "ctx-2",
        args: {},
        context: context({
          ask: async () => {
            throw new Error("Interactive prompt not available")
          },
        }),
      },
      { title: "Patch", output: "patched", metadata: {} },
    ),
    /AutomationGate|task-card context/i,
  )

  const messagePosts = calls.filter((call) => call.path === "/api/v1.0/messages" && call.method === "POST")
  assert.equal(messagePosts.length, 0)
})

test("move_task_to_status blocks Dev Review transition without delivery evidence", async () => {
  process.env.NIFTY_AUTOPOLICY_ENABLED = "true"
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))
    calls.push({ path: requestURL.pathname, method: options.method || "GET", body: options.body })

    if (requestURL.pathname === "/api/v1.0/tasks/t1") {
      if ((options.method || "GET") === "GET") {
        return Response.json({ id: "t1", project_id: "p1", task_group_id: "s-todo" })
      }
      return Response.json({ ok: true })
    }

    if (requestURL.pathname === "/api/v1.0/taskgroups") {
      return Response.json({ items: [{ id: "s-todo", name: "To Do" }, { id: "s-dev", name: "Dev Review" }] })
    }

    if (requestURL.pathname === "/api/v1.0/messages") {
      return Response.json({ ok: true })
    }

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  await assert.rejects(
    () => plugin.tool.nifty_move_task_to_status.execute(
      { task_id: "t1", project_id: "p1", status_name: "Dev Review" },
      context(),
    ),
    /delivery_evidence\.red_proof/i,
  )

  assert.equal(calls.some((call) => call.method === "PUT" && call.path === "/api/v1.0/tasks/t1"), false)
})

test("move_task_to_status blocks Done-like status move without explicit close confirmation", async () => {
  process.env.NIFTY_AUTOPOLICY_ENABLED = "true"
  process.env.NIFTY_POLICY_INLINE = JSON.stringify({
    version: 1,
    default_effect: "allow",
    automation: {
      enabled: true,
      completion: {
        sync_done_status_with_complete: true,
        require_explicit_close_trigger: true,
      },
    },
    rules: [],
  })

  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))
    calls.push({ path: requestURL.pathname, method: options.method || "GET", body: options.body })

    if (requestURL.pathname === "/api/v1.0/tasks/t1" && (options.method || "GET") === "GET") {
      return Response.json({ id: "t1", project_id: "p1", task_group_id: "s-todo" })
    }
    if (requestURL.pathname === "/api/v1.0/taskgroups") {
      return Response.json({ items: [{ id: "s-done", name: "Done" }] })
    }

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  await assert.rejects(
    () => plugin.tool.nifty_move_task_to_status.execute(
      { task_id: "t1", project_id: "p1", status_name: "Done" },
      context(),
    ),
    /close_confirmation.*close t1/i,
  )

  assert.equal(calls.some((call) => call.path === "/api/v1.0/tasks/t1" && call.method === "PUT"), false)
  assert.equal(calls.some((call) => call.path === "/api/v1.0/tasks/t1/complete" && call.method === "POST"), false)
})

test("move_task_to_status writes delivery gate comment and moves to Dev Review with evidence", async () => {
  process.env.NIFTY_AUTOPOLICY_ENABLED = "true"
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))
    calls.push({ path: requestURL.pathname, method: options.method || "GET", body: options.body })

    if (requestURL.pathname === "/api/v1.0/tasks/t1") {
      if ((options.method || "GET") === "GET") {
        return Response.json({ id: "t1", project_id: "p1", task_group_id: "s-todo" })
      }
      return Response.json({ id: "t1", task_group_id: "s-dev" })
    }

    if (requestURL.pathname === "/api/v1.0/taskgroups") {
      return Response.json({ items: [{ id: "s-todo", name: "To Do" }, { id: "s-dev", name: "Dev Review" }] })
    }

    if (requestURL.pathname === "/api/v1.0/messages") {
      return Response.json({ id: "m1" })
    }

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  await plugin.tool.nifty_move_task_to_status.execute(
    {
      task_id: "t1",
      project_id: "p1",
      status_name: "Dev Review",
      delivery_evidence: {
        red_proof: "npm test -- test/lifecycle-policy.test.mjs",
        green_proof: "npm test",
        sad_path_proof: "verified missing evidence is blocked",
        architecture_proof: "Integrated through the existing lifecycle delivery gate and policy validator instead of adding a parallel review path.",
        regression_proof: "Updated lifecycle policy regression tests to require strict evidence before Dev Review movement.",
        iterative_proof: "Captured RED failure for missing strict proof, implemented validator changes, then reran focused and full suites.",
        visual_proof: ["https://example.com/playwright/dev-review-proof.png"],
        changed_files: ["backend/app/Services/Workflow.php"],
      },
    },
    context(),
  )

  assert.equal(calls.some((call) => call.path === "/api/v1.0/messages" && call.method === "POST"), true)
  assert.equal(calls.some((call) => call.path === "/api/v1.0/tasks/t1" && call.method === "PUT"), true)
})

test("clone and attach document tools send Nifty string bodies", async () => {
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))
    calls.push({ path: requestURL.pathname, method: options.method || "GET", body: options.body })
    return Response.json({ ok: true })
  }

  const plugin = await NiftyPlugin()
  await plugin.tool.nifty_clone_task.execute({ task_id: "t1" }, context())
  await plugin.tool.nifty_attach_task_document.execute({ task_id: "t1", document_id: "d1" }, context())

  assert.deepEqual(calls.map((call) => [call.method, call.path]), [
    ["GET", "/api/v1.0/tasks/t1"],
    ["POST", "/api/v1.0/tasks/t1/clone"],
    ["GET", "/api/v1.0/tasks/t1"],
    ["PUT", "/api/v1.0/tasks/t1/documents"],
  ])
  assert.equal(calls[1].body, JSON.stringify(""))
  assert.equal(calls[3].body, JSON.stringify({ document_id: "d1" }))
})

test("nifty_update_comment can attach external visual proof URLs", async () => {
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))
    calls.push({ path: requestURL.pathname, method: options.method || "GET", body: options.body })
    return Response.json({ id: "m1" })
  }

  const plugin = await NiftyPlugin()
  await plugin.tool.nifty_update_comment.execute({
    message_id: "m1",
    text: taskCommentTemplate(),
    external_files: ["https://example.com/proof.png"],
    nifty_files: ["file-1"],
  }, context())

  assert.deepEqual(calls.map((call) => [call.method, call.path]), [
    ["PUT", "/api/v1.0/messages/m1"],
  ])
  assert.deepEqual(JSON.parse(calls[0].body).external_files, ["https://example.com/proof.png"])
  assert.deepEqual(JSON.parse(calls[0].body).nifty_files, ["file-1"])
})

test("recommended workflow tool returns lifecycle and config snippet", async () => {
  const plugin = await NiftyPlugin()
  const output = await plugin.tool.nifty_recommended_workflow.execute(
    { workflow_alias: "gov", project_nice_id: "GOV" },
    context(),
  )
  const parsed = JSON.parse(output)

  assert.equal(parsed.workflow_alias, "gov")
  assert.equal(parsed.config_snippet.workflows.gov.project.nice_id, "GOV")
  assert.equal(parsed.config_snippet.workflows.gov.states.in_progress, "In Progress")
  assert.equal(parsed.config_snippet.workflows.gov.lists.ui, "UI")
})

test("recommended workflow setup dry-run reports missing statuses and lists", async () => {
  globalThis.fetch = async (url) => {
    const requestURL = new URL(String(url))

    if (requestURL.pathname === "/api/v1.0/projects") {
      return Response.json({ projects: [{ id: "p1", name: "Gov CMS", nice_id: "GOV" }] })
    }
    if (requestURL.pathname === "/api/v1.0/taskgroups") {
      return Response.json({ items: [{ id: "s-todo", name: "To Do" }] })
    }
    if (requestURL.pathname === "/api/v1.0/milestones") {
      assert.equal(requestURL.searchParams.get("is_list"), "true")
      return Response.json({ items: [{ id: "m-ui", name: "UI", is_list: true }] })
    }

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  const output = await plugin.tool.nifty_setup_recommended_workflow.execute(
    { workflow_alias: "gov", project_name: "Gov CMS", dry_run: true },
    context(),
  )
  const parsed = JSON.parse(output)

  assert.equal(parsed.dry_run, true)
  assert.deepEqual(parsed.statuses.existing, [{ key: "todo", name: "To Do", id: "s-todo" }])
  assert.equal(parsed.statuses.missing.some((status) => status.name === "In Progress"), true)
  assert.deepEqual(parsed.lists.existing, [{ key: "ui", name: "UI", id: "m-ui" }])
  assert.equal(parsed.config_snippet.workflows.gov.project.nice_id, "GOV")
  assert.equal(parsed.config_write, null)
})

test("recommended workflow setup writes project-local workflow config when requested", async () => {
  const projectDir = await mkdtemp(join(tmpdir(), "nifty-write-config-"))
  globalThis.fetch = async (url) => {
    const requestURL = new URL(String(url))

    if (requestURL.pathname === "/api/v1.0/projects") {
      return Response.json({ projects: [{ id: "p1", name: "Gov CMS", nice_id: "GOV" }] })
    }
    if (requestURL.pathname === "/api/v1.0/taskgroups") {
      return Response.json({ items: [] })
    }
    if (requestURL.pathname === "/api/v1.0/milestones") {
      return Response.json({ items: [] })
    }

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  const output = await plugin.tool.nifty_setup_recommended_workflow.execute(
    { workflow_alias: "gov", project_name: "Gov CMS", dry_run: true, write_config: true },
    context({ directory: projectDir }),
  )
  const parsed = JSON.parse(output)
  const writtenConfig = JSON.parse(await readFile(join(projectDir, "nifty-workflows.json"), "utf8"))

  assert.equal(parsed.config_write.path, join(projectDir, "nifty-workflows.json"))
  assert.equal(parsed.config_write.written, true)
  assert.equal(writtenConfig.workflows.gov.project.nice_id, "GOV")
  assert.equal(writtenConfig.workflows.gov.states.ready_for_prod, "Ready for Prod")
})

test("recommended workflow setup creates missing statuses and lists when dry_run is false", async () => {
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))
    calls.push({ path: requestURL.pathname, method: options.method || "GET", body: options.body })

    if (requestURL.pathname === "/api/v1.0/taskgroups" && !options.method) {
      return Response.json({ items: [] })
    }
    if (requestURL.pathname === "/api/v1.0/milestones" && !options.method) {
      return Response.json({ items: [] })
    }
    if (requestURL.pathname === "/api/v1.0/taskgroups" && options.method === "POST") {
      const body = JSON.parse(options.body)
      return Response.json({ id: `s-${body.name}`, ...body })
    }
    if (requestURL.pathname === "/api/v1.0/milestones" && options.method === "POST") {
      const body = JSON.parse(options.body)
      return Response.json({ id: `m-${body.name}`, ...body })
    }

    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  const plugin = await NiftyPlugin()
  const output = await plugin.tool.nifty_setup_recommended_workflow.execute(
    { workflow_alias: "gov", project_id: "p1", dry_run: false },
    context(),
  )
  const parsed = JSON.parse(output)
  const statusCreates = calls.filter((call) => call.path === "/api/v1.0/taskgroups" && call.method === "POST")
  const listCreates = calls.filter((call) => call.path === "/api/v1.0/milestones" && call.method === "POST")

  assert.equal(parsed.dry_run, false)
  assert.equal(statusCreates.length, 14)
  assert.equal(listCreates.length, 9)
  assert.deepEqual(JSON.parse(statusCreates[0].body), {
    project_id: "p1",
    name: "Ideas",
  })
  assert.deepEqual(JSON.parse(listCreates[0].body), {
    project_id: "p1",
    name: "UI",
    description: "",
    is_list: true,
  })
})
