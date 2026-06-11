#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { arch, cpus, homedir, platform, totalmem } from "node:os"
import { join, resolve } from "node:path"

const REQUIRED_FIELDS = Object.freeze([
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
])

const GEMMA_OFFICIAL_SOURCES = Object.freeze([
  "https://gemma-llm.readthedocs.io/en/latest/colab_finetuning.html",
  "https://gemma-llm.readthedocs.io/en/latest/colab_tokenizer.html",
  "https://gemma-llm.readthedocs.io/en/latest/peft.html",
  "https://gemma-llm.readthedocs.io/en/latest/research.html",
  "https://ai.google.dev/gemma/docs/core/model_card_4",
  "https://ai.google.dev/gemma/docs/functiongemma",
])

const IRA_SMOKE_MARKER = "IRA_GEMMA_BRAIN_SMOKE_OK"

const GEMMA_WEIGHT_EVIDENCE = Object.freeze({
  gemma4_e2b: {
    context: "128K",
    intended_platform: "mobile devices",
    weights_gb: {
      BF16: 11.4,
      SFP8: 5.7,
      Q4_0: 2.9,
      Mobile: 1.1,
      "Mobile text-only": 0.84,
    },
  },
  gemma4_12b: {
    context: "256K",
    intended_platform: "laptops/desktops/small servers",
    weights_gb: {
      BF16: 26.7,
      SFP8: 13.4,
      Q4_0: 6.7,
    },
  },
})

function parseArgs(argv) {
  const parsed = { mode: null, outputDir: null, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--help" || arg === "-h") return { ok: true, parsed: { ...parsed, help: true } }
    if (arg !== "--mode" && arg !== "--output-dir") return { ok: false, error: `unknown argument: ${sanitizeString(arg)}`, parsed }
    const value = argv[index + 1]
    if (!value || value.startsWith("--")) return { ok: false, error: `missing value for ${arg}`, parsed }
    index += 1
    if (arg === "--mode") parsed.mode = value
    if (arg === "--output-dir") parsed.outputDir = value
  }
  return { ok: true, parsed }
}

