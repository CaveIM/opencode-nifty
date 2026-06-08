import { fileURLToPath } from "node:url"
import { dirname, resolve, join } from "node:path"
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { exec, execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { promisify } from "node:util"
import { cwd } from "node:process"
import * as z from "zod"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { NiftyPlugin } from "../plugin/nifty.js"

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)
const { validateNiftyTaskCommentTemplate } = NiftyPlugin.__test

const _pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
const DEFAULT_SERVER_NAME = "nifty"
const DEFAULT_SERVER_VERSION = _pkg.version || "0.0.0"
const PLUGIN_CACHE_TTL_MS = parseInt(process.env.NIFTY_MCP_PLUGIN_CACHE_TTL_MS ?? "300000", 10)
const MCP_PROGRESS_DEFAULT_INTERVAL_MS = 5000
const MCP_PROGRESS_DEFAULT_IDLE_TTL_MS = 30 * 60 * 1000
const MCP_PROGRESS_DEFAULT_TEST_TIMEOUT_MS = 300000
const MCP_ACTIVE_TASK_STATE_VERSION = 1
const MCP_ACTIVE_TASK_DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const MCP_ACTIVE_TASK_DEFAULT_MAX_ENTRIES = 500
const MCP_ACTIVE_TASK_LOCK_TIMEOUT_MS = 3000
const MCP_ACTIVE_TASK_LOCK_STALE_MS = 10000
const MCP_ACTIVE_TASK_LOCK_WAIT_MS = 20
const MCP_POLICY_GATEWAY_DEFAULT_TIMEOUT_MS = 10000
const MCP_POLICY_GATEWAY_SENSITIVE_TOOL_PATTERNS = [
  "nifty_create_*",
  "nifty_run_*",
  "nifty_update_*",
  "nifty_delete_*",
  "nifty_move_*",
  "nifty_complete_*",
  "nifty_archive_*",
  "nifty_clone_*",
  "nifty_attach_*",
  "nifty_link_*",
  "nifty_batch_*",
  "nifty_prepare_*",
  "nifty_setup_*",
]
const MCP_TASK_OUTPUT_ID_TOOLS = new Set([
  "nifty_create_task",
  "nifty_create_subtask",
  "nifty_get_task",
  "nifty_update_task",
  "nifty_update_task_custom_fields",
  "nifty_update_task_assignees",
  "nifty_move_task_to_status",
  "nifty_complete_task",
  "nifty_complete_child_task",
  "nifty_archive_task",
  "nifty_prepare_task_for_delivery",
])

let pluginCache = null
let pluginCacheAt = 0
const mcpProgressStates = new Map()
const mcpActiveProgressKeys = new Map()
const mcpActiveTaskLockWaitBuffer = new Int32Array(new SharedArrayBuffer(4))

function assertMcpRuntime() {
  const major = Number.parseInt(process.versions.node.split(".")[0] || "0", 10)
  if (!Number.isFinite(major) || major < 20) {
    throw new Error(`Nifty MCP requires Node 20 or newer. Current Node: ${process.version}`)
  }
}

function formatIssues(issues = []) {
  return issues
    .map((issue) => {
      const path = issue.path?.length ? issue.path.join(".") : "args"
      return `${path}: ${issue.message}`
    })
    .join("; ")
}

function stringifyToolOutput(value) {
  if (typeof value === "string") return value
  if (value === undefined) return "OK"
  return JSON.stringify(value, null, 2)
}

function ensureTool(name, definition) {
  if (!definition || typeof definition.execute !== "function") {
    throw new Error(`Tool ${name} is not executable.`)
  }
}

function validateToolArgs(name, definition, args) {
  const schema = z.object(definition.args || {})
  const parsed = schema.safeParse(args || {})
  if (!parsed.success) {
    throw new Error(`Invalid arguments for ${name}: ${formatIssues(parsed.error.issues)}`)
  }
  return parsed.data
}

function normalizeMetadataEntries(entries = {}) {
  if (entries instanceof Map) return new Map(entries)
  return new Map(Object.entries(entries))
}

/**
 * Structured debug logger. Only writes when NIFTY_MCP_DEBUG is set.
 * Always writes to stderr — never stdout (that is the MCP transport).
 */
function mcpLog(level, event, data = {}) {
  if (!process.env.NIFTY_MCP_DEBUG) return
  process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), level, event, ...data }) + "\n")
}

function patternToRegExp(pattern) {
  const escaped = String(pattern).replace(/[|\\{}()[\]^$+?.]/g, "\\$&").replace(/\*/g, ".*")
  return new RegExp(`^${escaped}$`)
}

