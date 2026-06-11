import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { test } from "node:test"

const cliPath = resolve("dist/cli/index.js")
const xiaomiModel = "xiaomi-token-plan-sgp/mimo-v2.5-pro"

async function withLocalConfig(config, run) {
  const projectDir = await mkdtemp(join(tmpdir(), "cave-meister-doctor-"))
  const opencodeDir = join(projectDir, ".opencode")
  const configPath = join(opencodeDir, "cave-meister.json")

  await mkdir(opencodeDir, { recursive: true })
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8")

  try {
    const result = spawnSync("bun", [cliPath, "doctor", "--json"], {
      cwd: projectDir,
      encoding: "utf8",
      env: {
        ...process.env,
        CAVE_MEISTER_DISABLE_POSTHOG: "1",
      },
    })

    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.equal(result.error, undefined)
    return run({ configPath, output: JSON.parse(result.stdout) })
  } finally {
    await rm(projectDir, { recursive: true, force: true })
  }
}

function findCheck(output, name) {
  const check = output.results.find((result) => result.name === name)
  assert.ok(check, `Expected ${name} check in doctor output`)
  return check
}

function allIssueText(output) {
  return output.results
    .flatMap((result) => result.issues ?? [])
    .map((issue) => [issue.title, issue.description, ...(issue.affects ?? [])].join("\n"))
    .join("\n")
}

test("doctor uses project-local Cave Meister config instead of global OmO overrides", async () => {
  await withLocalConfig(
    {
      agents: {
        denny: { model: "minimax/MiniMax-M3" },
      },
      categories: {
        heavy: { model: "openai/gpt-5.5" },
        medium: { model: "minimax/MiniMax-M3" },
      },
    },
    ({ configPath, output }) => {
      const configCheck = findCheck(output, "Configuration")
      assert.ok(configCheck.details.includes(`Path: ${configPath}`))

      const modelsText = findCheck(output, "Models").details.join("\n")
      const issuesText = allIssueText(output)

      assert.doesNotMatch(modelsText, new RegExp(xiaomiModel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
      assert.doesNotMatch(issuesText, new RegExp(xiaomiModel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
      assert.doesNotMatch(issuesText, /artistry/)
      assert.doesNotMatch(issuesText, /writing/)
    },
  )
})

test("doctor recognizes local Ira Ollama Gemma model metadata", async () => {
  await withLocalConfig(
    {
      categories: {
        quick: { model: "ollama/gemma4:e2b" },
        "unspecified-low": { model: "ollama/gemma4:e2b" },
      },
    },
    ({ output }) => {
      const modelsCheck = findCheck(output, "Models")
      const quickLine = modelsCheck.details.find((line) => line.includes("quick:") && line.includes("ollama/gemma4:e2b"))
      const unspecifiedLowLine = modelsCheck.details.find((line) => line.includes("unspecified-low:") && line.includes("ollama/gemma4:e2b"))

      assert.ok(quickLine, "Expected quick category model detail")
      assert.ok(unspecifiedLowLine, "Expected unspecified-low category model detail")
      assert.doesNotMatch(quickLine, /\[capabilities: unknown\]/)
      assert.doesNotMatch(unspecifiedLowLine, /\[capabilities: unknown\]/)

      const fallbackIssue = modelsCheck.issues.find((issue) => issue.title === "Configured models rely on compatibility fallback")
      assert.doesNotMatch(fallbackIssue?.description ?? "", /quick=ollama\/gemma4:e2b/)
      assert.doesNotMatch(fallbackIssue?.description ?? "", /unspecified-low=ollama\/gemma4:e2b/)
    },
  )
})
