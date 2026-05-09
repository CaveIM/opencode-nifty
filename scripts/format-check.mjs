import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const roots = ["config", "env", "plugin", "scripts", "test", ".github"]
const files = ["README.md", "package.json"]
let failed = false

function collect(directory) {
  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules") continue
    const path = join(directory, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      collect(path)
      continue
    }
    files.push(path)
  }
}

for (const root of roots) {
  try {
    collect(root)
  } catch {
    // Optional roots, such as .github, may not exist during early development.
  }
}

for (const file of files) {
  const content = readFileSync(file, "utf8")
  if (!content.endsWith("\n")) {
    console.error(`${file}: missing trailing newline`)
    failed = true
  }
  const lines = content.split("\n")
  lines.forEach((line, index) => {
    if (/[ \t]$/.test(line)) {
      console.error(`${file}:${index + 1}: trailing whitespace`)
      failed = true
    }
  })
}

if (failed) process.exit(1)