export function isSensitiveNiftyTool(toolName, patterns = MCP_POLICY_GATEWAY_SENSITIVE_TOOL_PATTERNS) {
  return patterns.some((pattern) => patternToRegExp(pattern).test(toolName))
}

export function mcpPolicyGatewayConfig(env = process.env) {
  const mode = String(env.NIFTY_POLICY_GATEWAY_MODE || "shadow").toLowerCase()
  const normalizedMode = mode === "enforce" ? "enforce" : "shadow"
  const timeoutMs = envInteger("NIFTY_POLICY_GATEWAY_TIMEOUT_MS", MCP_POLICY_GATEWAY_DEFAULT_TIMEOUT_MS, env)
  return {
    mode: normalizedMode,
    url: env.NIFTY_POLICY_GATEWAY_URL || "",
    token: env.NIFTY_POLICY_GATEWAY_TOKEN || "",
    timeoutMs,
  }
}

export function buildMcpPolicyGatewayPayload({ toolName, args, context, sessionID, callID } = {}) {
  const idempotencySource = JSON.stringify({
    session_id: sessionID,
    call_id: callID || null,
    tool: toolName,
    args,
    worktree: context?.worktree || context?.directory || null,
  })

  return {
    mode: mcpPolicyGatewayConfig().mode,
    tool: toolName,
    args,
    context: {
      directory: context?.directory || null,
      worktree: context?.worktree || null,
      active_task_id: context?.metadata?.("active_task_id") || null,
      mcp_tool: context?.metadata?.("mcp_tool") || toolName,
    },
    client: {
      name: DEFAULT_SERVER_NAME,
      version: DEFAULT_SERVER_VERSION,
      transport: "mcp",
    },
    session_id: sessionID,
    call_id: callID || null,
    idempotency_key: createHash("sha256").update(idempotencySource).digest("hex"),
  }
}

async function parseGatewayResponse(response) {
  const text = await response.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new Error("Policy gateway returned malformed JSON.")
  }
}

function formatGatewayDenial(toolName, payload = {}) {
  const reason = payload.reason || "request denied"
  const violations = Array.isArray(payload.violations) && payload.violations.length
    ? ` Violations: ${payload.violations.map((violation) => violation.reason || violation.id || String(violation)).join("; ")}`
    : ""
  const audit = payload.audit_id ? ` Audit: ${payload.audit_id}.` : ""
  return `Policy gateway denied ${toolName}: ${reason}.${audit}${violations}`
}

export async function callMcpPolicyGateway({ toolName, args, context, sessionID, callID } = {}, deps = {}) {
  const config = deps.config || mcpPolicyGatewayConfig()
  const fetchFn = deps.fetchFn || globalThis.fetch

  if (!isSensitiveNiftyTool(toolName)) return { action: "bypass", sensitive: false }
  if (!config.url) {
    if (config.mode === "enforce") {
      throw new Error(`Policy gateway is required in enforce mode before executing ${toolName}. Set NIFTY_POLICY_GATEWAY_URL.`)
    }
    return { action: "bypass", sensitive: true, reason: "gateway_not_configured" }
  }
  if (typeof fetchFn !== "function") {
    if (config.mode === "enforce") {
      throw new Error("Policy gateway fetch is unavailable in enforce mode. Run the MCP server on Node 20+ or provide fetch.")
    }
    return { action: "bypass", sensitive: true, reason: "fetch_unavailable" }
  }

  const payload = buildMcpPolicyGatewayPayload({ toolName, args, context, sessionID, callID })
  payload.mode = config.mode

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs)

  try {
    const response = await fetchFn(new URL("/v1/tool-calls", config.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    const gatewayPayload = await parseGatewayResponse(response)
    if (!response.ok) {
      throw new Error(gatewayPayload.reason || `Policy gateway returned HTTP ${response.status}.`)
    }
    if (!["allow", "deny"].includes(gatewayPayload.decision)) {
      throw new Error("Policy gateway response must include decision \"allow\" or \"deny\".")
    }

    if (gatewayPayload.decision === "deny") {
      const denial = formatGatewayDenial(toolName, gatewayPayload)
      if (config.mode === "enforce") throw new Error(denial)
      mcpLog("warn", "policy_gateway_shadow_denied", { tool: toolName, audit_id: gatewayPayload.audit_id, reason: gatewayPayload.reason })
      return { action: "continue", sensitive: true, decision: "deny", payload: gatewayPayload }
    }

    if (config.mode === "enforce") {
      const text = gatewayPayload.result?.text
      if (typeof text !== "string") {
        throw new Error("Policy gateway enforce allow response must include result.text.")
      }
      return { action: "return", sensitive: true, decision: "allow", text, payload: gatewayPayload }
    }

    return { action: "continue", sensitive: true, decision: "allow", payload: gatewayPayload }
  } catch (error) {
    if (config.mode === "enforce") {
      throw new Error(`Policy gateway failed before executing ${toolName}: ${error.message}`)
    }
    mcpLog("warn", "policy_gateway_shadow_failed", { tool: toolName, error: error.message })
    return { action: "continue", sensitive: true, reason: error.message }
  } finally {
    clearTimeout(timeout)
  }
}

export async function loadNiftyTools() {
  const plugin = await loadNiftyPlugin()
  return plugin.tool || {}
}

export async function loadNiftyPlugin() {
  const now = Date.now()
  if (!pluginCache || now - pluginCacheAt > PLUGIN_CACHE_TTL_MS) {
    pluginCache = NiftyPlugin()
    pluginCacheAt = now
    mcpLog("debug", "plugin_cache_refresh", { ttl_ms: PLUGIN_CACHE_TTL_MS })
  }
  return pluginCache
}

export function buildMcpInputSchema(args = {}) {
  const schema = z.object(args)
  const jsonSchema = z.toJSONSchema(schema)
  return {
    type: "object",
    properties: jsonSchema.properties || {},
    required: jsonSchema.required || [],
    additionalProperties: false,
  }
}

export function buildMcpToolCatalog(tools = {}) {
  return Object.entries(tools)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, definition]) => ({
      name,
      description: definition.description || "",
      inputSchema: buildMcpInputSchema(definition.args || {}),
    }))
}

