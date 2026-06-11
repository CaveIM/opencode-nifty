import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { test } from "node:test"

const repoRoot = new URL("..", import.meta.url).pathname
const scriptPath = join(repoRoot, "scripts", "ira-gemma-brain-self-improve.mjs")
const installScriptPath = join(repoRoot, "scripts", "install.sh")
const requiredGemmaSources = [
  "https://gemma-llm.readthedocs.io/en/latest/colab_finetuning.html",
  "https://gemma-llm.readthedocs.io/en/latest/colab_tokenizer.html",
  "https://gemma-llm.readthedocs.io/en/latest/peft.html",
  "https://gemma-llm.readthedocs.io/en/latest/research.html",
  "https://ai.google.dev/gemma/docs/core/model_card_4",
  "https://ai.google.dev/gemma/docs/functiongemma",
]

function parseStdoutJson(result) {
  assert.notEqual(result.stdout.trim(), "", "script should emit JSON stdout even when local prerequisites are blocked")
  return JSON.parse(result.stdout)
}

function writeExecutable(path, source) {
  writeFileSync(path, source)
  chmodSync(path, 0o755)
}

function writeFakeOllama(path, runBody) {
  writeExecutable(path, `#!/usr/bin/env bash
set -euo pipefail
case "\${1:-}" in
  --version)
    printf 'ollama version fixture\n'
    ;;
  list)
    printf 'NAME ID SIZE MODIFIED\n'
    printf 'gemma4:e2b fixture 7.2 GB now\n'
    ;;
  run)
    shift
    model="\${1:-}"
    shift || true
    if [ "$model" != "gemma4:e2b" ]; then
      printf 'unexpected model: %s\n' "$model" >&2
      exit 3
    fi
${runBody}
    ;;
  *)
    printf 'unexpected command: %s\n' "\${1:-}" >&2
    exit 2
    ;;
esac
`)
}