function sanitizeString(value) {
  return String(value)
    .replace(/(["'])(token|secret|api[_-]?key|password)\1(\s*:\s*)(["'])(.*?)\4/gi, (_match, keyQuote, key, separator, valueQuote) => `${keyQuote}${key}${keyQuote}${separator}${valueQuote}[REDACTED]${valueQuote}`)
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]")
    .replace(/(^|[^\w"'])(token|secret|api[_-]?key|password)\b\s*[:=]\s*[^\s,}]+/gi, (_match, prefix, key) => `${prefix}${key}=[REDACTED]`)
    .replace(/fixture-secret-token-must-not-leak/g, "[REDACTED]")
}

function isSecretKey(key) {
  return /^(token|secret|api[_-]?key|password|access_token|refresh_token|id_token|client_secret|authorization|cookie|set-cookie)$/i.test(String(key))
}

function sanitizeReportValue(value, key = "") {
  if (value === null || value === undefined) return value
  if (isSecretKey(key)) return "[REDACTED]"
  if (typeof value === "string") return sanitizeString(value)
  if (Array.isArray(value)) return value.map((item) => sanitizeReportValue(item))
  if (typeof value === "object") {
    const sanitized = {}
    for (const [entryKey, entryValue] of Object.entries(value)) sanitized[entryKey] = sanitizeReportValue(entryValue, entryKey)
    return sanitized
  }
  return value
}

function readJsonLike(path) {
  if (!path) return { exists: false, ok: false, path: null, error: "not configured" }
  const resolved = resolve(path)
  if (!existsSync(resolved)) return { exists: false, ok: false, path: resolved, error: "missing file" }
  try {
    const raw = readFileSync(resolved, "utf8")
    const stripped = raw
      .replace(/(^|\n)\s*\/\/.*(?=\n|$)/g, "$1")
      .replace(/,\s*([}\]])/g, "$1")
    JSON.parse(stripped)
    return { exists: true, ok: true, path: resolved, error: null }
  } catch (error) {
    return { exists: true, ok: false, path: resolved, error: sanitizeString(error?.message || String(error)) }
  }
}

function parseHardwareFixture(env) {
  const raw = env.IRA_BRAIN_HARDWARE_FIXTURE_JSON
  if (!raw) return { ok: false, source: "none", vram_gb: null, error: "no GPU/VRAM fixture provided" }
  try {
    const parsed = JSON.parse(raw)
    const value = parsed?.gpu?.vram_gb ?? parsed?.vram_gb ?? parsed?.vramGb
    const vram = Number(value)
    if (!Number.isFinite(vram) || vram <= 0) {
      return { ok: false, source: "env_fixture", vram_gb: null, error: "fixture did not include positive vram_gb" }
    }
    return { ok: true, source: "env_fixture", vram_gb: vram, error: null }
  } catch (error) {
    return { ok: false, source: "env_fixture", vram_gb: null, error: sanitizeString(error?.message || String(error)) }
  }
}

function runtimePlatform(env) {
  return env.IRA_BRAIN_TEST_PLATFORM || platform()
}

function parsePositiveNumbers(raw) {
  return String(raw || "")
    .split(/[^0-9.]+/)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0)
}

function parseDetectedVramGb(raw) {
  const values = parsePositiveNumbers(raw)
  if (values.length === 0) return null
  const largest = Math.max(...values)
  return Math.round((largest / 1024) * 10) / 10
}

function parseDetectedVramBytesToGb(raw) {
  const values = parsePositiveNumbers(raw)
  if (values.length === 0) return null
  const largest = Math.max(...values)
  return Math.round((largest / 1024 ** 3) * 10) / 10
}

function parseDetectedVramAppleGb(raw) {
  const matches = [...String(raw || "").matchAll(/([0-9]+(?:\.[0-9]+)?)\s*(GB|MB)/gi)]
  if (matches.length === 0) return null
  const values = matches.map((match) => {
    const amount = Number(match[1])
    const unit = String(match[2]).toUpperCase()
    return unit === "GB" ? amount : amount / 1024
  })
  const largest = Math.max(...values)
  return Math.round(largest * 10) / 10
}

function hardwareProbeCommand(env) {
  const raw = env.IRA_BRAIN_HARDWARE_COMMAND_JSON
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((item) => typeof item !== "string" || item.length === 0)) {
      return { invalid: true, error: "hardware probe command must be a non-empty JSON array of strings" }
    }
    return { command: parsed[0], args: parsed.slice(1) }
  } catch (error) {
    return { invalid: true, error: sanitizeString(error?.message || String(error)) }
  }
}