export function createMcpExecutionContext(options = {}) {
  const baseDirectory = options.directory || process.env.NIFTY_WORKTREE || cwd()
  const metadataEntries = normalizeMetadataEntries(options.metadataEntries)

  return {
    abort: options.abortSignal || new AbortController().signal,
    directory: baseDirectory,
    worktree: options.worktree || baseDirectory,
    metadata(key, value) {
      if (arguments.length === 2) {
        metadataEntries.set(key, value)
        return value
      }
      return metadataEntries.get(key)
    },
    ask() {
      throw new Error("Interactive prompts are not supported by the MCP bridge.")
    },
  }
}

function mcpSessionID(context, options = {}) {
  return options.sessionID || context.metadata?.("session") || context.metadata?.("mcp_session") || "nifty-mcp"
}

function envBoolean(name, fallback) {
  const value = process.env[name]
  if (value === undefined || value === "") return fallback
  return !["0", "false", "no", "off"].includes(String(value).toLowerCase())
}

function envInteger(name, fallback, env = process.env) {
  const parsed = Number.parseInt(env[name] ?? "", 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function isNiftyTaskTargetedComment(toolName, args = {}) {
  return toolName === "nifty_create_comment" && typeof args.task_id === "string" && args.task_id.trim().length > 0
}

function pruneMcpActiveTaskEntries(entries = [], options = {}) {
  const now = options.now ?? Date.now()
  const maxAgeMs = options.maxAgeMs ?? envInteger("NIFTY_MCP_ACTIVE_TASK_MAX_AGE_MS", MCP_ACTIVE_TASK_DEFAULT_MAX_AGE_MS)
  const maxEntries = options.maxEntries ?? envInteger("NIFTY_MCP_ACTIVE_TASK_MAX_ENTRIES", MCP_ACTIVE_TASK_DEFAULT_MAX_ENTRIES)

  return entries
    .filter((entry) => {
      const updatedAt = Date.parse(entry.updatedAt || "")
      return Number.isFinite(updatedAt) && now - updatedAt <= maxAgeMs
    })
    .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))
    .slice(0, maxEntries)
}

function mcpActiveTaskStatePath() {
  if (process.env.NIFTY_MCP_ACTIVE_TASK_STATE_PATH) return process.env.NIFTY_MCP_ACTIVE_TASK_STATE_PATH
  const stateRoot = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state")
  return join(stateRoot, "nifty", "mcp-active-task.json")
}

function worktreeKey(context = {}) {
  return context.worktree || context.directory || cwd()
}

function normalizeDirtyFiles(files = []) {
  return [...new Set(files.map((file) => String(file || "").trim()).filter(Boolean))].sort()
}

function dirtySignature(snapshot = {}) {
  const files = normalizeDirtyFiles(snapshot.dirtyFiles)
  if (!files.length) return ""
  return [
    files.join("\n"),
    snapshot.diffDigest || "",
    snapshot.head || "",
  ].join("\n---\n")
}

function hashText(text = "") {
  return createHash("sha256").update(String(text)).digest("hex")
}

function sleepBlocking(ms) {
  if (ms <= 0) return
  try {
    Atomics.wait(mcpActiveTaskLockWaitBuffer, 0, 0, ms)
  } catch {
    const end = Date.now() + ms
    while (Date.now() < end) {
      // Busy wait fallback only when Atomics.wait is unavailable.
    }
  }
}

