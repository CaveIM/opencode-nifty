#!/usr/bin/env node
import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] || "0", 10)
if (!Number.isFinite(nodeMajor) || nodeMajor < 20) {
  console.error(`Nifty MCP requires Node 20 or newer. Current Node: ${process.version}`)
  process.exit(1)
}

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const repoRoot = process.env.NIFTY_MCP_ROOT ? resolve(process.env.NIFTY_MCP_ROOT) : resolve(pluginRoot, "../..")
const serverPath = resolve(repoRoot, "mcp/mcp-server.mjs")

if (!existsSync(serverPath)) {
  console.error(`Nifty MCP server not found at ${serverPath}`)
  console.error("Install this plugin from the opencode-nifty repository or refresh the personal marketplace symlink.")
  process.exit(1)
}

if (!process.env.NIFTY_MCP_ROOT) process.env.NIFTY_MCP_ROOT = repoRoot
if (!process.env.NIFTY_WORKTREE) process.env.NIFTY_WORKTREE = repoRoot

await import(pathToFileURL(serverPath).href)