function probeHardwareVram(env) {
  if (env.IRA_BRAIN_DISABLE_HARDWARE_PROBE === "1") {
    return { ok: false, source: "disabled", vram_gb: null, error: "hardware probing disabled by IRA_BRAIN_DISABLE_HARDWARE_PROBE=1" }
  }

  const override = hardwareProbeCommand(env)
  if (override?.invalid) {
    return { ok: false, source: "local_probe", vram_gb: null, error: override.error }
  }
  if (override?.command) {
    const probed = runLocalCommand(override.command, override.args, 15000)
    const vramGb = probed.status === 0 ? parseDetectedVramGb(`${probed.stdout_excerpt}\n${probed.stderr_excerpt}`) : null
    return {
      ok: probed.status === 0 && vramGb !== null,
      source: "local_probe",
      vram_gb: vramGb,
      error: probed.status === 0 ? (vramGb === null ? "hardware probe did not return a positive VRAM value" : null) : (probed.error || probed.stderr_excerpt || "hardware probe command failed"),
    }
  }

  const currentPlatform = runtimePlatform(env)
  if (currentPlatform === "darwin") {
    const systemProfiler = runLocalCommand("system_profiler", ["SPDisplaysDataType", "-json"], 15000)
    if (systemProfiler.status === 0) {
      const vramGb = parseDetectedVramAppleGb(`${systemProfiler.stdout_excerpt}\n${systemProfiler.stderr_excerpt}`)
      if (vramGb !== null) return { ok: true, source: "local_probe", vram_gb: vramGb, error: null }
      return { ok: false, source: "local_probe", vram_gb: null, error: "system_profiler did not return a positive VRAM value" }
    }
    return { ok: false, source: "none", vram_gb: null, error: "no local GPU/VRAM probe succeeded" }
  }

  if (currentPlatform === "win32") {
    const powershell = runLocalCommand("powershell.exe", ["-NoProfile", "-Command", "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty AdapterRAM"], 15000)
    if (powershell.status === 0) {
      const vramGb = parseDetectedVramBytesToGb(`${powershell.stdout_excerpt}\n${powershell.stderr_excerpt}`)
      if (vramGb !== null) return { ok: true, source: "local_probe", vram_gb: vramGb, error: null }
      return { ok: false, source: "local_probe", vram_gb: null, error: "powershell video adapter probe did not return a positive VRAM value" }
    }
    const wmic = runLocalCommand("wmic", ["path", "win32_VideoController", "get", "AdapterRAM"], 15000)
    if (wmic.status === 0) {
      const vramGb = parseDetectedVramBytesToGb(`${wmic.stdout_excerpt}\n${wmic.stderr_excerpt}`)
      if (vramGb !== null) return { ok: true, source: "local_probe", vram_gb: vramGb, error: null }
      return { ok: false, source: "local_probe", vram_gb: null, error: "wmic video adapter probe did not return a positive VRAM value" }
    }
    return { ok: false, source: "none", vram_gb: null, error: "no local GPU/VRAM probe succeeded" }
  }

  const nvidia = runLocalCommand("nvidia-smi", ["--query-gpu=memory.total", "--format=csv,noheader,nounits"], 15000)
  if (nvidia.status === 0) {
    const vramGb = parseDetectedVramGb(`${nvidia.stdout_excerpt}\n${nvidia.stderr_excerpt}`)
    if (vramGb !== null) return { ok: true, source: "local_probe", vram_gb: vramGb, error: null }
    return { ok: false, source: "local_probe", vram_gb: null, error: "nvidia-smi did not return a positive VRAM value" }
  }

  return { ok: false, source: "none", vram_gb: null, error: "no local GPU/VRAM probe succeeded" }
}

function bestFittingWeight(vramGb, weights) {
  const entries = Object.entries(weights)
    .filter(([, size]) => vramGb >= size)
    .sort((left, right) => right[1] - left[1])
  if (entries.length === 0) return null
  const [format, weight_gb] = entries[0]
  return { format, weight_gb }
}

function modelRecommendation(vramGb, model) {
  if (vramGb === null) {
    return {
      context: model.context,
      intended_platform: model.intended_platform,
      weights_gb: model.weights_gb,
      recommendation: "unavailable_no_vram_evidence",
      fitting_weight: null,
    }
  }
  const fittingWeight = bestFittingWeight(vramGb, model.weights_gb)
  return {
    context: model.context,
    intended_platform: model.intended_platform,
    weights_gb: model.weights_gb,
    recommendation: fittingWeight ? "fits_documented_weight_size" : "blocked_by_weight_size",
    fitting_weight: fittingWeight,
  }
}

function localHardwareFacts() {
  const cpuList = cpus()
  const firstModel = cpuList.find((cpu) => typeof cpu?.model === "string" && cpu.model.trim().length > 0)?.model || null
  return {
    platform: runtimePlatform(process.env),
    arch: arch(),
    total_memory_gb: Math.round((totalmem() / 1024 ** 3) * 10) / 10,
    cpu_count: cpuList.length,
    cpu_model: firstModel ? sanitizeString(firstModel) : null,
  }
}

function excerpt(value, limit = 1200) {
  const sanitized = sanitizeString(value || "")
  return sanitized.length > limit ? `${sanitized.slice(0, limit)}...[truncated]` : sanitized
}

