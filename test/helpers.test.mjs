import assert from "node:assert/strict"
import { test } from "node:test"
import * as pluginModule from "../plugin/nifty.js"
import { NiftyPlugin } from "../plugin/nifty.js"

const { __test } = NiftyPlugin

test("exports OpenCode plugin and shared validators", () => {
  assert.deepEqual(Object.keys(pluginModule), ["NiftyPlugin"])
  assert.equal(typeof __test.validateNiftyTaskCommentTemplate, "function")
})

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
    open_questions: ["Which retry budget?"],
    checklist: ["Add tests"],
  })

  assert.match(description, /## Summary\nAdd retries/)
  assert.match(description, /- Retries transient failures/)
  assert.doesNotMatch(description, /Open Questions/)
  assert.match(description, /- \[ \] Add tests/)
})

test("blocks unresolved open questions before writing shaped tasks", () => {
  assert.doesNotThrow(() => __test.assertNoOpenQuestions({ open_questions: [" "] }))
  assert.throws(
    () => __test.assertNoOpenQuestions({ open_questions: ["Which API should this use?"] }, "task"),
    /Which API should this use\?/,
  )
})

test("asks shaping questions one field at a time", () => {
  assert.deepEqual(__test.nextShapingQuestion({}), {
    field: "summary",
    question: "What is the concise one- or two-sentence summary of this feature?",
  })
  assert.equal(__test.nextShapingQuestion({
    summary: "Add account exports",
    problem: "Users need their data",
    desired_outcome: "Users can download an export",
    user_experience: "Button in settings",
    acceptance_criteria: ["Export includes profile data"],
    security_privacy: "Only the account owner can export",
    performance: "Exports should complete in under 30 seconds",
    data_integrations: "Reads account tables",
    edge_cases: "No data returns an empty export",
    implementation_notes: "Use existing job queue",
    test_plan: "Unit test export serializer",
    rollout: "No flag needed",
    non_goals: "No admin bulk export",
  }), null)
})

