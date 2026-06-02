import assert from "node:assert/strict"
import { test, beforeEach, afterEach } from "node:test"
import { NiftyPlugin } from "../plugin/nifty.js"

const { __test } = NiftyPlugin

const originalEnv = { ...process.env }
beforeEach(() => { process.env = { ...originalEnv } })
afterEach(() => { process.env = { ...originalEnv } })

test("detects visual proof requirement from changed files", () => {
  assert.equal(__test.requiresVisualProof(["frontend/src/app/page.tsx"]), true)
  assert.equal(__test.requiresVisualProof(["backend/app/Services/BuildReport.php"]), false)
  assert.equal(__test.requiresVisualProof(["resources/css/app.css"]), true)
})

test("delivery evidence requires tdd and sad path proofs", () => {
  assert.throws(
    () => __test.validateDeliveryEvidence({
      red_proof: "npm test -- test/path",
      green_proof: "npm test",
      architecture_proof: "Integrated through the existing lifecycle gate boundary; no parallel path added.",
      regression_proof: "Added regression test covering invalid payload and happy path.",
      iterative_proof: "RED failed first, GREEN passed after implementation, then full regression reran.",
      visual_proof: ["https://example.com/screenshot.png"],
    }, { visualRequired: true }),
    /sad_path_proof/i,
  )

  assert.doesNotThrow(() => __test.validateDeliveryEvidence({
    red_proof: "npm test -- test/path",
    green_proof: "npm test",
    sad_path_proof: "verified invalid payload returns 422",
    architecture_proof: "Integrated through the existing lifecycle gate boundary; no parallel path added.",
    regression_proof: "Added regression test covering invalid payload and happy path.",
    iterative_proof: "RED failed first, GREEN passed after implementation, then full regression reran.",
    visual_proof: ["https://example.com/screenshot.png"],
  }, { visualRequired: true }))
})

test("delivery evidence rejects hand-wavy fixes without architectural integration and regression proof", () => {
  assert.throws(
    () => __test.validateDeliveryEvidence({
      red_proof: "npm test -- test/path",
      green_proof: "npm test",
      sad_path_proof: "checked failure mode",
    }, { visualRequired: false }),
    /architecture_proof/i,
  )

  assert.throws(
    () => __test.validateDeliveryEvidence({
      red_proof: "npm test -- test/path",
      green_proof: "npm test",
      sad_path_proof: "checked failure mode",
      architecture_proof: "fixed it",
      regression_proof: "tests pass",
      iterative_proof: "works now",
    }, { visualRequired: false }),
    /hand-wavy|placeholder|not enough evidence/i,
  )
})

test("delivery evidence enforces visual artifacts only when visual changes are present", () => {
  assert.throws(
    () => __test.validateDeliveryEvidence({
      red_proof: "npm test -- test/path",
      green_proof: "npm test",
      sad_path_proof: "checked failure mode",
      architecture_proof: "Integrated through the existing lifecycle gate boundary; no parallel path added.",
      regression_proof: "Added regression test covering invalid payload and happy path.",
      iterative_proof: "RED failed first, GREEN passed after implementation, then full regression reran.",
    }, { visualRequired: true }),
    /visual_proof/i,
  )

  assert.doesNotThrow(() => __test.validateDeliveryEvidence({
    red_proof: "npm test -- test/path",
    green_proof: "npm test",
    sad_path_proof: "checked failure mode",
    architecture_proof: "Integrated through the existing lifecycle gate boundary; no parallel path added.",
    regression_proof: "Added regression test covering invalid payload and happy path.",
    iterative_proof: "RED failed first, GREEN passed after implementation, then full regression reran.",
  }, { visualRequired: false }))
})

// ─────────────────────────────────────────────────────────────────────────────
// Global report standard

test("lifecycleStatusCommentsEnabled defaults to false — routine noise is suppressed", () => {
  delete process.env.NIFTY_LIFECYCLE_STATUS_COMMENTS
  assert.equal(__test.lifecycleStatusCommentsEnabled({}), false)

  process.env.NIFTY_LIFECYCLE_STATUS_COMMENTS = "true"
  assert.equal(__test.lifecycleStatusCommentsEnabled({}), true)

  process.env.NIFTY_LIFECYCLE_STATUS_COMMENTS = "false"
  assert.equal(__test.lifecycleStatusCommentsEnabled({}), false)
})

test("reportingConfig returns correct defaults when no policy is loaded", () => {
  const cfg = __test.reportingConfig(null)
  assert.equal(cfg.suppress_routine_status_comments, true)
  assert.equal(cfg.require_structured_report, true)
  assert.equal(cfg.require_playwright_proof_for_visual_changes, true)
  assert.ok(typeof cfg.comment_template === "string" && cfg.comment_template.includes("{summary}"))
})

test("reportingConfig merges policy reporting section over defaults", () => {
  const policy = { reporting: { require_structured_report: false, custom_field: "x" } }
  const cfg = __test.reportingConfig(policy)
  assert.equal(cfg.require_structured_report, false)
  // Other defaults preserved
  assert.equal(cfg.require_playwright_proof_for_visual_changes, true)
})

test("structuredReport — includes all non-empty sections", () => {
  const report = __test.structuredReport({
    summary: "Fixed the login redirect",
    completed: ["Updated redirect logic", "Wrote regression test"],
    evidence: "npm test — 45/45 passing",
    verification: "Log in and confirm you land on /dashboard",
    visual_proof: ["https://cdn.example.com/screenshot.png"],
    visual_required: true,
  })
  assert.ok(report.includes("## What was done"), "missing summary section")
  assert.ok(report.includes("Fixed the login redirect"), "missing summary text")
  assert.ok(report.includes("## Completed"), "missing completed section")
  assert.ok(report.includes("- Updated redirect logic"), "missing completed bullet")
  assert.ok(report.includes("## Evidence / Tests"), "missing evidence section")
  assert.ok(report.includes("45/45 passing"), "missing evidence text")
  assert.ok(report.includes("## How to verify"), "missing verification section")
  assert.ok(report.includes("## Visual proof"), "missing visual proof section")
  assert.ok(report.includes("https://cdn.example.com/screenshot.png"), "missing screenshot url")
})

test("structuredReport — omits blank sections", () => {
  const report = __test.structuredReport({ summary: "Minor refactor", visual_required: false })
  assert.ok(report.includes("## What was done"))
  assert.ok(!report.includes("## Completed"))
  assert.ok(!report.includes("## Evidence"))
  assert.ok(!report.includes("## How to verify"))
  assert.ok(!report.includes("## Visual proof"))
})

test("structuredReport — keeps provided visual proof links even when not required", () => {
  const report = __test.structuredReport({
    summary: "Attached proof",
    visual_required: false,
    visual_proof: ["https://cdn.example.com/proof.png"],
  })
  assert.ok(report.includes("## Visual proof"))
  assert.ok(report.includes("https://cdn.example.com/proof.png"))
})

test("structuredReport — visual_required=true with no proof shows mandatory warning", () => {
  const report = __test.structuredReport({
    summary: "Updated button styles",
    visual_required: true,
    visual_proof: [],
  })
  assert.ok(report.includes("## Visual proof"))
  assert.ok(report.includes("MANDATORY"), "missing mandatory warning for absent screenshots")
})

