import { accessSync, constants, readFileSync } from "node:fs"
import { extname, resolve } from "node:path"

const defaultArtifacts = [
  "dist/index.js",
  "dist/index.d.ts",
  "dist/cave-meister.schema.json",
  "plugin/nifty.js",
  "plugin/rag.mjs",
  "mcp/mcp-server.mjs",
  "packages/ast-grep-mcp/dist/cli.js",
  "packages/git-bash-mcp/dist/cli.js",
  "packages/lsp-tools-mcp/dist/cli.js",
  "packages/shared-skills/index.mjs",
  "packages/shared-skills/skills/visual-qa/SKILL.md",
]

const requestedArtifacts = process.argv.slice(2)
const artifacts = requestedArtifacts.length > 0 ? requestedArtifacts : defaultArtifacts

for (const artifact of artifacts) {
  const absolutePath = resolve(process.cwd(), artifact)
  accessSync(absolutePath, constants.R_OK)

  if (extname(artifact) === ".json") {
    JSON.parse(readFileSync(absolutePath, "utf8"))
  }
}

console.log(`validated ${artifacts.length} artifact${artifacts.length === 1 ? "" : "s"}`)
