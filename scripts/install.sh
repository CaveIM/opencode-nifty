#!/usr/bin/env bash
set -euo pipefail

SCRIPT_PATH="${BASH_SOURCE[0]:-$0}"
ROOT_DIR="$(cd "$(dirname "$SCRIPT_PATH")/.." 2>/dev/null && pwd || pwd)"
INSTALL_REF="${NIFTY_INSTALL_REF:-main}"
RAW_BASE_URL="${NIFTY_INSTALL_BASE_URL:-https://raw.githubusercontent.com/CaveIM/opencode-nifty/$INSTALL_REF}"
if [ -n "${NIFTY_OPENCODE_PLUGIN_VERSION:-}" ]; then
  OPENCODE_PLUGIN_VERSION="$NIFTY_OPENCODE_PLUGIN_VERSION"
elif command -v opencode >/dev/null 2>&1; then
  OPENCODE_PLUGIN_VERSION="$(opencode --version)"
else
  OPENCODE_PLUGIN_VERSION="1.14.50"
fi
NIFTY_DEFAULT_CLIENT_ID="${NIFTY_DEFAULT_CLIENT_ID:-lpuxRCzhf9mFOpfUuzS7xNmfNKO5pq3F}"
NIFTY_DEFAULT_REDIRECT_URI="${NIFTY_DEFAULT_REDIRECT_URI:-http://127.0.0.1:8787/callback}"
NIFTY_DEFAULT_AUTHORIZE_URL="${NIFTY_DEFAULT_AUTHORIZE_URL:-https://nifty.pm/authorize?response_type=code&client_id=lpuxRCzhf9mFOpfUuzS7xNmfNKO5pq3F&redirect_uri=http://127.0.0.1:8787/callback&scope=file,doc,message,project,task,member,time_tracking,subteam,task_group,subtask,milestone,label}"
TARGET_CONFIG_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
TARGET_PLUGIN_DIR="$TARGET_CONFIG_DIR/plugins"
TARGET_PLUGIN_FILE="$TARGET_PLUGIN_DIR/nifty.js"
TARGET_PACKAGE_JSON="$TARGET_CONFIG_DIR/package.json"
TARGET_AGENTS_FILE="$TARGET_CONFIG_DIR/AGENTS.md"
TARGET_COMMAND_DIR="$TARGET_CONFIG_DIR/commands"
TARGET_OPENCODE_CONFIG_FILE="$TARGET_CONFIG_DIR/opencode.json"
TARGET_ENV_FILE="${NIFTY_ENV_FILE:-$PWD/.nifty.env}"
if [ -f "$TARGET_CONFIG_DIR/opencode.jsonc" ] && [ ! -f "$TARGET_OPENCODE_CONFIG_FILE" ]; then
  TARGET_OPENCODE_CONFIG_FILE="$TARGET_CONFIG_DIR/opencode.jsonc"
fi
SOURCE_PLUGIN_FILE="$ROOT_DIR/plugin/nifty.js"

fetch_source_file() {
  local path="$1"
  local output="$2"

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$RAW_BASE_URL/$path" -o "$output"
    return
  fi

  printf 'curl not found; clone https://github.com/CaveIM/opencode-nifty and run scripts/install.sh from the clone.\n' >&2
  return 1
}

WORK_DIR=""
if [ ! -f "$SOURCE_PLUGIN_FILE" ]; then
  WORK_DIR="$(mktemp -d)"
  SOURCE_PLUGIN_FILE="$WORK_DIR/nifty.js"
  fetch_source_file "plugin/nifty.js" "$SOURCE_PLUGIN_FILE"
fi

cleanup() {
  if [ -n "$WORK_DIR" ]; then
    rm -rf "$WORK_DIR"
  fi
}
trap cleanup EXIT

mkdir -p "$TARGET_PLUGIN_DIR" "$TARGET_COMMAND_DIR"

cp "$SOURCE_PLUGIN_FILE" "$TARGET_PLUGIN_FILE"

node --input-type=module -e 'import { existsSync, readFileSync, writeFileSync } from "node:fs"; const path = process.argv[1]; const version = process.argv[2]; const pkg = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {}; pkg.type = "module"; pkg.dependencies = pkg.dependencies || {}; pkg.dependencies["@opencode-ai/plugin"] = version; writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n", "utf8");' "$TARGET_PACKAGE_JSON" "$OPENCODE_PLUGIN_VERSION"

node --input-type=module -e 'import { existsSync, readFileSync, writeFileSync } from "node:fs"; const path = process.argv[1]; const pluginPath = "./plugins/nifty.js"; if (!existsSync(path)) { writeFileSync(path, JSON.stringify({ $schema: "https://opencode.ai/config.json", plugin: [pluginPath] }, null, 2) + "\n", "utf8"); process.exit(0); } let text = readFileSync(path, "utf8"); if (text.includes(`"${pluginPath}"`)) process.exit(0); const pluginMatch = text.match(/("plugin"\s*:\s*\[)/); if (pluginMatch?.index !== undefined) { const insertAt = pluginMatch.index + pluginMatch[0].length; text = `${text.slice(0, insertAt)}\n    "${pluginPath}",${text.slice(insertAt)}`; writeFileSync(path, text, "utf8"); process.exit(0); } const firstBrace = text.indexOf("{"); if (firstBrace === -1) throw new Error(`${path} is not an object config file.`); const insertion = `\n  "plugin": ["${pluginPath}"],`; text = `${text.slice(0, firstBrace + 1)}${insertion}${text.slice(firstBrace + 1)}`; writeFileSync(path, text, "utf8");' "$TARGET_OPENCODE_CONFIG_FILE"