function suggestedVariant(vramGb, e2bRecommendation, twelveBRecommendation) {
  if (vramGb === null) {
    return {
      variant: "unavailable",
      basis: "unavailable",
      reason: "No GPU/VRAM fixture is available; local system RAM/CPU facts are reported but not used as Gemma 4 run thresholds.",
      fitting_weight: null,
    }
  }

  if (twelveBRecommendation.fitting_weight) {
    return {
      variant: "gemma4_12b",
      basis: "derived_from_weight_size",
      reason: "Gemma 4 12B Q4_0 documented weight size fits available VRAM evidence.",
      fitting_weight: twelveBRecommendation.fitting_weight,
    }
  }

  if (e2bRecommendation.fitting_weight) {
    return {
      variant: "gemma4_e2b",
      basis: "derived_from_weight_size",
      reason: `Gemma 4 E2B ${e2bRecommendation.fitting_weight.format} documented weight size fits available VRAM evidence; Gemma 4 12B Q4_0 documented weight size does not fit.`,
      fitting_weight: e2bRecommendation.fitting_weight,
    }
  }

  return {
    variant: "unavailable",
    basis: "derived_from_weight_size",
    reason: "Available VRAM evidence does not fit any documented Gemma 4 E2B or 12B weight size.",
    fitting_weight: null,
  }
}

function hardwareRecommendation(env) {
  const fixture = parseHardwareFixture(env)
  const probe = fixture.ok ? null : probeHardwareVram(env)
  const evidence = fixture.ok ? fixture : probe
  const vramGb = evidence?.ok ? evidence.vram_gb : null
  const thresholdStatus = evidence?.ok ? "available" : "unavailable"
  const thresholdBasis = evidence?.ok ? "derived_from_weight_size" : "unavailable"
  const e2bRecommendation = modelRecommendation(vramGb, GEMMA_WEIGHT_EVIDENCE.gemma4_e2b)
  const twelveBRecommendation = modelRecommendation(vramGb, GEMMA_WEIGHT_EVIDENCE.gemma4_12b)
  return {
    threshold_status: thresholdStatus,
    threshold_basis: thresholdBasis,
    note: evidence?.ok
      ? "VRAM comparison uses documented weight sizes only; it is not an official minimum VRAM threshold and adds no overhead multiplier."
      : "No GPU/VRAM evidence is available; the report does not claim Gemma 4 12B can run.",
    hardware_evidence: {
      source: evidence?.ok ? evidence.source : "local_safe_facts",
      vram_gb: vramGb,
      error: evidence?.error || null,
      local: localHardwareFacts(),
    },
    suggested_variant: suggestedVariant(vramGb, e2bRecommendation, twelveBRecommendation),
    gemma4_e2b: e2bRecommendation,
    gemma4_12b: twelveBRecommendation,
    sources: [...GEMMA_OFFICIAL_SOURCES],
  }
}

function runLocalCommand(command, args, timeout = 15000) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
  })
  return {
    status: typeof result.status === "number" ? result.status : null,
    signal: result.signal || null,
    error: result.error ? sanitizeString(result.error.message || String(result.error)) : null,
    stdout_excerpt: excerpt(result.stdout),
    stderr_excerpt: excerpt(result.stderr),
  }
}

function localBehaviorSmokeForMode(mode, env, iraReadiness) {
  if (mode === "hardware-recommendation") {
    return {
      skipped: true,
      reason: "hardware-recommendation mode does not import Cave Meister plugin or invoke Ira",
    }
  }
  if (!iraReadiness.ready) {
    return {
      skipped: true,
      reason: "Ira readiness is blocked; behavior smoke requires local Ollama model readiness",
    }
  }

  const binary = iraReadiness.ollama?.binary || env.NIFTY_IRA_OLLAMA_BINARY || env.OLLAMA_BINARY || "ollama"
  const model = iraReadiness.model_required || "gemma4:e2b"
  const prompt = `You are Ira, the local Cave Meister diagnostic agent. Reply with exactly ${IRA_SMOKE_MARKER} and no other text.`
  const command = runLocalCommand(binary, ["run", model, prompt], 30000)
  const combined = `${command.stdout_excerpt}\n${command.stderr_excerpt}`
  const markerFound = combined.includes(IRA_SMOKE_MARKER)

  return {
    ok: command.status === 0 && markerFound,
    source: "local_ollama",
    binary,
    model,
    expected_marker: IRA_SMOKE_MARKER,
    marker_found: markerFound,
    exit_code: command.status,
    signal: command.signal,
    error: command.error,
    stdout_excerpt: command.stdout_excerpt,
    stderr_excerpt: command.stderr_excerpt,
  }
}

