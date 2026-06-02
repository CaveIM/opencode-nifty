#!/usr/bin/env bash
set -euo pipefail

SCRIPT_PATH="${BASH_SOURCE[0]:-$0}"
ROOT_DIR="$(cd "$(dirname "$SCRIPT_PATH")/.." 2>/dev/null && pwd || pwd)"
TARGET_MCP_FILE="${NIFTY_COPILOT_MCP_FILE:-$ROOT_DIR/.vscode/mcp.json}"
SERVER_NAME="${NIFTY_COPILOT_SERVER_NAME:-nifty}"
NODE_BIN="${NIFTY_COPILOT_NODE_BIN:-node}"
SERVER_FILE="$ROOT_DIR/mcp/mcp-server.mjs"
WORKTREE="${NIFTY_WORKTREE:-$ROOT_DIR}"

if [[ ! -f "$SERVER_FILE" ]]; then
  printf 'Nifty MCP server file not found: %s\n' "$SERVER_FILE" >&2
  printf 'Run this installer from a full opencode-nifty checkout.\n' >&2
  exit 1
fi

mkdir -p "$(dirname "$TARGET_MCP_FILE")"

node --input-type=module - "$TARGET_MCP_FILE" "$SERVER_NAME" "$NODE_BIN" "$SERVER_FILE" "$WORKTREE" "$ROOT_DIR" <<'NODE'
import { existsSync, readFileSync, writeFileSync } from "node:fs"

const [targetPath, serverName, nodeBin, serverFile, worktree, rootDir] = process.argv.slice(2)

let config = { servers: {} }
if (existsSync(targetPath)) {
  const parsed = JSON.parse(readFileSync(targetPath, "utf8"))
  config = parsed && typeof parsed === "object" ? parsed : { servers: {} }
}

if (!config.servers || typeof config.servers !== "object") {
  config.servers = {}
}

config.servers[serverName] = {
  command: nodeBin,
  args: [serverFile],
  env: {
    NIFTY_WORKTREE: worktree,
    NIFTY_MCP_ROOT: rootDir,
  },
}

writeFileSync(targetPath, `${JSON.stringify(config, null, 2)}\n`, "utf8")
NODE

printf 'Configured Nifty MCP server "%s" at %s\n' "$SERVER_NAME" "$TARGET_MCP_FILE"
printf 'Server command: %s %s\n' "$NODE_BIN" "$SERVER_FILE"
printf 'Worktree: %s\n' "$WORKTREE"
printf 'Place Nifty credentials in %s/.nifty.env or export NIFTY_* env vars before starting VS Code.\n' "$WORKTREE"