function parsePorcelainStatus(text = "") {
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      if (line.startsWith("?? ")) return `?? ${line.slice(3)}`
      const code = line.slice(0, 2).trim() || line.split(/\s+/, 1)[0] || "M"
      const path = line[2] === " " ? line.slice(3) : line.replace(/^\S+\s+/, "")
      return `${code} ${path}`
    })
}

async function runGit(worktree, args, options = {}) {
  const result = await execFileAsync("git", ["-C", worktree, ...args], {
    timeout: options.timeout ?? 30000,
    maxBuffer: options.maxBuffer ?? 20 * 1024 * 1024,
  })
  return String(result.stdout || "").trimEnd()
}

export function createMcpProgressState({ taskID, baseline = null } = {}) {
  return {
    taskID: taskID || null,
    baseline,
    lastSnapshot: null,
    reportedChangeSignatures: new Set(),
    reportedPushHeads: new Set(),
    reportedTestSignatures: new Set(),
    interval: null,
    tickPromise: null,
    startedAt: Date.now(),
    lastSeenAt: Date.now(),
  }
}

function parsePorcelainPath(entry = "") {
  const match = String(entry).match(/^[^\s]+\s+(.+)$/)
  return match ? match[1].trim() : null
}

function dirtySnapshotDigest(worktree, dirtyFiles = []) {
  const fingerprint = normalizeDirtyFiles(dirtyFiles)
    .map((entry) => {
      const relativePath = parsePorcelainPath(entry)
      if (!relativePath) return `${entry}|missing`
      try {
        const metadata = statSync(join(worktree, relativePath))
        return `${entry}|${metadata.size}|${Math.trunc(metadata.mtimeMs)}`
      } catch {
        return `${entry}|missing`
      }
    })
    .join("\n")

  return hashText(fingerprint)
}

export function mcpProgressConfig() {
  return {
    enabled: envBoolean("NIFTY_MCP_PROGRESS_POLL_ENABLED", true),
    intervalMs: envInteger("NIFTY_MCP_PROGRESS_POLL_INTERVAL_MS", MCP_PROGRESS_DEFAULT_INTERVAL_MS),
    idleTtlMs: envInteger("NIFTY_MCP_PROGRESS_IDLE_TTL_MS", MCP_PROGRESS_DEFAULT_IDLE_TTL_MS),
    testCommand: process.env.NIFTY_MCP_PROGRESS_TEST_COMMAND || "",
    testTimeoutMs: envInteger("NIFTY_MCP_PROGRESS_TEST_TIMEOUT_MS", MCP_PROGRESS_DEFAULT_TEST_TIMEOUT_MS),
  }
}

export async function readGitWorktreeSnapshot(worktree, deps = {}) {
  const git = deps.runGit || runGit
  try {
    const [statusText, head, branch, aheadText] = await Promise.all([
      git(worktree, ["status", "--porcelain=v1"]),
      git(worktree, ["rev-parse", "HEAD"]).catch(() => ""),
      git(worktree, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => ""),
      git(worktree, ["rev-list", "--count", "@{u}..HEAD"]).catch(() => ""),
    ])
    const dirtyFiles = parsePorcelainStatus(statusText)
    const diffDigest = dirtyFiles.length ? dirtySnapshotDigest(worktree, dirtyFiles) : ""
    const parsedAhead = Number.parseInt(aheadText, 10)

    return {
      worktree,
      head: head || null,
      branch: branch || null,
      aheadCount: Number.isFinite(parsedAhead) ? parsedAhead : null,
      dirtyFiles,
      diffDigest,
      gitAvailable: true,
    }
  } catch (error) {
    return {
      worktree,
      head: null,
      branch: null,
      aheadCount: null,
      dirtyFiles: [],
      diffDigest: "",
      gitAvailable: false,
      error: error.message,
    }
  }
}

export function detectMcpWorktreeProgress(state, snapshot = {}) {
  const events = []
  const currentSignature = dirtySignature(snapshot)

  if (!state.baseline) {
    state.baseline = snapshot
    state.lastSnapshot = snapshot
    if (currentSignature && !state.reportedChangeSignatures.has(currentSignature)) {
      events.push({ type: "worktree_changed", snapshot, signature: currentSignature })
      state.reportedChangeSignatures.add(currentSignature)
    }
    return events
  }

  const baselineSignature = dirtySignature(state.baseline)
  if (currentSignature && currentSignature !== baselineSignature && !state.reportedChangeSignatures.has(currentSignature)) {
    events.push({ type: "worktree_changed", snapshot, signature: currentSignature })
    state.reportedChangeSignatures.add(currentSignature)
  }

  const previousAhead = state.lastSnapshot?.aheadCount
  if (
    previousAhead !== null
    && previousAhead !== undefined
    && previousAhead > 0
    && snapshot.aheadCount === 0
    && snapshot.head
    && !state.reportedPushHeads.has(snapshot.head)
  ) {
    events.push({ type: "push", snapshot, signature: snapshot.head })
    state.reportedPushHeads.add(snapshot.head)
  }

  state.lastSnapshot = snapshot
  return events
}

