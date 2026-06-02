import assert from "node:assert/strict"
import { afterEach, beforeEach, test } from "node:test"
import { NiftyPlugin } from "../plugin/nifty.js"

const { __test } = NiftyPlugin

const originalEnv = { ...process.env }

beforeEach(() => {
  process.env = { ...originalEnv }
})

afterEach(() => {
  process.env = { ...originalEnv }
})

test("automationConfig defaults to disabled without a loaded policy", () => {
  const cfg = __test.automationConfig(null)

  assert.equal(cfg.enabled, false)
  assert.equal(cfg.parent_tasks.auto_complete_when_subtasks_complete, false)
  assert.equal(cfg.subtasks.auto_create_from_checklist, true)
  assert.equal(cfg.completion.require_explicit_close_trigger, true)
  assert.equal(cfg.completion.close_confirmation_template, "close {task_id}")
  assert.equal(cfg.playwright.auto_capture_visual_proof, true)
  assert.deepEqual(cfg.progress_comments.milestones, ["first_edit", "first_green_test", "push", "done"])
  assert.equal(cfg.task_context_gate.enabled, true)
  assert.equal(cfg.task_context_gate.prompt_on_context_loss, true)
  assert.equal(cfg.task_context_gate.hard_fail_if_unresolved, true)
  assert.match(cfg.task_context_gate.prompt, /task card/i)
})

test("automationConfig merges policy automation and env overrides", () => {
  process.env.NIFTY_AUTOMATION_PLAYWRIGHT_COMMAND = "npx playwright test e2e/visual.spec.ts"
  process.env.NIFTY_AUTOMATION_PLAYWRIGHT_OUTPUT_DIR = "artifacts/proof"
  process.env.NIFTY_AUTOMATION_PLAYWRIGHT_TIMEOUT_MS = "1234"

  const cfg = __test.automationConfig({
    automation: {
      enabled: true,
      parent_tasks: { auto_complete_when_subtasks_complete: false },
      progress_comments: { milestones: ["done"] },
      task_context_gate: { prompt_on_context_loss: false },
    },
  })

  assert.equal(cfg.enabled, true)
  assert.equal(cfg.parent_tasks.auto_complete_when_subtasks_complete, false)
  assert.deepEqual(cfg.progress_comments.milestones, ["done"])
  assert.equal(cfg.task_context_gate.prompt_on_context_loss, false)
  assert.equal(cfg.task_context_gate.hard_fail_if_unresolved, true)
  assert.equal(cfg.playwright.command, "npx playwright test e2e/visual.spec.ts")
  assert.equal(cfg.playwright.output_dir, "artifacts/proof")
  assert.equal(cfg.playwright.timeout_ms, 1234)
})

test("detectAutomationMilestones classifies edit, green test, push, and done with dedupe", () => {
  const automation = __test.automationConfig({ automation: { enabled: true } })
  const state = { activeTaskID: "t1", postedMilestones: new Set() }

  const firstEdit = __test.detectAutomationMilestones({
    toolName: "apply_patch",
    args: {},
    output: "patched",
    sessionState: state,
    automation,
  })
  assert.deepEqual(firstEdit, ["first_edit"])

  state.postedMilestones.add("t1:first_edit")
  const duplicateEdit = __test.detectAutomationMilestones({
    toolName: "apply_patch",
    args: {},
    output: "patched",
    sessionState: state,
    automation,
  })
  assert.deepEqual(duplicateEdit, [])

  const firstGreen = __test.detectAutomationMilestones({
    toolName: "bash",
    args: { command: "npm test" },
    output: "# pass 99\n# fail 0",
    sessionState: state,
    automation,
  })
  assert.deepEqual(firstGreen, ["first_green_test"])

  const push = __test.detectAutomationMilestones({
    toolName: "bash",
    args: { command: "git push origin dev-tony" },
    output: "To github.com:repo.git",
    sessionState: state,
    automation,
  })
  assert.deepEqual(push, ["push"])

  const done = __test.detectAutomationMilestones({
    toolName: "nifty_complete_task",
    args: { task_id: "t1", completed: true },
    output: '{"ok":true}',
    sessionState: state,
    automation,
  })
  assert.deepEqual(done, ["done"])
})

test("taskParentID extracts parent linkage from supported task shapes", () => {
  assert.equal(__test.taskParentID({ task_id: "p1" }), "p1")
  assert.equal(__test.taskParentID({ parent_task_id: "p2" }), "p2")
  assert.equal(__test.taskParentID({ parent: { id: "p3" } }), "p3")
  assert.equal(__test.taskParentID({ task: "p4" }), "p4")
  assert.equal(__test.taskParentID({ id: "child" }), null)
})

test("checklistSubtasks derives unique subtask names from checklist items", () => {
  const derived = __test.checklistSubtasks(
    ["Implement API", "Write docs", "  ", "Implement API"],
    [{ name: "Write docs" }],
  )

  assert.deepEqual(derived, [{ name: "Implement API" }])
})

test("autoGenerateVisualProof captures and publishes proof without creating a document", async () => {
  const result = await __test.autoGenerateVisualProof(
    "t1",
    ["frontend/src/app/page.tsx"],
    {},
    __test.automationConfig({ automation: { enabled: true } }),
    {
      runCommand: async (command) => {
        if (command === "capture") return { stdout: "capture ok", stderr: "", code: 0 }
        if (command === "publish") {
          return {
            stdout: JSON.stringify({
              urls: ["https://example.com/proof.png"],
              nifty_file_ids: ["file-1"],
            }),
            stderr: "",
            code: 0,
          }
        }
        throw new Error(`Unexpected command: ${command}`)
      },
      captureCommand: "capture",
      publishCommand: "publish",
    },
  )

  assert.equal(result.proof_doc_id, undefined)
  assert.deepEqual(result.visual_proof, ["https://example.com/proof.png"])
  assert.deepEqual(result.nifty_file_ids, ["file-1"])
})