node --input-type=module -e 'import { existsSync, readFileSync, writeFileSync } from "node:fs"; const path = process.argv[1]; const start = "<!-- opencode-nifty:start -->"; const end = "<!-- opencode-nifty:end -->"; const block = `${start}\n## OpenCode Nifty\n- When the user mentions Nifty, use the OpenCode tools named \`nifty_*\`; do not run shell commands such as \`nifty health check\`.\n- For "Nifty health check", use the OpenCode tool \`nifty_health_check\`.\n- For Nifty auth, use \`nifty_auth_localhost_start\` in containers or \`nifty_auth_localhost_login\` when the browser can reach the callback server directly.\n- For Nifty plugin updates, use \`nifty_update_plugin\`; if it updates, tell the user to restart OpenCode.\n- For recommended lifecycle setup, use \`nifty_recommended_workflow\` and \`nifty_setup_recommended_workflow\`.\n- Use \`nifty_create_subtask\` instead of \`nifty_create_task\` when the work is an execution step under an existing parent task; use a normal task for independent backlog or workflow items.\n- Bulk task deletion requires an explicit confirmation phrase such as \`delete 3 tasks\`; ask the user before providing it.\n- Automated Nifty workflow comments should keep the default robot marker unless the user explicitly wants a personal/direct comment.\n${end}`; const current = existsSync(path) ? readFileSync(path, "utf8") : ""; const pattern = new RegExp(`${start}[\\s\\S]*?${end}`); const next = pattern.test(current) ? current.replace(pattern, block) : `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${block}\n`; writeFileSync(path, next.endsWith("\n") ? next : `${next}\n`, "utf8");' "$TARGET_AGENTS_FILE"

cat > "$TARGET_COMMAND_DIR/nifty-auth.md" <<'EOF'
---
description: Start Nifty plugin authentication
---
Use the OpenCode tool `nifty_auth_localhost_start` for container/devcontainer auth. It starts the callback server in the background and returns the browser URL. If the environment is not containerized and the browser can reach the callback server directly, `nifty_auth_localhost_login` is also acceptable. Do not run a shell command.
EOF

cat > "$TARGET_COMMAND_DIR/nifty-health.md" <<'EOF'
---
description: Run the Nifty plugin health check
---
Use the OpenCode tool `nifty_health_check`. Do not run a shell command.
EOF

cat > "$TARGET_COMMAND_DIR/nifty-update.md" <<'EOF'
---
description: Update the Nifty plugin
---
Use the OpenCode tool `nifty_update_plugin`. If it reports `updated: true`, tell the user to restart OpenCode so the new plugin version is loaded. Do not run a shell command.
EOF

cat > "$TARGET_COMMAND_DIR/nifty-setup.md" <<'EOF'
---
description: Set up or validate the recommended Nifty workflow
---
Use the OpenCode tool `nifty_setup_recommended_workflow` with `dry_run true` first. If the user asks to create missing statuses and lists, use `dry_run false`. If the user asks to create the project workflow config file, set `write_config true`. Do not run a shell command.
EOF

if [ ! -f "$TARGET_ENV_FILE" ]; then
  cat > "$TARGET_ENV_FILE" <<EOF
# Nifty OAuth app credentials. Do not commit this file.
NIFTY_CLIENT_ID=$NIFTY_DEFAULT_CLIENT_ID
NIFTY_CLIENT_SECRET=
NIFTY_AUTHORIZE_URL=$NIFTY_DEFAULT_AUTHORIZE_URL
NIFTY_REDIRECT_URI=$NIFTY_DEFAULT_REDIRECT_URI

# Optional
NIFTY_DEFAULT_WORKFLOW=
EOF
fi

if command -v npm >/dev/null 2>&1; then
  INSTALLED_PLUGIN_VERSION=""
  if [ -f "$TARGET_CONFIG_DIR/node_modules/@opencode-ai/plugin/package.json" ]; then
    INSTALLED_PLUGIN_VERSION="$(node --input-type=module -e 'import { readFileSync } from "node:fs"; const path = process.argv[1]; console.log(JSON.parse(readFileSync(path, "utf8")).version || "");' "$TARGET_CONFIG_DIR/node_modules/@opencode-ai/plugin/package.json")"
  fi
  if [ "$INSTALLED_PLUGIN_VERSION" != "$OPENCODE_PLUGIN_VERSION" ]; then
    (cd "$TARGET_CONFIG_DIR" && npm install >/dev/null)
  fi
else
  printf 'npm not found; install @opencode-ai/plugin manually in %s\n' "$TARGET_CONFIG_DIR"
fi

printf 'Installed Nifty plugin to %s\n' "$TARGET_PLUGIN_FILE"
printf 'Registered Nifty plugin in %s\n' "$TARGET_OPENCODE_CONFIG_FILE"
printf 'Nifty env template: %s\n' "$TARGET_ENV_FILE"
printf 'OpenCode Nifty instructions: %s\n' "$TARGET_AGENTS_FILE"
printf 'OpenCode Nifty commands: %s/nifty-auth.md, %s/nifty-health.md, %s/nifty-update.md, and %s/nifty-setup.md\n' "$TARGET_COMMAND_DIR" "$TARGET_COMMAND_DIR" "$TARGET_COMMAND_DIR" "$TARGET_COMMAND_DIR"
printf 'Restart OpenCode before running /nifty-auth so it loads the installed plugin update.\n'
printf 'No workflow config was created. Ask OpenCode to run nifty_setup_recommended_workflow with write_config true when you want a project-local nifty-workflows.json.\n'