test("standalone Ira + Gemma Brain diagnostic emits sanitized blocked report without AI calls", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "ira-gemma-brain-self-improve-"))
  const outputDir = join(tempRoot, "reports")
  const agentConfig = join(tempRoot, "gemma-brain-agent.json")
  const opencodeConfig = join(tempRoot, "opencode.jsonc")

  writeFileSync(agentConfig, JSON.stringify({ name: "Gemma Brain", model: "ollama/gemma4:e2b" }, null, 2))
  writeFileSync(opencodeConfig, JSON.stringify({ agents: { "gemma-brain": agentConfig } }, null, 2))

  const result = spawnSync(process.execPath, [scriptPath, "--mode", "no-external-ai", "--output-dir", outputDir], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      IRA_BRAIN_AGENT_CONFIG: agentConfig,
      IRA_BRAIN_OPENCODE_CONFIG: opencodeConfig,
      IRA_BRAIN_HARDWARE_FIXTURE_JSON: JSON.stringify({ gpu: { name: "fixture-gpu", vram_gb: 6 } }),
      NIFTY_ACCESS_TOKEN: "fixture-secret-token-must-not-leak",
      NIFTY_IRA_OLLAMA_BINARY: "missing-ollama-for-ira-gemma-diagnostic-test",
    },
  })

  assert.equal(result.status, 2)
  assert.equal(result.stderr.trim(), "")

  const report = parseStdoutJson(result)
  const requiredFields = [
    "ok",
    "status",
    "mode",
    "started_at",
    "completed_at",
    "checks",
    "findings",
    "recommendations",
    "evidence_paths",
    "external_ai_calls",
    "ira_readiness",
    "gemma_brain",
    "hardware_recommendation",
    "local_behavior_smoke",
    "local_validation",
    "self_improvement_report",
    "exit_code",
  ]

  assert.deepEqual(Object.keys(report), requiredFields)
  assert.equal(report.ok, false)
  assert.equal(report.status, "blocked")
  assert.equal(report.mode, "no-external-ai")
  assert.equal(report.exit_code, 2)
  assert.deepEqual(report.external_ai_calls, [])
  assert.equal(report.ira_readiness.agent_name, "Ira")
  assert.equal(report.ira_readiness.ready, false)
  assert.equal(report.ira_readiness.ollama.binary, "missing-ollama-for-ira-gemma-diagnostic-test")
  assert.equal(report.gemma_brain.agent_config.exists, true)
  assert.equal(report.gemma_brain.opencode_config.exists, true)
  assert.equal(report.hardware_recommendation.threshold_basis, "derived_from_weight_size")
  assert.equal(report.hardware_recommendation.threshold_status, "available")
  assert.deepEqual(report.hardware_recommendation.suggested_variant, {
    variant: "gemma4_e2b",
    basis: "derived_from_weight_size",
    reason: "Gemma 4 E2B SFP8 documented weight size fits available VRAM evidence; Gemma 4 12B Q4_0 documented weight size does not fit.",
    fitting_weight: { format: "SFP8", weight_gb: 5.7 },
  })
  assert.equal(report.hardware_recommendation.gemma4_e2b.context, "128K")
  assert.equal(report.hardware_recommendation.gemma4_12b.context, "256K")
  assert.equal(report.hardware_recommendation.gemma4_12b.recommendation, "blocked_by_weight_size")
  assert.deepEqual(report.hardware_recommendation.sources, requiredGemmaSources)
  assert.equal(report.evidence_paths.json_report.endsWith("ira-gemma-brain-self-improve-report.json"), true)
  assert.equal(report.evidence_paths.markdown_report.endsWith("ira-gemma-brain-self-improve-report.md"), true)
  assert.equal(existsSync(report.evidence_paths.json_report), true)
  assert.equal(existsSync(report.evidence_paths.markdown_report), true)
  assert.equal(report.local_behavior_smoke.skipped, true)
  assert.equal(report.local_behavior_smoke.reason, "Ira readiness is blocked; behavior smoke requires local Ollama model readiness")
  assert.equal(report.local_validation.skipped, true)
  assert.equal(report.self_improvement_report.basis, "local_command_results")
  assert.equal(report.self_improvement_report.status, "adjustments_needed")
  assert.ok(report.self_improvement_report.adjustments_needed.some((item) => /Install Ollama locally and pull gemma4:e2b/.test(item)))

  const jsonReport = JSON.parse(readFileSync(report.evidence_paths.json_report, "utf8"))
  const markdownReport = readFileSync(report.evidence_paths.markdown_report, "utf8")

  assert.deepEqual(jsonReport.external_ai_calls, [])
  assert.match(markdownReport, /Ira \+ Gemma Brain Self-Improvement Diagnostic/)
  assert.doesNotMatch(result.stdout, /fixture-secret-token-must-not-leak/)
  assert.doesNotMatch(markdownReport, /fixture-secret-token-must-not-leak/)
})

