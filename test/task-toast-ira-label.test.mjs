import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { test } from "node:test"

const repoRoot = new URL("..", import.meta.url).pathname
const distIndexPath = join(repoRoot, "dist", "index.js")

async function loadTaskToastManager() {
  const localTempRoot = join(repoRoot, "dist", ".tmp-test-artifacts")
  mkdirSync(localTempRoot, { recursive: true })
  const tempDir = mkdtempSync(join(localTempRoot, "task-toast-ira-"))
  const tempModule = join(tempDir, "index.mjs")
  const source = readFileSync(distIndexPath, "utf8")
  writeFileSync(tempModule, `${source}\nexport { TaskToastManager };\n`)
  const mod = await import(`${pathToFileURL(tempModule).href}?ts=${Date.now()}`)
  return mod.TaskToastManager
}

function captureToastClient(messages) {
  return {
    tui: {
      showToast(payload) {
        messages.push(payload.body.message)
        return Promise.resolve()
      },
    },
  }
}

test("task toast shows Ira identity for running and queued Ira tasks", async () => {
  const TaskToastManager = await loadTaskToastManager()
  const messages = []
  const manager = new TaskToastManager(captureToastClient(messages), {
    getConcurrencyLimit() {
      return 2
    },
  })

  manager.addTask({
    id: "ira-running",
    description: "Ira smoke lane",
    agent: "ira",
    isBackground: false,
    category: "quick",
    modelInfo: { model: "ollama/gemma4:e2b", type: "configured" },
  })
  manager.addTask({
    id: "ira-queued",
    description: "Ira queued lane",
    agent: "ira",
    isBackground: false,
    status: "queued",
    category: "context-summarization",
    modelInfo: { model: "ollama/gemma4:e2b", type: "configured" },
  })
  manager.addTask({
    id: "other-running",
    description: "Non-Ira lane",
    agent: "june",
    isBackground: false,
    category: "deep",
    modelInfo: { model: "opencode-go/deepseek-v4-pro", type: "configured" },
  })

  const latest = messages.at(-1)
  assert.match(latest, /Ira smoke lane \(IRA LOCAL • gemma4:e2b: quick\)/)
  assert.match(latest, /Ira queued lane \(IRA LOCAL • gemma4:e2b: context-summarization\) - Queued/)
  assert.match(latest, /Non-Ira lane \(deepseek-v4-pro: deep\)/)
})

test("task toast still shows Ira when model info is absent", async () => {
  const TaskToastManager = await loadTaskToastManager()
  const messages = []
  const manager = new TaskToastManager(captureToastClient(messages), {
    getConcurrencyLimit() {
      return Infinity
    },
  })

  manager.addTask({
    id: "ira-no-model",
    description: "Ira plain lane",
    agent: "ira",
    isBackground: true,
  })

  const latest = messages.at(-1)
  assert.match(latest, /\[BG\] Ira plain lane \(IRA LOCAL\) - 0s/)
})
