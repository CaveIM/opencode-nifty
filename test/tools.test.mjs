import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
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

test("workflow config uses explicit env path before project-local config", async () => {
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

  assert.equal(parsed.config_path, envConfig)
  assert.deepEqual(parsed.workflows.map((workflow) => workflow.alias), ["envAlias"])
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
  const configPath = join(dir, "workflows.json")
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
  process.env.NIFTY_WORKFLOW_CONFIG = configPath

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
    context(),
  )
  const parsed = JSON.parse(output)

  assert.deepEqual(parsed.tasks.map((task) => task.id), ["1"])
})

test("nifty_batch_capture_backlog_items dry-run plans standardized creates", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nifty-batch-"))
  const configPath = join(dir, "workflows.json")
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
  process.env.NIFTY_WORKFLOW_CONFIG = configPath

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
    context(),
  )
  const parsed = JSON.parse(output)

  assert.equal(parsed.dry_run, true)
  assert.equal(parsed.planned[0].task_group_id, "s1")
  assert.equal(parsed.planned[0].milestone_id, "m1")
  assert.match(parsed.planned[0].description, /Capture multiple ideas/)
})