test("standalone diagnostic uses default HOME Gemma Brain paths and reports local hardware facts without VRAM thresholds", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "ira-gemma-brain-default-home-"))
  const home = join(tempRoot, "home")
  const outputDir = join(tempRoot, "reports")
  const agentDir = join(home, ".config", "opencode", "agents")
  const agentConfig = join(agentDir, "gemma-brain.json")
  const opencodeConfig = join(home, ".config", "opencode", "opencode.jsonc")
  mkdirSync(agentDir, { recursive: true })

  writeFileSync(agentConfig, JSON.stringify({ name: "Gemma Brain", model: "ollama/gemma4:e2b" }, null, 2))
  writeFileSync(opencodeConfig, JSON.stringify({ agents: { "gemma-brain": agentConfig } }, null, 2))

  const env = { ...process.env, HOME: home, IRA_BRAIN_DISABLE_HARDWARE_PROBE: "1", NIFTY_IRA_OLLAMA_BINARY: "missing-ollama-default-home-test" }
  delete env.IRA_BRAIN_AGENT_CONFIG
  delete env.IRA_BRAIN_OPENCODE_CONFIG
  delete env.IRA_BRAIN_HARDWARE_FIXTURE_JSON

  const result = spawnSync(process.execPath, [scriptPath, "--mode", "no-external-ai", "--output-dir", outputDir], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
  })

  assert.equal(result.status, 2)
  assert.equal(result.stderr.trim(), "")

  const report = parseStdoutJson(result)
  assert.deepEqual(report.external_ai_calls, [])
  assert.equal(report.gemma_brain.agent_config.path, agentConfig)
  assert.equal(report.gemma_brain.agent_config.exists, true)
  assert.equal(report.gemma_brain.agent_config.ok, true)
  assert.equal(report.gemma_brain.opencode_config.path, opencodeConfig)
  assert.equal(report.gemma_brain.opencode_config.exists, true)
  assert.equal(report.gemma_brain.opencode_config.ok, true)
  assert.equal(report.hardware_recommendation.threshold_status, "unavailable")
  assert.equal(report.hardware_recommendation.threshold_basis, "unavailable")
  assert.equal(report.hardware_recommendation.hardware_evidence.source, "local_safe_facts")
  assert.equal(report.hardware_recommendation.hardware_evidence.vram_gb, null)
  assert.deepEqual(report.hardware_recommendation.suggested_variant, {
    variant: "unavailable",
    basis: "unavailable",
    reason: "No GPU/VRAM fixture is available; local system RAM/CPU facts are reported but not used as Gemma 4 run thresholds.",
    fitting_weight: null,
  })
  assert.equal(typeof report.hardware_recommendation.hardware_evidence.local.platform, "string")
  assert.equal(typeof report.hardware_recommendation.hardware_evidence.local.arch, "string")
  assert.equal(typeof report.hardware_recommendation.hardware_evidence.local.total_memory_gb, "number")
  assert.equal(typeof report.hardware_recommendation.hardware_evidence.local.cpu_count, "number")
  assert.ok(report.hardware_recommendation.hardware_evidence.local.total_memory_gb > 0)
  assert.ok(report.hardware_recommendation.hardware_evidence.local.cpu_count > 0)
  assert.equal(report.hardware_recommendation.gemma4_12b.recommendation, "unavailable_no_vram_evidence")
  assert.equal(report.self_improvement_report.status, "adjustments_needed")
  assert.ok(report.self_improvement_report.adjustments_needed.some((item) => /Provide sanitized IRA_BRAIN_HARDWARE_FIXTURE_JSON/.test(item)))
})

test("standalone diagnostic reports adjustments when Gemma Brain config is missing", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "ira-gemma-brain-missing-config-"))
  const outputDir = join(tempRoot, "reports")

  const result = spawnSync(process.execPath, [scriptPath, "--mode", "no-external-ai", "--output-dir", outputDir], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: join(tempRoot, "home"),
      IRA_BRAIN_DISABLE_HARDWARE_PROBE: "1",
      NIFTY_IRA_OLLAMA_BINARY: "missing-ollama-missing-config-test",
    },
  })

  assert.equal(result.status, 2)
  const report = parseStdoutJson(result)
  assert.equal(report.gemma_brain.ok, false)
  assert.ok(report.findings.some((finding) => finding.id === "gemma-brain-config-blocked"))
  assert.equal(report.self_improvement_report.status, "adjustments_needed")
  assert.ok(report.self_improvement_report.adjustments_needed.some((item) => /IRA_BRAIN_AGENT_CONFIG/.test(item)))
})

test("standalone diagnostic suggests Gemma 4 12B when fixture VRAM fits documented 12B Q4_0 weight", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "ira-gemma-brain-12b-suggestion-"))
  const outputDir = join(tempRoot, "reports")
  const agentConfig = join(tempRoot, "gemma-brain-agent.json")
  const opencodeConfig = join(tempRoot, "opencode.jsonc")

  writeFileSync(agentConfig, JSON.stringify({ name: "Gemma Brain", model: "ollama/gemma4:e2b" }, null, 2))
  writeFileSync(opencodeConfig, JSON.stringify({ agents: { "gemma-brain": agentConfig } }, null, 2))

  const result = spawnSync(process.execPath, [scriptPath, "--mode", "no-external-ai", "--output-dir", outputDir], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      IRA_BRAIN_AGENT_CONFIG: agentConfig,
      IRA_BRAIN_OPENCODE_CONFIG: opencodeConfig,
      IRA_BRAIN_HARDWARE_FIXTURE_JSON: JSON.stringify({ vram_gb: 8 }),
      NIFTY_IRA_OLLAMA_BINARY: "missing-ollama-12b-suggestion-test",
    },
  })

  assert.equal(result.status, 2)
  const report = parseStdoutJson(result)
  assert.equal(report.hardware_recommendation.threshold_basis, "derived_from_weight_size")
  assert.equal(report.hardware_recommendation.gemma4_12b.recommendation, "fits_documented_weight_size")
  assert.deepEqual(report.hardware_recommendation.suggested_variant, {
    variant: "gemma4_12b",
    basis: "derived_from_weight_size",
    reason: "Gemma 4 12B Q4_0 documented weight size fits available VRAM evidence.",
    fitting_weight: { format: "Q4_0", weight_gb: 6.7 },
  })
  assert.deepEqual(report.external_ai_calls, [])
})

