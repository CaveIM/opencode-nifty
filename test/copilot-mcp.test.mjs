import assert from "node:assert/strict"
import { test } from "node:test"
import {
  buildMcpInputSchema,
  buildMcpToolCatalog,
  createCopilotExecutionContext,
  loadNiftyTools,
  runNiftyTool,
} from "../copilot/mcp-server.mjs"

test("loads full Nifty tool catalog for Copilot", async () => {
  const tools = await loadNiftyTools()
  const names = Object.keys(tools)

  assert.ok(names.length >= 58)
  assert.ok(names.includes("nifty_health_check"))
  assert.ok(names.includes("nifty_create_task"))
})

test("exports JSON schema for Nifty tool args", async () => {
  const tools = await loadNiftyTools()
  const schema = buildMcpInputSchema(tools.nifty_create_task.args)

  assert.equal(schema.type, "object")
  assert.equal(schema.properties.name.type, "string")
  assert.ok(schema.required.includes("name"))
  assert.ok(schema.required.includes("task_group_id"))
})

test("builds MCP catalog entries for every Nifty tool", async () => {
  const tools = await loadNiftyTools()
  const catalog = buildMcpToolCatalog(tools)

  assert.equal(catalog.length, Object.keys(tools).length)
  const health = catalog.find((entry) => entry.name === "nifty_health_check")

  assert.ok(health)
  assert.equal(typeof health.description, "string")
  assert.equal(health.inputSchema.type, "object")
})

test("runs tool executions with a Copilot-safe default context", async () => {
  const tools = await loadNiftyTools()
  const context = createCopilotExecutionContext({
    directory: process.cwd(),
    metadataEntries: { session: "copilot-test" },
  })

  const output = await runNiftyTool(tools, "nifty_recommended_workflow", {}, context)
  const parsed = JSON.parse(output)

  assert.equal(Array.isArray(parsed.statuses), true)
  assert.equal(parsed.statuses.length > 0, true)
  assert.equal(typeof parsed.config_snippet, "object")
})
