import assert from "node:assert/strict"
import { test } from "node:test"
import { NiftyPlugin } from "../plugin/nifty.js"

const { __test } = NiftyPlugin

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
      visual_proof: ["https://example.com/screenshot.png"],
    }, { visualRequired: true }),
    /sad_path_proof/i,
  )

  assert.doesNotThrow(() => __test.validateDeliveryEvidence({
    red_proof: "npm test -- test/path",
    green_proof: "npm test",
    sad_path_proof: "verified invalid payload returns 422",
    visual_proof: ["https://example.com/screenshot.png"],
  }, { visualRequired: true }))
})

test("delivery evidence enforces visual artifacts only when visual changes are present", () => {
  assert.throws(
    () => __test.validateDeliveryEvidence({
      red_proof: "npm test -- test/path",
      green_proof: "npm test",
      sad_path_proof: "checked failure mode",
    }, { visualRequired: true }),
    /visual_proof/i,
  )

  assert.doesNotThrow(() => __test.validateDeliveryEvidence({
    red_proof: "npm test -- test/path",
    green_proof: "npm test",
    sad_path_proof: "checked failure mode",
  }, { visualRequired: false }))
})
