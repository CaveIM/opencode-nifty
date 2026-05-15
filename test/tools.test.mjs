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
          { id: "1", name: "Backlog task", task_group: "s1", completed: false },
          { id: "2", name: "Review task", task_group: "s2", completed: false },
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
  assert.deepEqual(capturedBody.content, { text: "Ship it" })
  assert.equal(parsed.document.doc_id, "d1")
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
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    const requestURL = new URL(String(url))
    calls.push({ path: requestURL.pathname, method: options.method || "GET", body: options.body })
    return Response.json({ ok: true })
  }

  const plugin = await NiftyPlugin()
  await plugin.tool.nifty_complete_task.execute({ task_id: "t1", completed: true }, context())
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
  assert.equal(calls[1].body, JSON.stringify("d1"))
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
  assert.equal(statusCreates.length, 13)
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
