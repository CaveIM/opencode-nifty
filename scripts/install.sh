#!/usr/bin/env bash
set -euo pipefail

SCRIPT_PATH="${BASH_SOURCE[0]:-$0}"
ROOT_DIR="$(cd "$(dirname "$SCRIPT_PATH")/.." 2>/dev/null && pwd || pwd)"
INSTALL_REF="${NIFTY_INSTALL_REF:-main}"
RAW_BASE_URL="${NIFTY_INSTALL_BASE_URL:-https://raw.githubusercontent.com/CaveIM/opencode-nifty/$INSTALL_REF}"
TARGET_CONFIG_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
TARGET_PLUGIN_DIR="$TARGET_CONFIG_DIR/plugins"
TARGET_PLUGIN_FILE="$TARGET_PLUGIN_DIR/nifty.js"
TARGET_PACKAGE_JSON="$TARGET_CONFIG_DIR/package.json"
TARGET_WORKFLOW_FILE="$TARGET_CONFIG_DIR/nifty-workflows.json"
SOURCE_PLUGIN_FILE="$ROOT_DIR/plugin/nifty.js"
SOURCE_WORKFLOW_FILE="$ROOT_DIR/config/nifty-workflows.example.json"

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
if [ ! -f "$SOURCE_PLUGIN_FILE" ] || [ ! -f "$SOURCE_WORKFLOW_FILE" ]; then
  WORK_DIR="$(mktemp -d)"
  SOURCE_PLUGIN_FILE="$WORK_DIR/nifty.js"
  SOURCE_WORKFLOW_FILE="$WORK_DIR/nifty-workflows.example.json"
  fetch_source_file "plugin/nifty.js" "$SOURCE_PLUGIN_FILE"
  fetch_source_file "config/nifty-workflows.example.json" "$SOURCE_WORKFLOW_FILE"
fi

cleanup() {
  if [ -n "$WORK_DIR" ]; then
    rm -rf "$WORK_DIR"
  fi
}
trap cleanup EXIT

mkdir -p "$TARGET_PLUGIN_DIR"

cp "$SOURCE_PLUGIN_FILE" "$TARGET_PLUGIN_FILE"

node --input-type=module -e 'import { existsSync, readFileSync, writeFileSync } from "node:fs"; const examplePath = process.argv[1]; const targetPath = process.argv[2]; const example = JSON.parse(readFileSync(examplePath, "utf8")); const target = existsSync(targetPath) ? JSON.parse(readFileSync(targetPath, "utf8")) : { workflows: {} }; target.workflows = target.workflows || {}; for (const [alias, workflow] of Object.entries(example.workflows || {})) { if (!target.workflows[alias]) target.workflows[alias] = workflow; } writeFileSync(targetPath, JSON.stringify(target, null, 2) + "\n", "utf8");' "$SOURCE_WORKFLOW_FILE" "$TARGET_WORKFLOW_FILE"

node --input-type=module -e 'import { existsSync, readFileSync, writeFileSync } from "node:fs"; const path = process.argv[1]; const pkg = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {}; pkg.type = "module"; pkg.dependencies = pkg.dependencies || {}; pkg.dependencies["@opencode-ai/plugin"] = pkg.dependencies["@opencode-ai/plugin"] || "1.4.3"; writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n", "utf8");' "$TARGET_PACKAGE_JSON"

if command -v npm >/dev/null 2>&1; then
  if [ ! -d "$TARGET_CONFIG_DIR/node_modules/@opencode-ai/plugin" ]; then
    (cd "$TARGET_CONFIG_DIR" && npm install >/dev/null)
  fi
else
  printf 'npm not found; install @opencode-ai/plugin manually in %s\n' "$TARGET_CONFIG_DIR"
fi

printf 'Installed Nifty plugin to %s\n' "$TARGET_PLUGIN_FILE"
printf 'Workflow config path: %s\n' "$TARGET_WORKFLOW_FILE"
printf 'Set NIFTY_WORKFLOW_CONFIG=%s if you want to force this file path.\n' "$TARGET_WORKFLOW_FILE"
