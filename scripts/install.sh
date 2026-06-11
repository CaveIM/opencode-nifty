#!/usr/bin/env bash
set -euo pipefail

SCRIPT_PATH="${BASH_SOURCE[0]:-$0}"
ROOT_DIR="$(cd "$(dirname "$SCRIPT_PATH")/.." 2>/dev/null && pwd || pwd)"
INSTALL_REF="${CAVE_MEISTER_INSTALL_REF:-${NIFTY_INSTALL_REF:-dev-tony}}"
ARCHIVE_URL="${CAVE_MEISTER_INSTALL_ARCHIVE_URL:-https://codeload.github.com/CaveIM/opencode-nifty/tar.gz/$INSTALL_REF}"
if [ -n "${CAVE_MEISTER_OPENCODE_PLUGIN_VERSION:-}" ]; then
  OPENCODE_PLUGIN_VERSION="$CAVE_MEISTER_OPENCODE_PLUGIN_VERSION"
elif [ -n "${NIFTY_OPENCODE_PLUGIN_VERSION:-}" ]; then
  OPENCODE_PLUGIN_VERSION="$NIFTY_OPENCODE_PLUGIN_VERSION"
elif command -v opencode >/dev/null 2>&1; then
  OPENCODE_PLUGIN_VERSION="$(opencode --version)"
else
  OPENCODE_PLUGIN_VERSION="1.14.50"
fi
NIFTY_DEFAULT_CLIENT_ID="${NIFTY_DEFAULT_CLIENT_ID:-lpuxRCzhf9mFOpfUuzS7xNmfNKO5pq3F}"
NIFTY_DEFAULT_REDIRECT_URI="${NIFTY_DEFAULT_REDIRECT_URI:-http://127.0.0.1:8787/callback}"
NIFTY_DEFAULT_AUTHORIZE_URL="${NIFTY_DEFAULT_AUTHORIZE_URL:-https://nifty.pm/authorize?response_type=code&client_id=lpuxRCzhf9mFOpfUuzS7xNmfNKO5pq3F&redirect_uri=http://127.0.0.1:8787/callback&scope=file,doc,message,project,task,member,time_tracking,subteam,task_group,subtask,milestone,label}"
if [ -z "${OPENCODE_CONFIG_DIR:-}" ] && [ -z "${HOME:-}" ]; then
  printf 'HOME is not set; set OPENCODE_CONFIG_DIR or HOME before running the installer.\n' >&2
  exit 1
fi

TARGET_CONFIG_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
TARGET_PLUGIN_DIR="$TARGET_CONFIG_DIR/plugins"
TARGET_PLUGIN_FILE="$TARGET_PLUGIN_DIR/cave-meister.js"
LEGACY_NIFTY_PLUGIN_FILE="$TARGET_PLUGIN_DIR/nifty.js"
TARGET_PACKAGE_JSON="$TARGET_CONFIG_DIR/package.json"
TARGET_AGENTS_FILE="$TARGET_CONFIG_DIR/AGENTS.md"
TARGET_COMMAND_DIR="$TARGET_CONFIG_DIR/commands"
TARGET_OPENCODE_CONFIG_FILE="$TARGET_CONFIG_DIR/opencode.json"
TARGET_SUPPORT_DIR="$TARGET_CONFIG_DIR/cave-meister"
TARGET_NIFTY_AUTH_FILE="$TARGET_CONFIG_DIR/nifty-auth.json"
TARGET_ENV_FILE="${NIFTY_ENV_FILE:-$PWD/.nifty.env}"
if [ -f "$TARGET_CONFIG_DIR/opencode.jsonc" ] && [ ! -f "$TARGET_OPENCODE_CONFIG_FILE" ]; then
  TARGET_OPENCODE_CONFIG_FILE="$TARGET_CONFIG_DIR/opencode.jsonc"
fi

payload_is_complete() {
  local root="$1"
  [ -f "$root/dist/index.js" ] \
    && [ -f "$root/packages/shared-skills/skills/frontend-ui-ux/SKILL.md" ] \
    && [ -f "$root/packages/lsp-tools-mcp/dist/cli.js" ] \
    && [ -f "$root/packages/ast-grep-mcp/dist/cli.js" ] \
    && [ -f "$root/packages/git-bash-mcp/dist/cli.js" ] \
    && [ -f "$root/plugin/nifty.js" ] \
    && [ -f "$root/plugin/rag.mjs" ] \
    && [ -f "$root/mcp/mcp-server.mjs" ]
}