test("no-external-ai runs local Ira behavior smoke through fixture Ollama without external AI calls", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "ira-gemma-brain-local-smoke-"))
  const outputDir = join(tempRoot, "reports")
  const agentConfig = join(tempRoot, "gemma-brain-agent.json")
  const opencodeConfig = join(tempRoot, "opencode.jsonc")
  const fakeOllama = join(tempRoot, "ollama")

  writeFileSync(agentConfig, JSON.stringify({ name: "Gemma Brain", model: "ollama/gemma4:e2b" }, null, 2))
  writeFileSync(opencodeConfig, JSON.stringify({ agents: { "gemma-brain": agentConfig } }, null, 2))
  writeFakeOllama(fakeOllama, "    printf 'IRA_GEMMA_BRAIN_SMOKE_OK local-only response\\n'")

  const result = spawnSync(process.execPath, [scriptPath, "--mode", "no-external-ai", "--output-dir", outputDir], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      IRA_BRAIN_AGENT_CONFIG: agentConfig,
      IRA_BRAIN_OPENCODE_CONFIG: opencodeConfig,
      IRA_BRAIN_HARDWARE_FIXTURE_JSON: JSON.stringify({ vram_gb: 8 }),
      NIFTY_IRA_OLLAMA_BINARY: fakeOllama,
    },
  })

  assert.equal(result.status, 0)
  const report = parseStdoutJson(result)
  assert.equal(report.ok, true)
  assert.equal(report.local_behavior_smoke.ok, true)
  assert.equal(report.local_behavior_smoke.source, "local_ollama")
  assert.equal(report.local_behavior_smoke.model, "gemma4:e2b")
  assert.match(report.local_behavior_smoke.stdout_excerpt, /IRA_GEMMA_BRAIN_SMOKE_OK/)
  assert.deepEqual(report.external_ai_calls, [])
  assert.deepEqual(report.self_improvement_report.adjustments_needed, [])
})

test("no-external-ai blocks when local Ira smoke does not return expected marker", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "ira-gemma-brain-local-smoke-fail-"))
  const outputDir = join(tempRoot, "reports")
  const agentConfig = join(tempRoot, "gemma-brain-agent.json")
  const opencodeConfig = join(tempRoot, "opencode.jsonc")
  const fakeOllama = join(tempRoot, "ollama")

  writeFileSync(agentConfig, JSON.stringify({ name: "Gemma Brain", model: "ollama/gemma4:e2b" }, null, 2))
  writeFileSync(opencodeConfig, JSON.stringify({ agents: { "gemma-brain": agentConfig } }, null, 2))
  writeFakeOllama(fakeOllama, "    printf 'wrong local model output\\n'")

  const result = spawnSync(process.execPath, [scriptPath, "--mode", "no-external-ai", "--output-dir", outputDir], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      IRA_BRAIN_AGENT_CONFIG: agentConfig,
      IRA_BRAIN_OPENCODE_CONFIG: opencodeConfig,
      IRA_BRAIN_HARDWARE_FIXTURE_JSON: JSON.stringify({ vram_gb: 8 }),
      NIFTY_IRA_OLLAMA_BINARY: fakeOllama,
    },
  })

  assert.equal(result.status, 2)
  const report = parseStdoutJson(result)
  assert.equal(report.local_behavior_smoke.ok, false)
  assert.equal(report.local_behavior_smoke.expected_marker, "IRA_GEMMA_BRAIN_SMOKE_OK")
  assert.ok(report.findings.some((finding) => finding.id === "ira-behavior-smoke-failed"))
  assert.ok(report.self_improvement_report.adjustments_needed.some((item) => /Ira local behavior smoke/.test(item)))
  assert.deepEqual(report.external_ai_calls, [])
})

