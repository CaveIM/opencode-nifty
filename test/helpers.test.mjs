import assert from "node:assert/strict"
import { test } from "node:test"
import { __test } from "../plugin/nifty.js"

test("normalizes user-facing names for matching", () => {
  assert.equal(__test.normalize(" Small But Mighty Dev! "), "small but mighty dev")
})

test("matches projects by id, nice_id, or name", () => {
  const project = { id: "abc123", nice_id: "DEV", name: "Small But Mighty Dev" }

  assert.equal(__test.projectMatches(project, "abc123"), true)
  assert.equal(__test.projectMatches(project, "dev"), true)
  assert.equal(__test.projectMatches(project, "small but mighty dev"), true)
  assert.equal(__test.projectMatches(project, "missing"), false)
})

test("matches statuses by id or name", () => {
  const status = { id: "s1", name: "DEV Review" }

  assert.equal(__test.statusMatches(status, "s1"), true)
  assert.equal(__test.statusMatches(status, "dev review"), true)
  assert.equal(__test.statusMatches(status, "review"), false)
})

test("matches milestones and lists by id or name", () => {
  const milestone = { id: "m1", name: "Phase One" }

  assert.equal(__test.milestoneMatches(milestone, "m1"), true)
  assert.equal(__test.milestoneMatches(milestone, "phase one"), true)
  assert.equal(__test.milestoneMatches(milestone, "phase"), false)
})

test("renders structured task descriptions", () => {
  const description = __test.buildTaskDescription({
    summary: "Add retries",
    acceptance_criteria: ["Retries transient failures", "Stops after max attempts"],
    checklist: ["Add tests"],
  })

  assert.match(description, /## Summary\nAdd retries/)
  assert.match(description, /- Retries transient failures/)
  assert.match(description, /- \[ \] Add tests/)
})

test("prefixes bot comments with a robot marker", () => {
  assert.equal(__test.botCommentText("Starting work"), "🤖 Starting work")
  assert.equal(__test.botCommentText("🤖 Already marked"), "🤖 Already marked")
  assert.equal(__test.botCommentText("   Trimmed"), "🤖 Trimmed")
  assert.equal(__test.botCommentText("Personal note", false), "Personal note")
})

test("builds recommended workflow config snippets", () => {
  const config = __test.recommendedWorkflowConfig("gov", { nice_id: "GOV" })

  assert.equal(config.workflows.gov.project.nice_id, "GOV")
  assert.equal(config.workflows.gov.states.ready, "Ready")
  assert.equal(config.workflows.gov.states.ready_for_prod, "Ready for Prod")
  assert.equal(config.workflows.gov.lists.data, "Data/Migrations")
})

test("detects usable and expired tokens", () => {
  assert.equal(
    __test.isTokenUsable({ access_token: "token", expires_at: Date.now() + 5 * 60 * 1000 }),
    true,
  )
  assert.equal(
    __test.isTokenUsable({ access_token: "token", expires_at: Date.now() - 1000 }),
    false,
  )
})

test("builds request query strings consistently", () => {
  const url = new URL("https://example.test/path")
  __test.appendQueryParams(url, {
    empty: "",
    omitted: undefined,
    single: "value",
    ids: ["a", "b"],
  })

  assert.equal(url.searchParams.get("single"), "value")
  assert.deepEqual(url.searchParams.getAll("ids"), ["a", "b"])
  assert.equal(url.searchParams.has("empty"), false)
  assert.equal(url.searchParams.has("omitted"), false)
})

test("filters tasks by exact status id", () => {
  const tasks = [
    { id: "1", task_group: "backlog" },
    { id: "2", task_group: "review" },
    { id: "3", task_group: null },
  ]

  assert.deepEqual(__test.filterTasksByStatus(tasks, "backlog").map((task) => task.id), ["1"])
})