copy_dir() {
  local source="$1"
  local target="$2"
  rm -rf "$target"
  mkdir -p "$target"
  cp -R "$source"/. "$target"/
}

copy_file_if_present() {
  local source="$1"
  local target="$2"
  if [ -f "$source" ]; then
    mkdir -p "$(dirname "$target")"
    cp "$source" "$target"
  fi
}

WORK_DIR=""
SOURCE_ROOT="$ROOT_DIR"
if ! payload_is_complete "$SOURCE_ROOT"; then
  if ! command -v curl >/dev/null 2>&1; then
    printf 'curl not found; clone https://github.com/CaveIM/opencode-nifty and run scripts/install.sh from the clone.\n' >&2
    exit 1
  fi
  if ! command -v tar >/dev/null 2>&1; then
    printf 'tar not found; install tar or clone https://github.com/CaveIM/opencode-nifty and run scripts/install.sh from the clone.\n' >&2
    exit 1
  fi

  WORK_DIR="$(mktemp -d)"
  SOURCE_ROOT="$WORK_DIR/source"
  mkdir -p "$SOURCE_ROOT"
  curl -fsSL "$ARCHIVE_URL" -o "$WORK_DIR/cave-meister.tar.gz"
  tar -xzf "$WORK_DIR/cave-meister.tar.gz" --strip-components=1 -C "$SOURCE_ROOT"
fi

cleanup() {
  if [ -n "$WORK_DIR" ]; then
    rm -rf "$WORK_DIR"
  fi
}
trap cleanup EXIT

if ! payload_is_complete "$SOURCE_ROOT"; then
  printf 'Cave Meister payload is incomplete in %s. Expected dist/index.js, shared skills, MCP packages, Nifty plugin, RAG, and MCP server files.\n' "$SOURCE_ROOT" >&2
  exit 1
fi

mkdir -p "$TARGET_PLUGIN_DIR" "$TARGET_COMMAND_DIR" "$TARGET_CONFIG_DIR/packages"

cp "$SOURCE_ROOT/dist/index.js" "$TARGET_PLUGIN_FILE"
copy_file_if_present "$SOURCE_ROOT/dist/cave-meister.schema.json" "$TARGET_CONFIG_DIR/cave-meister.schema.json"
copy_dir "$SOURCE_ROOT/packages/shared-skills" "$TARGET_CONFIG_DIR/packages/shared-skills"
copy_dir "$SOURCE_ROOT/packages/lsp-tools-mcp/dist" "$TARGET_CONFIG_DIR/packages/lsp-tools-mcp/dist"
copy_file_if_present "$SOURCE_ROOT/packages/lsp-tools-mcp/package.json" "$TARGET_CONFIG_DIR/packages/lsp-tools-mcp/package.json"
copy_dir "$SOURCE_ROOT/packages/ast-grep-mcp/dist" "$TARGET_CONFIG_DIR/packages/ast-grep-mcp/dist"
copy_file_if_present "$SOURCE_ROOT/packages/ast-grep-mcp/package.json" "$TARGET_CONFIG_DIR/packages/ast-grep-mcp/package.json"
copy_dir "$SOURCE_ROOT/packages/git-bash-mcp/dist" "$TARGET_CONFIG_DIR/packages/git-bash-mcp/dist"
copy_file_if_present "$SOURCE_ROOT/packages/git-bash-mcp/package.json" "$TARGET_CONFIG_DIR/packages/git-bash-mcp/package.json"
copy_dir "$SOURCE_ROOT/plugin" "$TARGET_SUPPORT_DIR/plugin"
copy_dir "$SOURCE_ROOT/mcp" "$TARGET_SUPPORT_DIR/mcp"
copy_file_if_present "$SOURCE_ROOT/package.json" "$TARGET_SUPPORT_DIR/package.json"
copy_dir "$SOURCE_ROOT/policy" "$TARGET_SUPPORT_DIR/policy"
copy_dir "$SOURCE_ROOT/config" "$TARGET_SUPPORT_DIR/config"
copy_dir "$SOURCE_ROOT/env" "$TARGET_SUPPORT_DIR/env"
copy_dir "$SOURCE_ROOT/scripts" "$TARGET_SUPPORT_DIR/scripts"
rm -f "$LEGACY_NIFTY_PLUGIN_FILE"
if [ -f "$TARGET_NIFTY_AUTH_FILE" ]; then
  rm -f "$TARGET_NIFTY_AUTH_FILE"
  printf 'Removed stale Nifty OAuth token cache at %s; run /nifty-auth after restart.\n' "$TARGET_NIFTY_AUTH_FILE"