test("self-improvement report detects failing local plugin validation and log errors", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "ira-gemma-brain-validation-fail-"))
  const outputDir = join(tempRoot, "reports")
  const agentConfig = join(tempRoot, "gemma-brain-agent.json")
  const opencodeConfig = join(tempRoot, "opencode.jsonc")
  const fakeOllama = join(tempRoot, "ollama")
  const validationCommand = join(tempRoot, "validation-command")

  writeFileSync(agentConfig, JSON.stringify({ name: "Gemma Brain", model: "ollama/gemma4:e2b" }, null, 2))
  writeFileSync(opencodeConfig, JSON.stringify({ agents: { "gemma-brain": agentConfig } }, null, 2))
  writeFakeOllama(fakeOllama, "    printf 'IRA_GEMMA_BRAIN_SMOKE_OK local-only response\\n'")
  writeExecutable(validationCommand, "#!/usr/bin/env bash\nprintf 'not ok 1 - RAG disabled still injected context\\n'\nprintf '[error] plugin bootstrap failed\\n' >&2\nexit 1\n")

  const result = spawnSync(process.execPath, [scriptPath, "--mode", "no-external-ai", "--output-dir", outputDir], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      IRA_BRAIN_AGENT_CONFIG: agentConfig,
      IRA_BRAIN_OPENCODE_CONFIG: opencodeConfig,
      IRA_BRAIN_HARDWARE_FIXTURE_JSON: JSON.stringify({ vram_gb: 8 }),
      IRA_BRAIN_SELF_IMPROVE_VALIDATION_COMMAND_JSON: JSON.stringify([validationCommand]),
      NIFTY_IRA_OLLAMA_BINARY: fakeOllama,
    },
  })

  assert.equal(result.status, 2)
  const report = parseStdoutJson(result)
  assert.equal(report.local_behavior_smoke.ok, true)
  assert.equal(report.local_validation.ok, false)
  assert.equal(report.local_validation.exit_code, 1)
  assert.ok(report.local_validation.detected_signals.includes("tap_not_ok"))
  assert.ok(report.local_validation.detected_signals.includes("error_log"))
  assert.match(report.local_validation.stdout_excerpt, /not ok 1/)
  assert.match(report.local_validation.stderr_excerpt, /plugin bootstrap failed/)
  assert.ok(report.findings.some((finding) => finding.id === "local-validation-failed"))
  assert.equal(report.self_improvement_report.status, "adjustments_needed")
  assert.ok(report.self_improvement_report.adjustments_needed.some((item) => /local validation command failed/.test(item)))
  assert.deepEqual(report.external_ai_calls, [])
})

test("hardware recommendation mode runs without Cave Meister plugin dependency and exits zero", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "ira-gemma-brain-hardware-only-"))
  const tempScriptsDir = join(tempRoot, "scripts")
  const outputDir = join(tempRoot, "reports")
  const copiedScript = join(tempScriptsDir, "ira-gemma-brain-self-improve.mjs")
  mkdirSync(tempScriptsDir, { recursive: true })
  writeFileSync(copiedScript, readFileSync(scriptPath, "utf8"))

  const result = spawnSync(process.execPath, [copiedScript, "--mode", "hardware-recommendation", "--output-dir", outputDir], {
    cwd: tempRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      IRA_BRAIN_HARDWARE_FIXTURE_JSON: JSON.stringify({ vram_gb: 8 }),
    },
  })

  assert.equal(result.status, 0)
  assert.equal(result.stderr.trim(), "")
  const report = parseStdoutJson(result)
  assert.equal(report.mode, "hardware-recommendation")
  assert.equal(report.ok, true)
  assert.equal(report.status, "ok")
  assert.equal(report.exit_code, 0)
  assert.deepEqual(report.external_ai_calls, [])
  assert.equal(report.hardware_recommendation.threshold_basis, "derived_from_weight_size")
  assert.deepEqual(report.hardware_recommendation.suggested_variant, {
    variant: "gemma4_12b",
    basis: "derived_from_weight_size",
    reason: "Gemma 4 12B Q4_0 documented weight size fits available VRAM evidence.",
    fitting_weight: { format: "Q4_0", weight_gb: 6.7 },
  })
  assert.equal(existsSync(report.evidence_paths.json_report), true)
  assert.equal(existsSync(report.evidence_paths.markdown_report), true)
  const markdownReport = readFileSync(report.evidence_paths.markdown_report, "utf8")
  assert.match(markdownReport, /Ira ready: skipped/)
  assert.match(markdownReport, /Gemma Brain config ready: skipped/)
  assert.doesNotMatch(markdownReport, /undefined/)
})

