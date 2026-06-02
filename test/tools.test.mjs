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
  globalThis.fetch = async (url, options = {}) => {
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

  let metadataPayload
  const plugin = await NiftyPlugin()
  await plugin.tool.nifty_get_task.execute(
    { task_id: "t1" },
    context({
      metadata(payload) {
        metadataPayload = payload
      },
    }),
  )

  assert.equal(metadataPayload?.metadata?.task_context?.task?.id, "t1")
  assert.equal(metadataPayload?.metadata?.task_context?.comments?.length, 1)
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
    ["PUT", "/api/v1.0/tasks/t1/fields/field-1"],
  ])
  assert.deepEqual(JSON.parse(calls[0].body), { value: "Deployment" })
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
    ["PUT", "/api/v1.0/tasks/t1/fields/field-1"],
  ])
  assert.deepEqual(JSON.parse(calls[0].body), { value: "Deployment" })
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
    ["PUT", "/api/v1.0/tasks/t1"],
    ["PUT", "/api/v1.0/tasks/t1/fields/field-1"],
  ])
  assert.deepEqual(JSON.parse(calls[0].body), { name: "Updated task" })
  assert.deepEqual(JSON.parse(calls[1].body), { value: "Deployment" })
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

  assert.deepEqual(calls.map((call) => [call.method, call.path]), [["DELETE", "/api/v1.0/tasks"]])
  assert.deepEqual(JSON.parse(calls[0].body), { project_id: "p1", task_ids: ["t1", "t2"] })
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
    ["POST", "/api/v1.0/tasks/t1/complete"],
    ["POST", "/api/v1.0/tasks/t1/archive"],
    ["POST", "/api/v1.0/tasks/t1/link_task"],
    ["PUT", "/api/v1.0/tasks/t1/labels"],
  ])
  assert.deepEqual(JSON.parse(calls[0].body), { completed: true })
  assert.deepEqual(JSON.parse(calls[2].body), { tasks: ["t2"] })
  assert.deepEqual(JSON.parse(calls[3].body), { labels: ["l1"] })
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

  assert.deepEqual(calls, [])
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
    /subtask.*checked off/i,
  )

  assert.deepEqual(calls, [{ path: "/api/v1.0/tasks/sub-1", method: "GET", body: undefined }])
})

test("auto lifecycle start does not move subtasks before comments", async () => {
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
  await plugin.tool.nifty_create_comment.execute(
    { task_id: "sub-1", text: "Finished and checked off." },
    context(),
  )

  assert.deepEqual(calls.map((call) => [call.method, call.path]), [
    ["GET", "/api/v1.0/tasks/sub-1"],
    ["POST", "/api/v1.0/messages"],
  ])
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
  assert.match(postedText, /^🤖 McBotFace/)
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
    ["POST", "/api/v1.0/tasks/t1/clone"],
    ["PUT", "/api/v1.0/tasks/t1/documents"],
  ])
  assert.equal(calls[0].body, JSON.stringify(""))
  assert.equal(calls[1].body, JSON.stringify({ document_id: "d1" }))
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