fi

HARDWARE_REPORT_DIR="$TARGET_SUPPORT_DIR/reports"
HARDWARE_REPORT_PATH="$HARDWARE_REPORT_DIR/ira-gemma-brain-self-improve-report.json"
mkdir -p "$HARDWARE_REPORT_DIR"
if node "$TARGET_SUPPORT_DIR/scripts/ira-gemma-brain-self-improve.mjs" --mode hardware-recommendation --output-dir "$HARDWARE_REPORT_DIR" >/dev/null 2>&1; then
  node --input-type=module -e '
import { readFileSync } from "node:fs"
const reportPath = process.argv[1]
const report = JSON.parse(readFileSync(reportPath, "utf8"))
const suggestion = report.hardware_recommendation?.suggested_variant || {}
const variant = suggestion.variant || "unavailable"
const basis = suggestion.basis || "unavailable"
const note = basis === "derived_from_weight_size"
  ? "derived from official Gemma 4 documented weight sizes, no overhead multiplier"
  : "unavailable: no GPU/VRAM fixture evidence; no system RAM/CPU threshold inferred"
console.log(`Ira/Gemma Brain hardware recommendation: ${variant} (${note}).`)
console.log(`Ira/Gemma Brain diagnostic report: ${reportPath}`)
' "$HARDWARE_REPORT_PATH"
else
  printf 'Ira/Gemma Brain hardware recommendation: unavailable (diagnostic could not produce a report; install continues).\n'
  printf 'Ira/Gemma Brain diagnostic report: %s\n' "$HARDWARE_REPORT_PATH"
fi

# Create package.json next to plugin for version detection
node --input-type=module -e '
import { writeFileSync } from "node:fs"
const path = process.argv[1]
const version = process.argv[2]
writeFileSync(path, JSON.stringify({ name: "cave-meister", version }, null, 2) + "\n", "utf8")
' "$TARGET_PLUGIN_DIR/package.json" "$OPENCODE_PLUGIN_VERSION"

node --input-type=module -e '
import { existsSync, readFileSync, writeFileSync } from "node:fs"
const path = process.argv[1]
const opencodePluginVersion = process.argv[2]
const pkg = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {}
pkg.type = "module"
pkg.dependencies = pkg.dependencies || {}
pkg.dependencies["@opencode-ai/plugin"] = opencodePluginVersion
pkg.dependencies["@modelcontextprotocol/sdk"] = "^1.29.0"
pkg.dependencies.zod = "^4.4.3"
pkg.optionalDependencies = pkg.optionalDependencies || {}
pkg.optionalDependencies["@lancedb/lancedb"] = "^0.16.0"
writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n", "utf8")
' "$TARGET_PACKAGE_JSON" "$OPENCODE_PLUGIN_VERSION"