test("hardware recommendation mode auto-detects VRAM from local probe without fixture", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "ira-gemma-brain-hardware-probe-"))
  const tempScriptsDir = join(tempRoot, "scripts")
  const fakeBin = join(tempRoot, "bin")
  const copiedScript = join(tempScriptsDir, "ira-gemma-brain-self-improve.mjs")
  const outputDir = join(tempRoot, "reports")
  mkdirSync(tempScriptsDir, { recursive: true })
  mkdirSync(fakeBin, { recursive: true })
  writeFileSync(copiedScript, readFileSync(scriptPath, "utf8"))
  writeExecutable(join(fakeBin, "nvidia-smi"), "#!/usr/bin/env bash\nprintf '8192\n'\n")

  const result = spawnSync(process.execPath, [copiedScript, "--mode", "hardware-recommendation", "--output-dir", outputDir], {
    cwd: tempRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
    },
  })

  assert.equal(result.status, 0)
  const report = parseStdoutJson(result)
  assert.equal(report.hardware_recommendation.threshold_status, "available")
  assert.equal(report.hardware_recommendation.threshold_basis, "derived_from_weight_size")
  assert.equal(report.hardware_recommendation.hardware_evidence.source, "local_probe")
  assert.equal(report.hardware_recommendation.hardware_evidence.vram_gb, 8)
  assert.equal(report.hardware_recommendation.suggested_variant.variant, "gemma4_12b")
})

test("hardware recommendation mode auto-detects VRAM on macOS via system_profiler", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "ira-gemma-brain-hardware-macos-"))
  const tempScriptsDir = join(tempRoot, "scripts")
  const fakeBin = join(tempRoot, "bin")
  const copiedScript = join(tempScriptsDir, "ira-gemma-brain-self-improve.mjs")
  const outputDir = join(tempRoot, "reports")
  mkdirSync(tempScriptsDir, { recursive: true })
  mkdirSync(fakeBin, { recursive: true })
  writeFileSync(copiedScript, readFileSync(scriptPath, "utf8"))
  writeExecutable(join(fakeBin, "system_profiler"), "#!/usr/bin/env bash\nprintf '{\"SPDisplaysDataType\":[{\"spdisplays_vram\":\"8 GB\"}]}'\n")

  const result = spawnSync(process.execPath, [copiedScript, "--mode", "hardware-recommendation", "--output-dir", outputDir], {
    cwd: tempRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      IRA_BRAIN_TEST_PLATFORM: "darwin",
    },
  })

  assert.equal(result.status, 0)
  const report = parseStdoutJson(result)
  assert.equal(report.hardware_recommendation.hardware_evidence.source, "local_probe")
  assert.equal(report.hardware_recommendation.hardware_evidence.vram_gb, 8)
  assert.equal(report.hardware_recommendation.suggested_variant.variant, "gemma4_12b")
})