export function buildMcpProgressComment(event = {}, taskID = "") {
  const snapshot = event.snapshot || {}
  if (event.type === "push") {
    return [
      "## What was done",
      "MCP autonomous progress update detected repository sync.",
      "- Local commits are no longer ahead of the upstream branch.",
      "",
      "## Evidence / Tests",
      `- Task: ${taskID}`,
      snapshot.branch ? `- Branch: ${snapshot.branch}` : null,
      snapshot.head ? `- HEAD: ${snapshot.head}` : null,
      "",
      "## How to verify",
      "- Confirm the remote branch contains the local commits for this task.",
    ].filter(Boolean).join("\n")
  }

  return ""
}

async function postMcpProgressComment(plugin, taskID, text, context) {
  const createComment = plugin?.tool?.nifty_create_comment
  if (!createComment || typeof createComment.execute !== "function") return false
  await createComment.execute({ task_id: taskID, text }, context)
  return true
}

function shouldPostMcpProgressComment(event = {}) {
  return event.type === "push"
}

async function runOptionalMcpProgressTest(plugin, taskID, event, context, state, config) {
  if (!config.testCommand || event.type !== "worktree_changed") return
  if (state.reportedTestSignatures.has(event.signature)) return
  const worktree = context.worktree || context.directory || cwd()
  try {
    const result = await execAsync(config.testCommand, {
      cwd: worktree,
      timeout: config.testTimeoutMs,
      maxBuffer: 1024 * 1024,
    })
    state.reportedTestSignatures.add(event.signature)
    await postMcpProgressComment(
      plugin,
      taskID,
      [
        "## What was done",
        "MCP autonomous progress update detected a passing verification command.",
        "- Verification command completed successfully.",
        "",
        "## Evidence / Tests",
        `- Task: ${taskID}`,
        `- Command: ${config.testCommand}`,
        result.stdout?.trim() ? "- Output:" : null,
        result.stdout?.trim()?.slice(0, 1000) || null,
        "",
        "## How to verify",
        "- Re-run the listed command from the same worktree.",
      ].filter(Boolean).join("\n"),
      context,
    )
  } catch (error) {
    mcpLog("debug", "mcp_progress_test_probe_failed", { task_id: taskID, command: config.testCommand, error: error.message })
  }
}

export async function tickMcpProgressObserver({ plugin, taskID, context, state, readSnapshot, config } = {}) {
  if (!plugin || !taskID || !context || !state) return []
  const progressConfig = config || mcpProgressConfig()
  if (!progressConfig.enabled) return []
  if (state.tickPromise) return state.tickPromise

  state.tickPromise = (async () => {
    const worktree = context.worktree || context.directory || cwd()
    const snapshot = await (readSnapshot ? readSnapshot(worktree) : readGitWorktreeSnapshot(worktree))
    const events = detectMcpWorktreeProgress(state, snapshot)

    for (const event of events) {
      if (shouldPostMcpProgressComment(event)) {
        await postMcpProgressComment(plugin, taskID, buildMcpProgressComment(event, taskID), context)
      }
      await runOptionalMcpProgressTest(plugin, taskID, event, context, state, progressConfig)
    }

    return events
  })()

  try {
    return await state.tickPromise
  } finally {
    state.tickPromise = null
  }
}

export function extractMcpTaskID(toolName, args = {}, outputText = "", context = {}) {
  if (!toolName.startsWith("nifty_")) return null
  let parsed = null
  try {
    parsed = JSON.parse(outputText)
  } catch {
    // Plain-text tool output; fall back to explicit args below.
  }

  if (parsed?.task?.id) return parsed.task.id
  if (parsed?.task_id) return parsed.task_id
  if (parsed?.task?.task_id) return parsed.task.task_id

  const explicitTaskID = args.task_id || args.parent_task_id || args.taskID || context.metadata?.("active_task_id") || null
  if (explicitTaskID) return explicitTaskID

  if (MCP_TASK_OUTPUT_ID_TOOLS.has(toolName)) {
    return parsed?.id || parsed?.response?.id || null
  }

  return null
}

function progressStateKey(sessionID, taskID, context) {
  const worktree = context.worktree || context.directory || cwd()
  return `${sessionID}:${taskID}:${worktree}`
}

