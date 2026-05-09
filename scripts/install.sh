#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_CONFIG_DIR="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}"
TARGET_PLUGIN_DIR="$TARGET_CONFIG_DIR/plugins"
TARGET_PLUGIN_FILE="$TARGET_PLUGIN_DIR/nifty.js"
TARGET_PACKAGE_JSON="$TARGET_CONFIG_DIR/package.json"
TARGET_WORKFLOW_FILE="$TARGET_CONFIG_DIR/nifty-workflows.json"

mkdir -p "$TARGET_PLUGIN_DIR"

cp "$ROOT_DIR/plugin/nifty.js" "$TARGET_PLUGIN_FILE"

node --input-type=module -e 'import { existsSync, readFileSync, writeFileSync } from "node:fs"; const examplePath = process.argv[1]; const targetPath = process.argv[2]; const example = JSON.parse(readFileSync(examplePath, "utf8")); const target = existsSync(targetPath) ? JSON.parse(readFileSync(targetPath, "utf8")) : { workflows: {} }; target.workflows = target.workflows || {}; for (const [alias, workflow] of Object.entries(example.workflows || {})) { if (!target.workflows[alias]) target.workflows[alias] = workflow; } writeFileSync(targetPath, JSON.stringify(target, null, 2) + "\n", "utf8");' "$ROOT_DIR/config/nifty-workflows.example.json" "$TARGET_WORKFLOW_FILE"

node --input-type=module -e 'import { existsSync, readFileSync, writeFileSync } from "node:fs"; const path = process.argv[1]; const pkg = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {}; pkg.type = "module"; pkg.dependencies = pkg.dependencies || {}; pkg.dependencies["@opencode-ai/plugin"] = pkg.dependencies["@opencode-ai/plugin"] || "1.4.3"; writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n", "utf8");' "$TARGET_PACKAGE_JSON"

if command -v npm >/dev/null 2>&1; then
  (cd "$TARGET_CONFIG_DIR" && npm install >/dev/null)
else
  printf 'npm not found; install @opencode-ai/plugin manually in %s\n' "$TARGET_CONFIG_DIR"
fi

printf 'Installed Nifty plugin to %s\n' "$TARGET_PLUGIN_FILE"
printf 'Workflow config path: %s\n' "$TARGET_WORKFLOW_FILE"
printf 'Set NIFTY_WORKFLOW_CONFIG=%s if you want to force this file path.\n' "$TARGET_WORKFLOW_FILE"
