import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"

const roots = ["copilot", "plugin", "scripts", "test"]
const files = []

function collect(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      collect(path)
      continue
    }
    if (/\.(js|mjs)$/.test(path)) files.push(path)
  }
}

for (const root of roots) collect(root)

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" })
  if (result.status !== 0) process.exit(result.status || 1)
}