function progressSessionKey(sessionID, context) {
  const worktree = context.worktree || context.directory || cwd()
  return `${sessionID}:${worktree}`
}

function stopMcpProgressState(state) {
  if (!state?.interval) return
  clearInterval(state.interval)
  state.interval = null
}

export function activateMcpProgressState(states, activeKeys, { sessionID, taskID, context } = {}) {
  if (!sessionID || !taskID || !context) {
    throw new Error("sessionID, taskID, and context are required to activate MCP progress state.")
  }

  const key = progressStateKey(sessionID, taskID, context)
  const activeKey = progressSessionKey(sessionID, context)
  const previousKey = activeKeys.get(activeKey)
  if (previousKey && previousKey !== key) {
    stopMcpProgressState(states.get(previousKey))
    states.delete(previousKey)
  }

  let state = states.get(key)
  if (!state) {
    state = createMcpProgressState({ taskID })
    states.set(key, state)
  }
  activeKeys.set(activeKey, key)

  return { key, activeKey, state }
}

function readMcpActiveTaskStore(filePath = mcpActiveTaskStatePath()) {
  if (!existsSync(filePath)) return { version: MCP_ACTIVE_TASK_STATE_VERSION, entries: [] }
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"))
    return {
      version: parsed.version || MCP_ACTIVE_TASK_STATE_VERSION,
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    }
  } catch {
    return { version: MCP_ACTIVE_TASK_STATE_VERSION, entries: [] }
  }
}