function validationCommandFromEnv(env) {
  const raw = env.IRA_BRAIN_SELF_IMPROVE_VALIDATION_COMMAND_JSON
  if (!raw) return { ok: false, skipped: true, reason: "IRA_BRAIN_SELF_IMPROVE_VALIDATION_COMMAND_JSON was not provided" }
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((item) => typeof item !== "string" || item.length === 0)) {
      return { ok: false, skipped: false, error: "validation command must be a non-empty JSON array of strings" }
    }
    return { ok: true, command: parsed[0], args: parsed.slice(1) }
  } catch (error) {
    return { ok: false, skipped: false, error: sanitizeString(error?.message || String(error)) }
  }
}

function detectValidationSignals(output, exitCode) {
  const signals = []
  const text = String(output || "")
  if (exitCode !== 0) signals.push("nonzero_exit")
  if (/^not ok\b/im.test(text)) signals.push("tap_not_ok")
  if (/ERR_TEST_FAILURE|AssertionError/i.test(text)) signals.push("test_failure")
  if (/(^|\n)\s*(\[error\]|ERROR:|Error:|Failed\b)/i.test(text)) signals.push("error_log")
  return [...new Set(signals)]
}

function localValidationForMode(mode, env) {
  if (mode === "hardware-recommendation") {
    return {
      skipped: true,
      reason: "hardware-recommendation mode does not run plugin validation commands",
    }
  }

  const parsed = validationCommandFromEnv(env)
  if (parsed.skipped) return parsed
  if (!parsed.ok) {
    return {
      ok: false,
      source: "local_command",
      error: parsed.error,
      detected_signals: ["invalid_validation_command"],
    }
  }

  const command = runLocalCommand(parsed.command, parsed.args, 120000)
  const combined = `${command.stdout_excerpt}\n${command.stderr_excerpt}`
  const detectedSignals = detectValidationSignals(combined, command.status)
  return {
    ok: command.status === 0 && detectedSignals.length === 0,
    source: "local_command",
    command: parsed.command,
    args: parsed.args,
    exit_code: command.status,
    signal: command.signal,
    error: command.error,
    stdout_excerpt: command.stdout_excerpt,
    stderr_excerpt: command.stderr_excerpt,
    detected_signals: detectedSignals,
  }
}

function selfImprovementReport({ iraReadiness, gemmaBrain, hardware, localBehaviorSmoke, localValidation }) {
  const adjustments = []
  if (!iraReadiness.skipped && !iraReadiness.ready) {
    adjustments.push("Install Ollama locally and pull gemma4:e2b before using Ira/Gemma Brain together.")
  }
  if (!gemmaBrain.skipped && !gemmaBrain.ok) {
    adjustments.push("Set IRA_BRAIN_AGENT_CONFIG and IRA_BRAIN_OPENCODE_CONFIG to readable JSON/JSONC config files.")
  }
  if (hardware.threshold_status !== "available") {
    adjustments.push("Provide sanitized IRA_BRAIN_HARDWARE_FIXTURE_JSON or enable a local VRAM probe so Gemma 4 hardware recommendations can move from unavailable to evidence-backed.")
  }
  if (!localBehaviorSmoke.skipped && !localBehaviorSmoke.ok) {
    adjustments.push("Ira local behavior smoke failed; inspect local Ollama model output, prompt calibration, and Gemma Brain routing before relying on Ira for self-improvement tasks.")
  }
  if (!localValidation.skipped && !localValidation.ok) {
    adjustments.push("A local validation command failed with real test/log evidence; fix the reported plugin errors before classifying the diagnostic surface as healthy.")
  }

  return {
    status: adjustments.length > 0 ? "adjustments_needed" : "ok",
    basis: "local_command_results",
    adjustments_needed: adjustments,
    evidence: {
      behavior_smoke: localBehaviorSmoke.skipped ? "skipped" : localBehaviorSmoke.ok ? "passed" : "failed",
      local_validation: localValidation.skipped ? "skipped" : localValidation.ok ? "passed" : "failed",
      validation_signals: localValidation.detected_signals || [],
    },
  }
}