test("hardware recommendation mode auto-detects VRAM on Windows via powershell", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "ira-gemma-brain-hardware-win-"))
  const tempScriptsDir = join(tempRoot, "scripts")
  const fakeBin = join(tempRoot, "bin")
  const copiedScript = join(tempScriptsDir, "ira-gemma-brain-self-improve.mjs")
  const outputDir = join(tempRoot, "reports")
  mkdirSync(tempScriptsDir, { recursive: true })
  mkdirSync(fakeBin, { recursive: true })
  writeFileSync(copiedScript, readFileSync(scriptPath, "utf8"))
  writeExecutable(join(fakeBin, "powershell.exe"), "#!/usr/bin/env bash\nprintf '6442450944\n'")

  const result = spawnSync(process.execPath, [copiedScript, "--mode", "hardware-recommendation", "--output-dir", outputDir], {
    cwd: tempRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      IRA_BRAIN_TEST_PLATFORM: "win32",
    },
  })

  assert.equal(result.status, 0)
  const report = parseStdoutJson(result)
  assert.equal(report.hardware_recommendation.hardware_evidence.source, "local_probe")
  assert.equal(report.hardware_recommendation.hardware_evidence.vram_gb, 6)
  assert.equal(report.hardware_recommendation.suggested_variant.variant, "gemma4_e2b")
})

test("installer surfaces hardware recommendation report without running npm when skip flag is set", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "cave-meister-install-hardware-"))
  const configDir = join(tempRoot, "opencode-config")
  const fakeBin = join(tempRoot, "bin")
  const fakeNpm = join(fakeBin, "npm")
  mkdirSync(fakeBin, { recursive: true })
  writeFileSync(fakeNpm, "#!/usr/bin/env bash\nprintf 'npm should have been skipped\\n' >&2\nexit 42\n")
  chmodSync(fakeNpm, 0o755)

  const result = spawnSync("bash", [installScriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      OPENCODE_CONFIG_DIR: configDir,
      CAVE_MEISTER_SKIP_NPM_INSTALL: "1",
      IRA_BRAIN_HARDWARE_FIXTURE_JSON: JSON.stringify({ vram_gb: 6 }),
    },
  })

  assert.equal(result.status, 0)
  assert.doesNotMatch(result.stderr, /npm should have been skipped/)
  assert.match(result.stdout, /Ira\/Gemma Brain hardware recommendation: gemma4_e2b/)
  assert.match(result.stdout, /derived from official Gemma 4 documented weight sizes, no overhead multiplier/)
  assert.match(result.stdout, /Ira\/Gemma Brain diagnostic report: /)
  const reportPath = join(configDir, "cave-meister", "reports", "ira-gemma-brain-self-improve-report.json")
  assert.equal(existsSync(reportPath), true)
  const report = JSON.parse(readFileSync(reportPath, "utf8"))
  assert.equal(report.mode, "hardware-recommendation")
  assert.equal(report.exit_code, 0)
  assert.equal(report.hardware_recommendation.suggested_variant.variant, "gemma4_e2b")
})

test("installer surfaces hardware recommendation from local probe without fixture", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "cave-meister-install-hardware-probe-"))
  const configDir = join(tempRoot, "opencode-config")
  const fakeBin = join(tempRoot, "bin")
  const fakeNpm = join(fakeBin, "npm")
  mkdirSync(fakeBin, { recursive: true })
  writeFileSync(fakeNpm, "#!/usr/bin/env bash\nprintf 'npm should have been skipped\\n' >&2\nexit 42\n")
  chmodSync(fakeNpm, 0o755)
  writeExecutable(join(fakeBin, "nvidia-smi"), "#!/usr/bin/env bash\nprintf '3072\n'\n")

  const result = spawnSync("bash", [installScriptPath], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      OPENCODE_CONFIG_DIR: configDir,
      CAVE_MEISTER_SKIP_NPM_INSTALL: "1",
    },
  })

  assert.equal(result.status, 0)
  assert.match(result.stdout, /Ira\/Gemma Brain hardware recommendation: gemma4_e2b/)
  const reportPath = join(configDir, "cave-meister", "reports", "ira-gemma-brain-self-improve-report.json")
  const report = JSON.parse(readFileSync(reportPath, "utf8"))
  assert.equal(report.hardware_recommendation.hardware_evidence.source, "local_probe")
  assert.equal(report.hardware_recommendation.hardware_evidence.vram_gb, 3)
  assert.equal(report.hardware_recommendation.suggested_variant.variant, "gemma4_e2b")
})

