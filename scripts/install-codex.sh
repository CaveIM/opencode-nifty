#!/usr/bin/env bash
# scripts/install-codex.sh
#
# Registers the Nifty MCP server for OpenAI Codex CLI.
# Codex uses TOML config at ~/.codex/config.toml (global) or
# .codex/config.toml (project-local, trusted projects only).
#
# Usage:
#   ./scripts/install-codex.sh              # writes .codex/config.toml in current dir
#   ./scripts/install-codex.sh --global     # writes to ~/.codex/config.toml
#
# Alternatively, let Codex manage it via the CLI:
#   codex mcp add nifty --env NIFTY_WORKTREE=/path -- node /path/to/mcp/mcp-server.mjs
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
  printf 'HOME is not set; cannot write global Codex MCP config.\n' >&2
  exit 1
fi

if [[ "$GLOBAL" == "true" ]]; then
  TARGET_CONFIG="$HOME/.codex/config.toml"
else
  TARGET_CONFIG="${PWD}/.codex/config.toml"
fi

mkdir -p "$(dirname "$TARGET_CONFIG")"

# Use Node to do safe section-aware TOML manipulation without a TOML dep.
# Strategy: read existing TOML, strip any existing [mcp_servers.<name>] and
# [mcp_servers.<name>.*] blocks (and their lines until the next top-level
# section), then append the fresh block.
node --input-type=module - "$TARGET_CONFIG" "$SERVER_NAME" "$NODE_BIN" "$SERVER_FILE" "$WORKTREE" "$ROOT_DIR" <<'NODE'
import { existsSync, readFileSync, writeFileSync } from "node:fs"

const [targetPath, serverName, nodeBin, serverFile, worktree, mcpRoot] = process.argv.slice(2)

const existing = existsSync(targetPath) ? readFileSync(targetPath, "utf8") : ""

// Remove any existing [mcp_servers.<serverName>] and [mcp_servers.<serverName>.*] blocks.
// A block runs from the matching header line until the next top-level [section] or EOF.
const headerRe = new RegExp(
  `^\\[mcp_servers\\.${serverName}(?:\\.[^\\]]+)?\\][\\s\\S]*?(?=^\\[(?!mcp_servers\\.${serverName}[.\\]])|$(?!\\n))`,
  "gm",
)
const cleaned = existing.replace(headerRe, "").replace(/\n{3,}/g, "\n\n").trimEnd()

// Build the new TOML block.
// Node binary and args in TOML array-of-strings format.
const tomlStr = (s) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
const argsToml = `[${tomlStr(serverFile)}]`

const block = [
  "",
  `[mcp_servers.${serverName}]`,
  `command = ${tomlStr(nodeBin)}`,
  `args = ${argsToml}`,
  "",
  `[mcp_servers.${serverName}.env]`,
  `NIFTY_WORKTREE = ${tomlStr(worktree)}`,
  `NIFTY_MCP_ROOT = ${tomlStr(mcpRoot)}`,
  "",
].join("\n")

const output = (cleaned ? cleaned + "\n" : "") + block
writeFileSync(targetPath, output, "utf8")
NODE

printf 'Configured Nifty MCP server "%s" at %s\n' "$SERVER_NAME" "$TARGET_CONFIG"
printf 'Server command: %s %s\n' "$NODE_BIN" "$SERVER_FILE"
printf 'Worktree: %s\n' "$WORKTREE"
printf 'Place Nifty credentials in %s/.nifty.env or export NIFTY_* env vars before starting Codex.\n' "$WORKTREE"
printf '\nAlternatively, use the Codex CLI:\n'
printf '  codex mcp add %s --env NIFTY_WORKTREE=%s --env NIFTY_MCP_ROOT=%s -- %s %s\n' \
  "$SERVER_NAME" "$WORKTREE" "$ROOT_DIR" "$NODE_BIN" "$SERVER_FILE"
