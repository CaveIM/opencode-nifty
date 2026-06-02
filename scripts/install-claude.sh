#!/usr/bin/env bash
# scripts/install-claude.sh
#
# Registers the Nifty MCP server for Claude Code (project-local .mcp.json)
# or Claude Desktop (global config), depending on the --global flag.
#
# Usage:
#   ./scripts/install-claude.sh              # writes .mcp.json in current dir
#   ./scripts/install-claude.sh --global     # writes to Claude Desktop global config
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
GLOBAL=false

for arg in "$@"; do
  [[ "$arg" == "--global" ]] && GLOBAL=true
done

if [[ ! -f "$SERVER_FILE" ]]; then
  printf 'Nifty MCP server file not found: %s\n' "$SERVER_FILE" >&2
  printf 'Run this installer from a full opencode-nifty checkout.\n' >&2
  exit 1
fi

if [[ "$GLOBAL" == "true" && -z "${HOME:-}" ]]; then
  printf 'HOME is not set; cannot write global Claude MCP config.\n' >&2
  exit 1
fi

if [[ "$GLOBAL" == "true" ]]; then
  # Claude Desktop global config location
  case "$(uname -s)" in
    Darwin)  TARGET_MCP_FILE="$HOME/Library/Application Support/Claude/claude_desktop_config.json" ;;
    MINGW*|MSYS*|CYGWIN*) TARGET_MCP_FILE="${APPDATA:-$HOME/AppData/Roaming}/Claude/claude_desktop_config.json" ;;
    *)       TARGET_MCP_FILE="$HOME/.config/Claude/claude_desktop_config.json" ;;
  esac
  CONFIG_KEY="mcpServers"
else
  # Claude Code project-local .mcp.json
  TARGET_MCP_FILE="${PWD}/.mcp.json"
  CONFIG_KEY="mcpServers"
fi

mkdir -p "$(dirname "$TARGET_MCP_FILE")"

node --input-type=module - "$TARGET_MCP_FILE" "$CONFIG_KEY" "$SERVER_NAME" "$NODE_BIN" "$SERVER_FILE" "$WORKTREE" "$ROOT_DIR" <<'NODE'
import { existsSync, readFileSync, writeFileSync } from "node:fs"

const [targetPath, configKey, serverName, nodeBin, serverFile, worktree, mcpRoot] = process.argv.slice(2)

let config = {}
if (existsSync(targetPath)) {
  const parsed = JSON.parse(readFileSync(targetPath, "utf8"))
  config = parsed && typeof parsed === "object" ? parsed : {}
}

if (!config[configKey] || typeof config[configKey] !== "object") {
  config[configKey] = {}
}

config[configKey][serverName] = {
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
printf 'Place Nifty credentials in %s/.nifty.env or export NIFTY_* env vars before starting Claude.\n' "$WORKTREE"