node --input-type=module -e '
import { existsSync, readFileSync, writeFileSync } from "node:fs"
const path = process.argv[1]
const pluginPath = "./plugins/cave-meister.js"
const legacyPluginPaths = ["./plugins/nifty.js", "cave-meister", "oh-my-openagent", "oh-my-opencode"]
const legacyPluginPatterns = [
  String.raw`file:[^"]*/opencode-plugin/(?:src|dist)/index\.(?:ts|js)`,
  String.raw`file:[^"]*/cave-meister/(?:src|dist)/index\.(?:ts|js)`,
]
const quote = (value) => JSON.stringify(value)
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
if (!existsSync(path)) {
  writeFileSync(path, JSON.stringify({ $schema: "https://opencode.ai/config.json", plugin: [pluginPath] }, null, 2) + "\n", "utf8")
  process.exit(0)
}
let text = readFileSync(path, "utf8")
for (const legacyPath of legacyPluginPaths) {
  const escaped = escapeRegex(legacyPath)
  text = text.replace(new RegExp(`^\\s*${quote(legacyPath).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*,?\\s*\\n`, "gm"), "")
  text = text.replace(new RegExp(`,\\s*"${escaped}"`, "g"), "")
  text = text.replace(new RegExp(`"${escaped}"\\s*,\\s*`, "g"), "")
  text = text.replace(new RegExp(`"${escaped}"`, "g"), "")
}
for (const source of legacyPluginPatterns) {
  text = text.replace(new RegExp(`^\\s*"${source}"\\s*,?\\s*\\n`, "gm"), "")
  text = text.replace(new RegExp(`,\\s*"${source}"`, "g"), "")
  text = text.replace(new RegExp(`"${source}"\\s*,\\s*`, "g"), "")
  text = text.replace(new RegExp(`"${source}"`, "g"), "")
}
if (!text.includes(quote(pluginPath))) {
  const pluginMatch = text.match(/("plugin"\s*:\s*\[)/)
  if (pluginMatch?.index !== undefined) {
    const insertAt = pluginMatch.index + pluginMatch[0].length
    text = `${text.slice(0, insertAt)}\n    ${quote(pluginPath)},${text.slice(insertAt)}`
  } else {
    const firstBrace = text.indexOf("{")
    if (firstBrace === -1) throw new Error(`${path} is not an object config file.`)
    text = `${text.slice(0, firstBrace + 1)}\n  "plugin": [${quote(pluginPath)}],${text.slice(firstBrace + 1)}`
  }
}
text = text.replace(/,(\s*[\]}])/g, "$1")
writeFileSync(path, text, "utf8")
' "$TARGET_OPENCODE_CONFIG_FILE"

node --input-type=module -e '
import { existsSync, readFileSync, writeFileSync } from "node:fs"
const path = process.argv[1]
const oldStart = "<!-- opencode-nifty:start -->"
const oldEnd = "<!-- opencode-nifty:end -->"
const start = "<!-- cave-meister:start -->"
const end = "<!-- cave-meister:end -->"
const block = `${start}
## Cave Meister Orchestrator
- Cave Meister Orchestrator is installed as the OpenCode plugin \`./plugins/cave-meister.js\`.
- Nifty operations are exposed as OpenCode tools named \`nifty_*\`; do not run shell commands such as \`nifty health check\`.
- For "Nifty health check", use the OpenCode tool \`nifty_health_check\`.
- For Nifty auth, use \`nifty_auth_localhost_start\` in containers or \`nifty_auth_localhost_login\` when the browser can reach the callback server directly.
- For Cave Meister updates, use \`nifty_update_plugin\`; if it updates, tell the user to restart OpenCode.
- For recommended lifecycle setup, use \`nifty_recommended_workflow\` and \`nifty_setup_recommended_workflow\`.
- For shaping a feature idea into a dev-ready task, use \`nifty_shape_task\`; ask exactly its next returned question, one question at a time, until it reports ready.
- Before creating or preparing shaped tasks, ask the user to answer any open questions; do not write unresolved open questions into Nifty task descriptions.
- Use \`nifty_create_subtask\` instead of \`nifty_create_task\` when the work is an execution step under an existing parent task; use a normal task for independent backlog or workflow items.
- Bulk task deletion requires an explicit confirmation phrase such as \`delete 3 tasks\`; ask the user before providing it.
- Automated Nifty workflow comments should keep the default Cave Updater marker unless the user explicitly wants a personal/direct comment.
- Full-spec support files are installed under \`cave-meister/\`: MCP server, RAG helper, policy examples, workflow examples, env example, and maintenance scripts.
${end}`
let current = existsSync(path) ? readFileSync(path, "utf8") : ""
current = current.replace(new RegExp(`${oldStart}[\\s\\S]*?${oldEnd}\\n?`, "g"), "")
const pattern = new RegExp(`${start}[\\s\\S]*?${end}`)
const next = pattern.test(current) ? current.replace(pattern, block) : `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${block}\n`
writeFileSync(path, next.endsWith("\n") ? next : `${next}\n`, "utf8")
' "$TARGET_AGENTS_FILE"

