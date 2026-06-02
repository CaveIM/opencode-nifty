#!/usr/bin/env bash
# scripts/install-windsurf.sh
#
# Registers the Nifty MCP server for Windsurf (Codeium) editor.
# Writes to ~/.codeium/windsurf/mcp_config.json (global — Windsurf has no
# project-local MCP config as of 2025-Q4).
#
# Usage:
#   ./scripts/install-windsurf.sh
#
# Env overrides:
#   NIFTY_MCP_SERVER_NAME     Server alias (default: nifty)
#   NIFTY_WORKTREE            Worktree directory (default: repo root)
#   NIFTY_NODE_BIN            Node binary path (default: node)
set -euo pipefail

SCRIPT_PATH="${BASH_SOURCE[0]:-$0}"
ROOT_DIR="$(cd "$(dirname "$SCRIPT_PATH")/.." 2>/dev/null && pwd || pwd)"
SERVER_NAME="${NIFTY_MCP_SERVER_NAME:-nifty}"
NODE_BIN="${NIFTY_NODE_BIN:-node}"
SERVER_FILE="$ROOT_DIR/mcp/mcp-server.mjs"
WORKTREE="${NIFTY_WORKTREE:-$ROOT_DIR}"
if [[ ! -f "$SERVER_FILE" ]]; then
  printf 'Nifty MCP server file not found: %s\n' "$SERVER_FILE" >&2
  printf 'Run this installer from a full opencode-nifty checkout.\n' >&2
  exit 1
fi
if [[ -z "${HOME:-}" ]]; then
  printf 'HOME is not set; cannot write Windsurf MCP config.\n' >&2
  exit 1
fi
TARGET_MCP_FILE="$HOME/.codeium/windsurf/mcp_config.json"

mkdir -p "$(dirname "$TARGET_MCP_FILE")"

node --input-type=module - "$TARGET_MCP_FILE" "$SERVER_NAME" "$NODE_BIN" "$SERVER_FILE" "$WORKTREE" "$ROOT_DIR" <<'NODE'
import { existsSync, readFileSync, writeFileSync } from "node:fs"

const [targetPath, serverName, nodeBin, serverFile, worktree, mcpRoot] = process.argv.slice(2)

let config = { mcpServers: {} }
if (existsSync(targetPath)) {
  const parsed = JSON.parse(readFileSync(targetPath, "utf8"))
  config = parsed && typeof parsed === "object" ? parsed : { mcpServers: {} }
}

if (!config.mcpServers || typeof config.mcpServers !== "object") {
  config.mcpServers = {}
}

config.mcpServers[serverName] = {
  command: nodeBin,
  args: [serverFile],
  env: {
    NIFTY_WORKTREE: worktree,
    NIFTY_MCP_ROOT: mcpRoot,
  },
}

writeFileSync(targetPath, `${JSON.stringify(config, null, 2)}\n`, "utf8")
NODE

printf 'Configured Nifty MCP server "%s" at %s\n' "$SERVER_NAME" "$TARGET_MCP_FILE"
printf 'Server command: %s %s\n' "$NODE_BIN" "$SERVER_FILE"
printf 'Worktree: %s\n' "$WORKTREE"
printf 'Restart Windsurf to activate the server.\n'
printf 'Place Nifty credentials in %s/.nifty.env or export NIFTY_* env vars.\n' "$WORKTREE"