function gemmaBrainConfig(env) {
  const home = env.HOME || homedir()
  const defaultAgentConfig = join(home, ".config", "opencode", "agents", "gemma-brain.json")
  const defaultOpencodeConfig = join(home, ".config", "opencode", "opencode.jsonc")
  const agentConfig = readJsonLike(env.IRA_BRAIN_AGENT_CONFIG || defaultAgentConfig)
  const opencodeConfig = readJsonLike(env.IRA_BRAIN_OPENCODE_CONFIG || defaultOpencodeConfig)
  return {
    surface: "Ira + Gemma Brain",
    agent_config: agentConfig,
    opencode_config: opencodeConfig,
    ok: agentConfig.ok && opencodeConfig.ok,
  }
}

function contextFromEnv(env) {
  return {
    env,
    abort: new AbortController().signal,
    directory: undefined,
    worktree: undefined,
    metadata() {},
  }
}

function buildChecks({ mode, iraReadiness, gemmaBrain, hardware, localBehaviorSmoke, localValidation }) {
  if (mode === "hardware-recommendation") {
    return {
      hardware_recommendation: {
        ok: true,
        detail: "Hardware recommendation report produced without importing the Cave Meister plugin or making model/provider calls",
      },
      no_external_ai_mode: {
        ok: true,
        detail: "diagnostic performs local hardware evidence checks only and records no model generation calls",
      },
      hardware_evidence: {
        ok: true,
        detail: hardware.note,
      },
      local_behavior_smoke: {
        ok: Boolean(localBehaviorSmoke.skipped),
        detail: localBehaviorSmoke.reason,
      },
      local_validation: {
        ok: Boolean(localValidation.skipped),
        detail: localValidation.reason,
      },
    }
  }

  return {
    no_external_ai_mode: {
      ok: mode === "no-external-ai",
      detail: "diagnostic performs local file/readiness checks only and records no model generation calls",
    },
    ira_gemma_brain_surface: {
      ok: Boolean(iraReadiness.ready && gemmaBrain.ok),
      detail: "Ira local Ollama readiness and Gemma Brain config are evaluated as one diagnostic surface",
    },
    ira_readiness: {
      ok: Boolean(iraReadiness.ready),
      detail: iraReadiness.ready ? "Ira model prerequisites are ready" : "Ira local Ollama/model prerequisites are blocked",
    },
    gemma_brain_config: {
      ok: gemmaBrain.ok,
      detail: gemmaBrain.ok ? "Gemma Brain agent and OpenCode config fixtures are readable" : "Gemma Brain config fixture is missing or invalid",
    },
    hardware_evidence: {
      ok: hardware.threshold_status === "available",
      detail: hardware.note,
    },
    local_behavior_smoke: {
      ok: localBehaviorSmoke.skipped ? true : Boolean(localBehaviorSmoke.ok),
      detail: localBehaviorSmoke.skipped ? localBehaviorSmoke.reason : localBehaviorSmoke.ok ? "Ira local behavior smoke returned the expected marker" : "Ira local behavior smoke failed to return the expected marker",
    },
    local_validation: {
      ok: localValidation.skipped ? true : Boolean(localValidation.ok),
      detail: localValidation.skipped ? localValidation.reason : localValidation.ok ? "Local plugin validation command passed without detected error signals" : "Local plugin validation command failed or emitted error signals",
    },
  }
}