function writeMcpActiveTaskStore(store, filePath = mcpActiveTaskStatePath()) {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`, "utf8")
}

function mcpActiveTaskLockPath(filePath = mcpActiveTaskStatePath()) {
  return `${filePath}.lock`
}

function withMcpActiveTaskStoreLock(filePath, callback) {
  mkdirSync(dirname(filePath), { recursive: true })
  const lockPath = mcpActiveTaskLockPath(filePath)
  const deadline = Date.now() + MCP_ACTIVE_TASK_LOCK_TIMEOUT_MS

  while (true) {
    try {
      mkdirSync(lockPath)
      break
    } catch (error) {
      if (error?.code !== "EEXIST") throw error

      try {
        const ageMs = Date.now() - statSync(lockPath).mtimeMs
        if (ageMs > MCP_ACTIVE_TASK_LOCK_STALE_MS) {
          rmSync(lockPath, { recursive: true, force: true })
          continue
        }
      } catch {
        // If lock inspection fails, continue waiting until timeout.
      }

      if (Date.now() >= deadline) {
        throw new Error(`Timed out acquiring MCP active-task store lock: ${filePath}`)
      }
      sleepBlocking(MCP_ACTIVE_TASK_LOCK_WAIT_MS)
    }
  }

  try {
    return callback()
  } finally {
    rmSync(lockPath, { recursive: true, force: true })
  }
}

export function persistMcpActiveTask({ sessionID, taskID, context, filePath } = {}) {
  if (!sessionID || !taskID || !context) return false
  const resolvedFilePath = filePath || mcpActiveTaskStatePath()

  return withMcpActiveTaskStoreLock(resolvedFilePath, () => {
    const store = readMcpActiveTaskStore(resolvedFilePath)
    const worktree = worktreeKey(context)
    const entries = pruneMcpActiveTaskEntries(store.entries)
      .filter((entry) => !(entry.sessionID === sessionID && entry.worktree === worktree))
    entries.push({ sessionID, worktree, taskID, updatedAt: new Date().toISOString() })
    writeMcpActiveTaskStore({ version: MCP_ACTIVE_TASK_STATE_VERSION, entries }, resolvedFilePath)
    return true
  })
}

export function loadMcpActiveTaskForContext({ sessionID, context, filePath } = {}) {
  const envTaskID = process.env.NIFTY_MCP_ACTIVE_TASK_ID || process.env.NIFTY_AUTOMATION_ACTIVE_TASK_ID
  if (envTaskID) return envTaskID
  if (!sessionID || !context) return null
  const worktree = worktreeKey(context)
  const store = readMcpActiveTaskStore(filePath)
  const matches = store.entries
    .filter((entry) => entry.sessionID === sessionID && entry.worktree === worktree && entry.taskID)
    .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))
  return matches[0]?.taskID || null
}

async function startMcpProgressObserver({ plugin, taskID, context, options = {}, config = mcpProgressConfig() } = {}) {
  if (!plugin || !taskID || !context || !config.enabled) return null
  const sessionID = mcpSessionID(context, options)
  const { key, activeKey, state } = activateMcpProgressState(mcpProgressStates, mcpActiveProgressKeys, { sessionID, taskID, context })
  state.lastSeenAt = Date.now()
  const startupEvents = await tickMcpProgressObserver({ plugin, taskID, context, state, config })

  const startupSnapshot = state.lastSnapshot || {}
  const startupFiles = normalizeDirtyFiles(startupSnapshot.dirtyFiles)
  const startupDecision = startupFiles.length ? "dirty" : "clean"
  const startupCatchupPosted = startupEvents.some((event) => event.type === "worktree_changed")
  mcpLog("info", "mcp_progress_startup", {
    session_id: sessionID,
    task_id: taskID,
    worktree: worktreeKey(context),
    branch: startupSnapshot.branch || null,
    head: startupSnapshot.head || null,
    baseline: startupDecision,
    dirty_files: startupFiles.length,
    catchup_posted: startupCatchupPosted,
  })

  if (!state.interval) {
    state.interval = setInterval(async () => {
      if (Date.now() - state.lastSeenAt > config.idleTtlMs) {
        clearInterval(state.interval)
        state.interval = null
        mcpProgressStates.delete(key)
        if (mcpActiveProgressKeys.get(activeKey) === key) mcpActiveProgressKeys.delete(activeKey)
        return
      }
      try {
        await tickMcpProgressObserver({ plugin, taskID, context, state, config })
      } catch (error) {
        mcpLog("debug", "mcp_progress_tick_failed", { task_id: taskID, error: error.message })
      }
    }, config.intervalMs)
    state.interval.unref?.()
  }

  return state
}

async function observeMcpProgress(plugin, toolName, args, outputText, context, options = {}) {
  const config = mcpProgressConfig()
  if (!config.enabled) return
  const taskID = extractMcpTaskID(toolName, args, outputText, context)
  if (!taskID) return

  context.metadata?.("active_task_id", taskID)
  const sessionID = mcpSessionID(context, options)
  persistMcpActiveTask({ sessionID, taskID, context })
  await startMcpProgressObserver({ plugin, taskID, context, options, config })
}

export async function runNiftyTool(pluginOrTools, toolName, rawArgs = {}, context = createMcpExecutionContext(), options = {}) {
  const plugin = pluginOrTools?.tool ? pluginOrTools : options.plugin
  const tools = plugin?.tool || pluginOrTools
  const definition = tools?.[toolName]
  if (!definition) {
    throw new Error(`Unknown Nifty tool: ${toolName}`)
  }

  ensureTool(toolName, definition)
  const args = validateToolArgs(toolName, definition, rawArgs)
  if (isNiftyTaskTargetedComment(toolName, args)) {
    validateNiftyTaskCommentTemplate({ task_id: args.task_id, text: args.text })
  }
  const sessionID = mcpSessionID(context, options)
  const callID = options.callID
  const hookInput = {
    tool: toolName,
    sessionID,
    callID,
    args,
    context,
  }

  const gatewayResult = await callMcpPolicyGateway({ toolName, args, context, sessionID, callID })
  if (gatewayResult.action === "return") {
    const text = gatewayResult.text
    await plugin?.["tool.execute.after"]?.(hookInput, {
      title: toolName,
      output: text,
      metadata: {
        policy_gateway: gatewayResult.payload || {},
      },
      context,
    })
    await observeMcpProgress(plugin, toolName, args, text, context, options)
    return text
  }

  await plugin?.["tool.execute.before"]?.(hookInput, { args, context })
  const output = await definition.execute(args, context)
  const text = stringifyToolOutput(output)
  await plugin?.["tool.execute.after"]?.(hookInput, {
    title: toolName,
    output: text,
    metadata: {},
    context,
  })
  await observeMcpProgress(plugin, toolName, args, text, context, options)
  return text
}

export async function createNiftyMcpServer(options = {}) {
  const serverName = options.serverName || DEFAULT_SERVER_NAME
  const serverVersion = options.serverVersion || DEFAULT_SERVER_VERSION
  const plugin = await loadNiftyPlugin()
  const tools = plugin.tool || {}
  const server = new McpServer({ name: serverName, version: serverVersion })
  const startupContext = createMcpExecutionContext({
    directory: options.directory,
    worktree: options.worktree,
    metadataEntries: {
      ...(options.metadataEntries || {}),
      mcp_tool: "mcp_startup",
    },
  })
  const startupTaskID = loadMcpActiveTaskForContext({
    sessionID: options.sessionID || mcpSessionID(startupContext, options),
    context: startupContext,
  })

  if (startupTaskID) {
    startMcpProgressObserver({
      plugin,
      taskID: startupTaskID,
      context: startupContext,
      options,
    }).catch((error) => {
      mcpLog("debug", "mcp_progress_startup_failed", { task_id: startupTaskID, error: error.message })
    })
  }

  for (const [name, definition] of Object.entries(tools)) {
    ensureTool(name, definition)
    const description = definition.description || ""
    const argsShape = definition.args || {}

    server.tool(name, description, argsShape, async (args, extra = {}) => {
      const context = createMcpExecutionContext({
        directory: options.directory,
        worktree: options.worktree,
        abortSignal: extra.signal,
        metadataEntries: {
          ...(options.metadataEntries || {}),
          mcp_tool: name,
        },
      })

      const output = await runNiftyTool(plugin, name, args, context, {
        sessionID: options.sessionID,
      })
      return {
        content: [{ type: "text", text: output }],
      }
    })
  }

  // ── Resources ────────────────────────────────────────────────────────────

  server.resource(
    "nifty-policy",
    "nifty://policy",
    { description: "Current Nifty AI governance policy rules", mimeType: "application/json" },
    async (_uri) => {
      const policyPath = process.env.NIFTY_POLICY_PATH
      let text = "{}"
      if (policyPath) {
        try { text = readFileSync(policyPath, "utf8") } catch { /* path configured but missing */ }
      } else {
        const defaultPath = new URL("../policy/nifty-ai-policy.json", import.meta.url)
        try { text = readFileSync(defaultPath, "utf8") } catch { /* not present */ }
      }
      return { contents: [{ uri: "nifty://policy", text, mimeType: "application/json" }] }
    },
  )

  server.resource(
    "nifty-workflow-config",
    "nifty://workflow-config",
    { description: "Project workflow aliases mapping Nifty statuses and lists", mimeType: "application/json" },
    async (_uri) => {
      const worktree = options.worktree || process.env.NIFTY_WORKTREE || cwd()
      let text = "{}"
      try { text = readFileSync(join(worktree, "nifty-workflows.json"), "utf8") } catch { /* not created yet */ }
      return { contents: [{ uri: "nifty://workflow-config", text, mimeType: "application/json" }] }
    },
  )

  // ── Prompts ───────────────────────────────────────────────────────────────

  server.prompt(
    "nifty_task_start",
    "Load full context and propose an implementation plan for a Nifty task",
    z.object({ task_id: z.string().describe("Nifty task ID, e.g. MBC-42") }),
    ({ task_id }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: [
            `I am starting work on Nifty task ${task_id}.`,
            "Call nifty_get_task_full_context to load the task details, comments, subtasks, and project context.",
            "Then summarize the acceptance criteria and propose the smallest viable implementation plan.",
            "Do not write any code until the plan is confirmed.",
          ].join(" "),
        },
      }],
    }),
  )

  server.prompt(
    "nifty_delivery_gate",
    "Prepare a Nifty task for Dev Review — assemble delivery evidence and gate check",
    z.object({
      task_id: z.string().describe("Nifty task ID, e.g. MBC-42"),
      visual_changes: z.boolean().optional().describe("True if any UI/CSS/frontend files were changed"),
    }),
    ({ task_id, visual_changes }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: [
            `I want to move Nifty task ${task_id} to Dev Review.`,
            "Call nifty_prepare_task_for_delivery with task_id and delivery_evidence containing red_proof, green_proof, and sad_path_proof.",
            visual_changes ? "Include visual_proof with screenshot or video URLs — this is required because UI files were changed." : "",
            "Verify all gate requirements before submitting. Hard-fail if any evidence is missing.",
          ].filter(Boolean).join(" "),
        },
      }],
    }),
  )

  return server
}

export async function startNiftyMcpServer(options = {}) {
  assertMcpRuntime()
  const server = await createNiftyMcpServer(options)
  const transport = new StdioServerTransport()

  function shutdown(signal) {
    mcpLog("info", "shutdown", { signal })
    transport.close().catch(() => {}).finally(() => process.exit(0))
  }

  process.once("SIGTERM", () => shutdown("SIGTERM"))
  process.once("SIGINT", () => shutdown("SIGINT"))

  await server.connect(transport)
  mcpLog("info", "server_started", { name: options.serverName || DEFAULT_SERVER_NAME, version: DEFAULT_SERVER_VERSION })
  return { server, transport }
}

function isMainModule() {
  if (!process.argv[1]) return false
  return resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
}

if (isMainModule()) {
  startNiftyMcpServer().catch((error) => {
    const message = error instanceof Error ? error.stack || error.message : String(error)
    process.stderr.write(`Nifty MCP server failed: ${message}\n`)
    process.exit(1)
  })
}

// Backward-compatible aliases (kept for any external code referencing the old names)
export const createCopilotExecutionContext = createMcpExecutionContext
export const createCopilotMcpServer = createNiftyMcpServer
export const startCopilotMcpServer = startNiftyMcpServer
