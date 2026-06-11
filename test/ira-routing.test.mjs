import assert from "node:assert/strict"
import { test } from "node:test"
import { NiftyPlugin } from "../plugin/nifty.js"

const missingOllamaBinary = "missing-ollama-for-ira-routing-test"

function context(overrides = {}) {
  return {
    abort: new AbortController().signal,
    directory: undefined,
    worktree: undefined,
    env: {
      NIFTY_IRA_OLLAMA_BINARY: missingOllamaBinary,
    },
    metadata() {},
    ask() {
      throw new Error("ask not supported in tests")
    },
    ...overrides,
  }
}

test("Ira readiness reports missing local Ollama Gemma model with install guidance", () => {
  const originalBinary = process.env.NIFTY_IRA_OLLAMA_BINARY
  process.env.NIFTY_IRA_OLLAMA_BINARY = missingOllamaBinary

  try {
    const readiness = NiftyPlugin.__test.iraReadiness(context())

    assert.equal(readiness.agent_name, "Ira")
    assert.equal(readiness.model_required, "gemma4:e2b")
    assert.equal(readiness.model_ref, "ollama/gemma4:e2b")
    assert.equal(readiness.ready, false)
    assert.equal(readiness.ollama.binary, missingOllamaBinary)
    assert.equal(readiness.ollama.installed, false)
    assert.equal(readiness.model.installed, false)
    assert.match(readiness.install.model, /ollama pull gemma4:e2b/)
  } finally {
    if (originalBinary === undefined) delete process.env.NIFTY_IRA_OLLAMA_BINARY
    else process.env.NIFTY_IRA_OLLAMA_BINARY = originalBinary
  }
})

test("nifty_health_check includes Ira and fails overall when Ira is not ready", async () => {
  const originalFetch = globalThis.fetch
  const originalEnv = { ...process.env }
  Object.assign(process.env, {
    NIFTY_ACCESS_TOKEN: "test-token",
    NIFTY_AUTOPOLICY_ENABLED: "false",
    NIFTY_BOOTSTRAP_REQUIRED: "false",
    NIFTY_IRA_OLLAMA_BINARY: missingOllamaBinary,
    NIFTY_RAG_REQUIRED: "false",
  })

  globalThis.fetch = async (url) => {
    const requestURL = new URL(String(url))
    if (requestURL.pathname === "/api/v1.0/users/me") return Response.json({ id: "u1" })
    if (requestURL.pathname === "/api/v1.0/projects") return Response.json({ projects: [] })
    throw new Error(`Unexpected fetch: ${requestURL.pathname}`)
  }

  try {
    const plugin = await NiftyPlugin()
    const output = await plugin.tool.nifty_health_check.execute({}, context())
    const parsed = JSON.parse(output)

    assert.equal(parsed.checks.api.ok, true)
    assert.ok(parsed.checks.ira)
    assert.equal(parsed.checks.ira.agent_name, "Ira")
    assert.equal(parsed.checks.ira.model_required, "gemma4:e2b")
    assert.equal(parsed.checks.ira.model_ref, "ollama/gemma4:e2b")
    assert.equal(parsed.checks.ira.ready, false)
    assert.equal(parsed.checks.ira.ollama.binary, missingOllamaBinary)
    assert.equal(parsed.checks.ira.ollama.installed, false)
    assert.equal(parsed.checks.ira.model.installed, false)
    assert.match(parsed.checks.ira.install.model, /ollama pull gemma4:e2b/)
    assert.equal(parsed.ok, false)
  } finally {
    globalThis.fetch = originalFetch
    process.env = originalEnv
  }
})
