import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { cwd } from "node:process"
import * as z from "zod"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { NiftyPlugin } from "../plugin/nifty.js"

const DEFAULT_SERVER_NAME = "nifty"
const DEFAULT_SERVER_VERSION = "1.0.0"

let toolCache

function formatIssues(issues = []) {
  return issues
    .map((issue) => {
      const path = issue.path?.length ? issue.path.join(".") : "args"
      return `${path}: ${issue.message}`
    })
    .join("; ")
}

function stringifyToolOutput(value) {
  if (typeof value === "string") return value
  if (value === undefined) return "OK"
  return JSON.stringify(value, null, 2)
}

function ensureTool(name, definition) {
  if (!definition || typeof definition.execute !== "function") {
    throw new Error(`Tool ${name} is not executable.`)
  }
}

function validateToolArgs(name, definition, args) {
  const schema = z.object(definition.args || {})
  const parsed = schema.safeParse(args || {})
  if (!parsed.success) {
    throw new Error(`Invalid arguments for ${name}: ${formatIssues(parsed.error.issues)}`)
  }
  return parsed.data
}

function normalizeMetadataEntries(entries = {}) {
  if (entries instanceof Map) return new Map(entries)
  return new Map(Object.entries(entries))
}

export async function loadNiftyTools() {
  if (!toolCache) {
    toolCache = NiftyPlugin().then((plugin) => plugin.tool || {})
  }
  return toolCache
}

export function buildMcpInputSchema(args = {}) {
  const schema = z.object(args)
  const jsonSchema = z.toJSONSchema(schema)
  return {
    type: "object",
    properties: jsonSchema.properties || {},
    required: jsonSchema.required || [],
    additionalProperties: false,
  }
}

export function buildMcpToolCatalog(tools = {}) {
  return Object.entries(tools)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, definition]) => ({
      name,
      description: definition.description || "",
      inputSchema: buildMcpInputSchema(definition.args || {}),
    }))
}

export function createCopilotExecutionContext(options = {}) {
  const baseDirectory = options.directory || process.env.NIFTY_WORKTREE || cwd()
  const metadataEntries = normalizeMetadataEntries(options.metadataEntries)

  return {
    abort: options.abortSignal || new AbortController().signal,
    directory: baseDirectory,
    worktree: options.worktree || baseDirectory,
    metadata(key, value) {
      if (arguments.length === 2) {
        metadataEntries.set(key, value)
        return value
      }
      return metadataEntries.get(key)
    },
    ask() {
      throw new Error("Interactive prompts are not supported by the Copilot MCP bridge.")
    },
  }
}

export async function runNiftyTool(tools, toolName, rawArgs = {}, context = createCopilotExecutionContext()) {
  const definition = tools?.[toolName]
  if (!definition) {
    throw new Error(`Unknown Nifty tool: ${toolName}`)
  }

  ensureTool(toolName, definition)
  const args = validateToolArgs(toolName, definition, rawArgs)
  const output = await definition.execute(args, context)
  return stringifyToolOutput(output)
}

export async function createCopilotMcpServer(options = {}) {
  const serverName = options.serverName || DEFAULT_SERVER_NAME
  const serverVersion = options.serverVersion || DEFAULT_SERVER_VERSION
  const tools = await loadNiftyTools()
  const server = new McpServer({ name: serverName, version: serverVersion })

  for (const [name, definition] of Object.entries(tools)) {
    ensureTool(name, definition)
    const description = definition.description || ""
    const argsShape = definition.args || {}

    server.tool(name, description, argsShape, async (args, extra = {}) => {
      const context = createCopilotExecutionContext({
        directory: options.directory,
        worktree: options.worktree,
        abortSignal: extra.signal,
        metadataEntries: {
          ...(options.metadataEntries || {}),
          mcp_tool: name,
        },
      })

      const output = await runNiftyTool(tools, name, args, context)
      return {
        content: [{ type: "text", text: output }],
      }
    })
  }

  return server
}

export async function startCopilotMcpServer(options = {}) {
  const server = await createCopilotMcpServer(options)
  const transport = new StdioServerTransport()
  await server.connect(transport)
  return { server, transport }
}

function isMainModule() {
  if (!process.argv[1]) return false
  return resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
}

if (isMainModule()) {
  startCopilotMcpServer().catch((error) => {
    const message = error instanceof Error ? error.stack || error.message : String(error)
    process.stderr.write(`Nifty Copilot MCP server failed: ${message}\n`)
    process.exit(1)
  })
}