cat > "$TARGET_COMMAND_DIR/nifty-auth.md" <<'EOF'
---
description: Start Cave Meister Nifty authentication
---
Use the OpenCode tool `nifty_auth_localhost_start` for container/devcontainer auth. It starts the callback server in the background and returns the browser URL. If the environment is not containerized and the browser can reach the callback server directly, `nifty_auth_localhost_login` is also acceptable. Do not run a shell command.
EOF

cat > "$TARGET_COMMAND_DIR/nifty-health.md" <<'EOF'
---
description: Run the Cave Meister Nifty health check
---
Use the OpenCode tool `nifty_health_check`. Do not run a shell command.
EOF

cat > "$TARGET_COMMAND_DIR/cave-meister-update.md" <<'EOF'
---
description: Update Cave Meister Orchestrator
---
Use the OpenCode tool `nifty_update_plugin` with `ref: "dev-tony"`. If it reports `updated: true`, tell the user to restart OpenCode so the new Cave Meister plugin version is loaded. Do not run a shell command.
EOF

cat > "$TARGET_COMMAND_DIR/nifty-update.md" <<'EOF'
---
description: Update Cave Meister Orchestrator
---
Use the OpenCode tool `nifty_update_plugin` with `ref: "dev-tony"`. If it reports `updated: true`, tell the user to restart OpenCode so the new Cave Meister plugin version is loaded. Do not run a shell command.
EOF

cat > "$TARGET_COMMAND_DIR/nifty-setup.md" <<'EOF'
---
description: Set up or validate the recommended Cave Meister Nifty workflow
---
Use the OpenCode tool `nifty_setup_recommended_workflow` with `dry_run true` first. If the user asks to create missing statuses and lists, use `dry_run false`. If the user asks to create the project workflow config file, set `write_config true`. Do not run a shell command.
EOF

if [ ! -f "$TARGET_ENV_FILE" ]; then
  cat > "$TARGET_ENV_FILE" <<EOF
# Nifty OAuth app credentials for Cave Meister. Do not commit this file.
NIFTY_CLIENT_ID=$NIFTY_DEFAULT_CLIENT_ID
NIFTY_CLIENT_SECRET=
NIFTY_AUTHORIZE_URL='$NIFTY_DEFAULT_AUTHORIZE_URL'
NIFTY_REDIRECT_URI=$NIFTY_DEFAULT_REDIRECT_URI

# Optional
NIFTY_AUTH_PORT=8787
NIFTY_DEFAULT_WORKFLOW=
NIFTY_RAG_ENABLED=true
EOF
fi

if [ "${CAVE_MEISTER_SKIP_NPM_INSTALL:-}" = "1" ]; then
  printf 'Skipped npm install because CAVE_MEISTER_SKIP_NPM_INSTALL=1.\n'
elif command -v npm >/dev/null 2>&1; then
  (cd "$TARGET_CONFIG_DIR" && npm install >/dev/null)
else
  printf 'npm not found; install @opencode-ai/plugin, @modelcontextprotocol/sdk, zod, and optional @lancedb/lancedb manually in %s\n' "$TARGET_CONFIG_DIR"
fi

printf 'Installed Cave Meister Orchestrator to %s\n' "$TARGET_PLUGIN_FILE"
printf 'Installed from Cave Meister ref: %s\n' "$INSTALL_REF"
printf 'Registered Cave Meister Orchestrator in %s\n' "$TARGET_OPENCODE_CONFIG_FILE"
printf 'Installed Cave Meister support files under %s\n' "$TARGET_SUPPORT_DIR"
printf 'Installed Cave Meister runtime packages under %s/packages\n' "$TARGET_CONFIG_DIR"
printf 'Nifty env template: %s\n' "$TARGET_ENV_FILE"
printf 'Cave Meister instructions: %s\n' "$TARGET_AGENTS_FILE"
printf 'Cave Meister commands: %s/nifty-auth.md, %s/nifty-health.md, %s/nifty-update.md, %s/cave-meister-update.md, and %s/nifty-setup.md\n' "$TARGET_COMMAND_DIR" "$TARGET_COMMAND_DIR" "$TARGET_COMMAND_DIR" "$TARGET_COMMAND_DIR" "$TARGET_COMMAND_DIR"
printf 'Restart OpenCode before using Cave Meister so it loads the full plugin.\n'
printf 'No workflow config was created. Ask OpenCode to run nifty_setup_recommended_workflow with write_config true when you want a project-local nifty-workflows.json.\n'