test("usage error redacts Bearer credentials without leaking token text", () => {
  const result = spawnSync(process.execPath, [scriptPath, "Bearer secret-token-for-redaction-test"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env },
  })

  assert.equal(result.status, 64)
  const report = parseStdoutJson(result)
  assert.equal(report.error, "unknown argument: Bearer [REDACTED]")
  assert.doesNotMatch(result.stdout, /secret-token-for-redaction-test/)
})

test("usage error redacts JSON-like generic secret values without overmatching normal fields", () => {
  const arg = '{"api_key":"secret-token-for-json-like-test","path":"/tmp/report.json"}'
  const result = spawnSync(process.execPath, [scriptPath, arg], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env },
  })

  assert.equal(result.status, 64)
  const report = parseStdoutJson(result)
  assert.equal(report.error, 'unknown argument: {"api_key":"[REDACTED]","path":"/tmp/report.json"}')
  assert.doesNotMatch(result.stdout, /secret-token-for-json-like-test/)
  assert.match(result.stdout, /\/tmp\/report\.json/)
})

test("usage error redacts literal fixture secret without key prefix", () => {
  const result = spawnSync(process.execPath, [scriptPath, "fixture-secret-token-must-not-leak"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env },
  })

  assert.equal(result.status, 64)
  const report = parseStdoutJson(result)
  assert.equal(report.error, "unknown argument: [REDACTED]")
  assert.doesNotMatch(result.stdout, /fixture-secret-token-must-not-leak/)
})

test("usage error redacts generic token values without literal capture placeholder", () => {
  const result = spawnSync(process.execPath, [scriptPath, "token=fixture-secret-token-must-not-leak"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env },
  })

  assert.equal(result.status, 64)
  const report = parseStdoutJson(result)
  assert.equal(report.error, "unknown argument: token=[REDACTED]")
  assert.doesNotMatch(result.stdout, /fixture-secret-token-must-not-leak/)
  assert.doesNotMatch(result.stdout, /\$1/)
})

test("diagnostic recursively redacts secret-like values from report payloads before stdout and report files", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "ira-gemma-brain-recursive-redaction-"))
  const outputDir = join(tempRoot, "reports")
  const agentConfig = join(tempRoot, "gemma-brain-agent.json")
  const opencodeConfig = join(tempRoot, "opencode.jsonc")

  writeFileSync(agentConfig, JSON.stringify({ name: "Gemma Brain", model: "ollama/gemma4:e2b" }, null, 2))
  writeFileSync(opencodeConfig, JSON.stringify({ agents: { "gemma-brain": agentConfig } }, null, 2))

  const result = spawnSync(process.execPath, [scriptPath, "--mode", "no-external-ai", "--output-dir", outputDir], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      IRA_BRAIN_AGENT_CONFIG: agentConfig,
      IRA_BRAIN_OPENCODE_CONFIG: opencodeConfig,
      IRA_BRAIN_HARDWARE_FIXTURE_JSON: JSON.stringify({ vram_gb: 8 }),
      NIFTY_IRA_OLLAMA_BINARY: "token=fixture-secret-token-must-not-leak",
    },
  })

  assert.equal(result.status, 2)
  const report = parseStdoutJson(result)
  const jsonReport = readFileSync(report.evidence_paths.json_report, "utf8")
  const markdownReport = readFileSync(report.evidence_paths.markdown_report, "utf8")

  assert.equal(report.ira_readiness.ollama.binary, "token=[REDACTED]")
  assert.match(report.ira_readiness.ollama.error, /token=\[REDACTED\]/)
  assert.deepEqual(report.external_ai_calls, [])
  assert.doesNotMatch(result.stdout, /fixture-secret-token-must-not-leak/)
  assert.doesNotMatch(jsonReport, /fixture-secret-token-must-not-leak/)
  assert.doesNotMatch(markdownReport, /fixture-secret-token-must-not-leak/)
  assert.match(result.stdout, /https:\/\/ai\.google\.dev\/gemma\/docs\/core/)
  assert.match(jsonReport, /ira-gemma-brain-self-improve-report\.json/)
})