test("builds shaped task descriptions without checklist duplication", () => {
  const description = __test.buildShapedTaskDescription({
    summary: "Add account exports",
    problem: "Users need their data",
    desired_outcome: "Users can download an export",
    user_experience: "Button in settings",
    acceptance_criteria: ["Export includes profile data"],
    security_privacy: "Only the account owner can export",
    performance: "Exports should complete in under 30 seconds",
    data_integrations: "Reads account tables",
    edge_cases: "No data returns an empty export",
    implementation_notes: "Use existing job queue",
    test_plan: "Unit test export serializer",
    rollout: "No flag needed",
    non_goals: "No admin bulk export",
  })

  assert.match(description, /## Security \/ Privacy/)
  assert.match(description, /## Acceptance Criteria/)
  assert.doesNotMatch(description, /Checklist/)
})

test("parses JSON string arguments", () => {
  assert.deepEqual(__test.parseJSONArg('{"text":"hello"}', "content_json"), { text: "hello" })
  assert.equal(__test.parseJSONArg(undefined, "content_json"), undefined)
  assert.throws(() => __test.parseJSONArg("{", "content_json"), /content_json must be valid JSON/)
})

test("parses dotenv-style Nifty env files", () => {
  assert.deepEqual(
    __test.parseEnvFile(`
# comment
NIFTY_CLIENT_ID=abc
NIFTY_CLIENT_SECRET="secret value"
NIFTY_AUTHORIZE_URL='https://nifty.pm/authorize?x=1'
`),
    {
      NIFTY_CLIENT_ID: "abc",
      NIFTY_CLIENT_SECRET: "secret value",
      NIFTY_AUTHORIZE_URL: "https://nifty.pm/authorize?x=1",
    },
  )
})

test("prefixes bot comments with the Cave Updater automation marker", () => {
  assert.equal(__test.botCommentText("Starting work"), "🤖 Cave Updater Starting work")
  assert.equal(__test.botCommentText("🤖 Cave Updater Already marked"), "🤖 Cave Updater Already marked")
  assert.equal(__test.botCommentText("🤖 McBotFace Legacy marker"), "🤖 Cave Updater Legacy marker")
  assert.equal(__test.botCommentText("[MCP Automation] Legacy marker"), "🤖 Cave Updater Legacy marker")
  assert.equal(__test.botCommentText("🤖 Legacy marker"), "🤖 Cave Updater Legacy marker")
  assert.equal(__test.botCommentText("   Trimmed"), "🤖 Cave Updater Trimmed")
  assert.equal(__test.botCommentText("Personal note", false), "Personal note")
})

test("detects mistaken Nifty shell health commands", () => {
  assert.match(__test.niftyShellCommandHint("nifty health check"), /nifty_health_check/)
  assert.match(__test.niftyShellCommandHint("nifty_health_check"), /nifty_health_check/)
  assert.equal(__test.niftyShellCommandHint("npm test"), undefined)
})

test("rejects dirty-only autonomous MCP task comments", () => {
  assert.throws(
    () => __test.validateNiftyTaskCommentTemplate({
      task_id: "MBC-462",
      text: [
        "## What was done",
        "MCP autonomous progress update detected local workspace changes.",
        "## Completed",
        "- Changed files detected.",
        "## Evidence / Tests",
        "- Task: MBC-462",
        "- Branch: dev-tony",
        "- HEAD: 957d7d81ff9679c1e396aa9db57eb4a4542eebae",
        "- Changed files:",
        "  - M plugin/nifty.js",
        "## How to verify",
        "- Review the listed local changes and continue implementation or validation.",
      ].join("\n"),
    }),
    /Dirty-only autonomous MCP progress comments are not useful/i,
  )
})

test("task comments require TDD and visual proof when code files changed", () => {
  assert.throws(
    () => __test.validateNiftyTaskCommentTemplate({
      task_id: "MBC-462",
      changed_files: ["plugin/nifty.js"],
      text: [
        "## What was done",
        "Updated the workflow gate.",
        "",
        "## Evidence / Tests",
        "`npx -y node@20 --test test/helpers.test.mjs` passed.",
        "",
        "## How to verify",
        "Re-run the focused helper test.",
      ].join("\n"),
    }),
    /TDD.*RED.*GREEN.*visual regression proof/i,
  )

  assert.doesNotThrow(() => __test.validateNiftyTaskCommentTemplate({
    task_id: "MBC-462",
    changed_files: ["README.md"],
    text: [
      "## What was done",
      "Updated documentation wording only.",
      "",
      "## Evidence / Tests",
      "Reviewed the rendered README section.",
      "",
      "## How to verify",
      "Open the README and confirm the MCP observer wording matches implementation.",
    ].join("\n"),
  }))

  assert.doesNotThrow(() => __test.validateNiftyTaskCommentTemplate({
    task_id: "MBC-462",
    changed_files: ["plugin/nifty.js"],
    text: [
      "## What was done",
      "Updated the workflow gate.",
      "",
      "## Evidence / Tests",
      "RED: `npx -y node@20 --test test/helpers.test.mjs` failed before implementation.",
      "GREEN: `npx -y node@20 --test test/helpers.test.mjs` passed after implementation.",
      "",
      "## How to verify",
      "Re-run the focused helper test.",
      "Visual regression proof: attached Playwright screenshot showing the task-card update format.",
    ].join("\n"),
  }))
})

test("builds recommended workflow config snippets", () => {
  const config = __test.recommendedWorkflowConfig("gov", { nice_id: "GOV" })

  assert.equal(config.workflows.gov.project.nice_id, "GOV")
  assert.equal(config.workflows.gov.states.todo, "To Do")
  assert.equal(config.workflows.gov.states.shaped, "Shaped")
  assert.equal(config.workflows.gov.states.planned, "Planned")
  assert.equal(config.workflows.gov.states.not_now, "Not Now")
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

test("compares installed and latest plugin source", () => {
  assert.equal(__test.samePluginSource("const a = 1\n", "const a = 1"), true)
  assert.equal(__test.samePluginSource("const a = 1", "const a = 2"), false)
})

test("requires exact bulk task confirmation", () => {
  assert.doesNotThrow(() => __test.requireBulkTaskConfirmation("delete", ["t1", "t2"], "delete 2 tasks"))
  assert.throws(
    () => __test.requireBulkTaskConfirmation("delete", ["t1", "t2"], "delete tasks"),
    /delete 2 tasks/,
  )
})

test("chooses recommended or legacy capture default state", () => {
  assert.equal(__test.defaultCaptureStateKey({ states: { ideas: "Ideas" } }), "ideas")
  assert.equal(__test.defaultCaptureStateKey({ states: { backlog: "Backlog" } }), "backlog")
})

test("filters tasks by exact status id", () => {
  const tasks = [
    { id: "1", task_group: "backlog" },
    { id: "2", task_group: "review" },
    { id: "3", task_group: null },
  ]

  assert.deepEqual(__test.filterTasksByStatus(tasks, "backlog").map((task) => task.id), ["1"])
})

test("maps configured custom fields on task output", () => {
  const workflow = {
    custom_fields: {
      area_of_concern: {
        id: "field-1",
        name: "Area of concern",
        type: "select",
        values: { deployment: "Deployment" },
      },
    },
  }
  const task = { id: "t1", fields: [{ id: "field-1", value: "Deployment" }] }

  assert.deepEqual(__test.enrichTaskCustomFields(task, workflow).custom_fields, {
    area_of_concern: {
      id: "field-1",
      name: "Area of concern",
      type: "select",
      value: "Deployment",
      value_key: "deployment",
    },
  })
})

test("builds custom field write payloads from workflow keys", () => {
  const workflow = {
    custom_fields: {
      area_of_concern: {
        id: "field-1",
        values: { deployment: "Deployment" },
      },
    },
  }

  assert.deepEqual(
    __test.customFieldPayload(workflow, [{ key: "area_of_concern", value_key: "deployment" }]),
    [{ id: "field-1", value: "Deployment" }],
  )
})

test("filters tasks by configured custom field value", () => {
  const workflow = {
    custom_fields: {
      area_of_concern: {
        id: "field-1",
        values: { deployment: "Deployment" },
      },
    },
  }
  const tasks = [
    { id: "1", fields: [{ id: "field-1", value: "Deployment" }] },
    { id: "2", fields: [{ id: "field-1", value: "Editor" }] },
  ]

  assert.deepEqual(
    __test.filterTasksByCustomField(tasks, workflow, {
      custom_field_key: "area_of_concern",
      custom_field_value: "deployment",
    }).map((task) => task.id),
    ["1"],
  )
})

test("bootstrap mutating project tool set tracks live document tool names", () => {
  assert.equal(__test.BOOTSTRAP_MUTATING_PROJECT_TOOLS.has("nifty_create_document"), true)
  assert.equal(__test.BOOTSTRAP_MUTATING_PROJECT_TOOLS.has("nifty_update_document"), true)
  assert.equal(__test.BOOTSTRAP_MUTATING_PROJECT_TOOLS.has("nifty_delete_document"), true)

  assert.equal(__test.BOOTSTRAP_MUTATING_PROJECT_TOOLS.has("nifty_create_doc"), false)
  assert.equal(__test.BOOTSTRAP_MUTATING_PROJECT_TOOLS.has("nifty_update_doc"), false)
  assert.equal(__test.BOOTSTRAP_MUTATING_PROJECT_TOOLS.has("nifty_delete_doc"), false)
})