function summarizeFindings({ checks, iraReadiness, gemmaBrain, hardware, localBehaviorSmoke, localValidation }) {
  if (!checks.ira_gemma_brain_surface) {
    const findings = [
      {
        id: "hardware-recommendation-produced",
        severity: "info",
        summary: `Hardware recommendation produced with suggested variant ${hardware.suggested_variant.variant}.`,
      },
    ]
    if (hardware.threshold_status !== "available") {
      findings.push({
        id: "hardware-evidence-unavailable",
        severity: "warning",
        summary: "No GPU/VRAM evidence is available; 12B runtime suitability is not claimed.",
      })
    }
    return findings
  }

  const findings = [
    {
      id: "ira-gemma-brain-single-surface",
      severity: checks.ira_gemma_brain_surface.ok ? "info" : "blocker",
      summary: checks.ira_gemma_brain_surface.ok
        ? "Ira and Gemma Brain prerequisites passed together."
        : "Ira and Gemma Brain are not ready as one diagnostic surface.",
    },
  ]
  if (!iraReadiness.skipped && !iraReadiness.ready) {
    findings.push({
      id: "ira-readiness-blocked",
      severity: "blocker",
      summary: "Ira cannot confirm local Ollama Gemma readiness.",
      remediation: iraReadiness.install?.model || "Install Ollama and pull the required Gemma model.",
    })
  }
  if (!gemmaBrain.skipped && !gemmaBrain.ok) {
    findings.push({
      id: "gemma-brain-config-blocked",
      severity: "blocker",
      summary: "Gemma Brain agent/OpenCode config evidence is missing or invalid.",
    })
  }
  if (!localBehaviorSmoke.skipped && !localBehaviorSmoke.ok) {
    findings.push({
      id: "ira-behavior-smoke-failed",
      severity: "blocker",
      summary: "Ira local behavior smoke did not return the expected marker from the local Ollama model.",
    })
  }
  if (!localValidation.skipped && !localValidation.ok) {
    findings.push({
      id: "local-validation-failed",
      severity: "blocker",
      summary: "A local validation command failed or emitted test/log error signals.",
    })
  }
  if (hardware.threshold_status !== "available") {
    findings.push({
      id: "hardware-evidence-unavailable",
      severity: "warning",
      summary: "No GPU/VRAM evidence is available; 12B runtime suitability is not claimed.",
    })
  }
  return findings
}

function summarizeRecommendations({ iraReadiness, gemmaBrain, hardware, localBehaviorSmoke, localValidation }) {
  const recommendations = []
  if (!iraReadiness.skipped && !iraReadiness.ready) recommendations.push("Install Ollama locally and pull gemma4:e2b before using Ira/Gemma Brain together.")
  if (!gemmaBrain.skipped && !gemmaBrain.ok) recommendations.push("Set IRA_BRAIN_AGENT_CONFIG and IRA_BRAIN_OPENCODE_CONFIG to readable JSON/JSONC config files.")
  if (hardware.threshold_status !== "available") recommendations.push("Provide sanitized IRA_BRAIN_HARDWARE_FIXTURE_JSON with vram_gb to derive weight-size-only recommendations.")
  if (hardware.gemma4_12b.recommendation === "blocked_by_weight_size") recommendations.push("Do not select Gemma 4 12B on this fixture; the documented smallest 12B weight is larger than available VRAM evidence.")
  if (!localBehaviorSmoke.skipped && !localBehaviorSmoke.ok) recommendations.push("Tune Ira's local prompt/model/routing until the local behavior smoke returns the expected marker.")
  if (!localValidation.skipped && !localValidation.ok) recommendations.push("Fix the local validation command failures reported in local_validation before treating the plugin as healthy.")
  return recommendations
}

function markdownReport(report) {
  const iraReady = report.ira_readiness?.skipped ? "skipped" : String(report.ira_readiness?.ready)
  const gemmaBrainReady = report.gemma_brain?.skipped ? "skipped" : String(report.gemma_brain?.ok)
  return [
    "# Ira + Gemma Brain Self-Improvement Diagnostic",
    "",
    `- Status: ${report.status}`,
    `- Mode: ${report.mode}`,
    `- External AI calls: ${report.external_ai_calls.length}`,
    `- Ira ready: ${iraReady}`,
    `- Gemma Brain config ready: ${gemmaBrainReady}`,
    `- Hardware threshold status: ${report.hardware_recommendation.threshold_status}`,
    `- Hardware threshold basis: ${report.hardware_recommendation.threshold_basis}`,
    `- Ira local behavior smoke: ${report.local_behavior_smoke.skipped ? "skipped" : report.local_behavior_smoke.ok ? "passed" : "failed"}`,
    `- Local validation: ${report.local_validation.skipped ? "skipped" : report.local_validation.ok ? "passed" : "failed"}`,
    "",
    "## Findings",
    ...report.findings.map((finding) => `- ${finding.severity}: ${finding.id} — ${finding.summary}`),
    "",
    "## Recommendations",
    ...(report.recommendations.length > 0 ? report.recommendations.map((item) => `- ${item}`) : ["- No action required."]),
    "",
    "## Evidence paths",
    `- JSON: ${report.evidence_paths.json_report}`,
    `- Markdown: ${report.evidence_paths.markdown_report}`,
    "",
  ].join("\n")
}

function orderedReport(report) {
  const ordered = {}
  for (const field of REQUIRED_FIELDS) ordered[field] = report[field]
  return ordered
}

function writeReports(report, outputDir) {
  mkdirSync(outputDir, { recursive: true })
  writeFileSync(report.evidence_paths.json_report, `${JSON.stringify(report, null, 2)}\n`)
  writeFileSync(report.evidence_paths.markdown_report, markdownReport(report))
}

function usage(exitCode, error = null) {
  const payload = sanitizeReportValue({
    ok: false,
    status: "usage_error",
    mode: null,
    error,
    usage: "ira-gemma-brain-self-improve.mjs --mode no-external-ai|hardware-recommendation --output-dir <dir>",
    external_ai_calls: [],
    exit_code: exitCode,
  })
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
  return exitCode
}

async function iraReadinessForMode(mode) {
  if (mode === "hardware-recommendation") {
    return {
      skipped: true,
      reason: "hardware-recommendation mode does not import Cave Meister plugin or check Ira/Ollama readiness",
    }
  }
  const { NiftyPlugin } = await import("../plugin/nifty.js")
  return NiftyPlugin.__test.iraReadiness(contextFromEnv(process.env))
}

function gemmaBrainForMode(mode) {
  if (mode === "hardware-recommendation") {
    return {
      skipped: true,
      reason: "hardware-recommendation mode does not require Gemma Brain config readiness",
    }
  }
  return gemmaBrainConfig(process.env)
}

async function main() {
  const startedAt = new Date().toISOString()
  const args = parseArgs(process.argv.slice(2))
  if (!args.ok) return usage(64, args.error)
  if (args.parsed.help) return usage(0)
  if (args.parsed.mode !== "no-external-ai" && args.parsed.mode !== "hardware-recommendation") return usage(64, "--mode must be no-external-ai or hardware-recommendation")
  if (!args.parsed.outputDir) return usage(64, "--output-dir is required")

  const outputDir = resolve(args.parsed.outputDir)
  const evidencePaths = {
    json_report: resolve(outputDir, "ira-gemma-brain-self-improve-report.json"),
    markdown_report: resolve(outputDir, "ira-gemma-brain-self-improve-report.md"),
  }
  const mode = args.parsed.mode
  const iraReadiness = await iraReadinessForMode(mode)
  const gemmaBrain = gemmaBrainForMode(mode)
  const hardware = hardwareRecommendation(process.env)
  const localBehaviorSmoke = localBehaviorSmokeForMode(mode, process.env, iraReadiness)
  const localValidation = localValidationForMode(mode, process.env)
  const improvementReport = selfImprovementReport({ iraReadiness, gemmaBrain, hardware, localBehaviorSmoke, localValidation })
  const checks = buildChecks({ mode, iraReadiness, gemmaBrain, hardware, localBehaviorSmoke, localValidation })
  const ok = mode === "hardware-recommendation" ? true : Object.values(checks).every((check) => check.ok)
  const status = ok ? "ok" : "blocked"
  const exitCode = ok ? 0 : 2
  const report = sanitizeReportValue(orderedReport({
    ok,
    status,
    mode,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    checks,
    findings: summarizeFindings({ checks, iraReadiness, gemmaBrain, hardware, localBehaviorSmoke, localValidation }),
    recommendations: summarizeRecommendations({ iraReadiness, gemmaBrain, hardware, localBehaviorSmoke, localValidation }),
    evidence_paths: evidencePaths,
    external_ai_calls: [],
    ira_readiness: iraReadiness,
    gemma_brain: gemmaBrain,
    hardware_recommendation: hardware,
    local_behavior_smoke: localBehaviorSmoke,
    local_validation: localValidation,
    self_improvement_report: improvementReport,
    exit_code: exitCode,
  }))

  writeReports(report, outputDir)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  return exitCode
}

process.exitCode = await main()
