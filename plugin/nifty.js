import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, statSync } from "node:fs"
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import { spawn, spawnSync } from "node:child_process"
import { createServer } from "node:http"
import { randomBytes } from "node:crypto"
import { fileURLToPath } from "node:url"
import { tool } from "@opencode-ai/plugin"

const API_BASE_URL = "https://openapi.niftypm.com"
const NIFTY_REPO_RAW_BASE = "https://raw.githubusercontent.com/CaveIM/opencode-nifty"
const TOKEN_PATH = process.env.NIFTY_TOKEN_PATH || join(homedir(), ".config", "opencode", "nifty-auth.json")
const AUTH_LOG_PATH = process.env.NIFTY_AUTH_LOG_PATH || join(homedir(), ".config", "opencode", "nifty-auth-server.log")
const DEFAULT_AUTH_NODE_BINARY = process.execPath
const TOKEN_SKEW_MS = 60 * 1000
const LEGACY_BOT_COMMENT_PREFIX = "🤖"
const LEGACY_MCP_COMMENT_PREFIX = "[MCP Automation]"
const BOT_COMMENT_PREFIX = "🤖 McBotFace"
const NIFTY_SHELL_COMMAND_HINT = [
  "Nifty is installed as OpenCode plugin tools, not as a shell command.",
  "Use the OpenCode tool `nifty_health_check` for health checks.",
  "For setup, use `nifty_recommended_workflow` or `nifty_setup_recommended_workflow`.",
].join(" ")
const LIFECYCLE_DEFAULT_IN_PROGRESS_KEY = "in_progress"
const LIFECYCLE_DEFAULT_DEV_REVIEW_KEY = "dev_review"
const AUTOCONTEXT_DEFAULT_COMMENT_LIMIT = 200
const AUTOCONTEXT_DEFAULT_TASK_LIMIT = 200
const AUTOMATION_DEFAULT_EDIT_TOOLS = ["apply_patch", "write", "edit", "patch"]
const AUTOMATION_DEFAULT_TEST_COMMAND_PATTERNS = [
  "npm test",
  "pnpm test",
  "yarn test",
  "node --test",
  "vitest",
  "jest",
  "playwright test",
]
const AUTOMATION_DEFAULT_PUSH_COMMAND_PATTERNS = ["git push"]
const AUTOMATION_DEFAULT_TASK_CONTEXT_PROMPT = "I lost context of the active task card for autonomous updates. Enter the task card ID you are working on (for example: MBC-462 or an internal task id)."
const LIFECYCLE_AUTO_START_TOOLS = new Set([
  "nifty_get_task",
  "nifty_update_task",
  "nifty_update_task_custom_fields",
  "nifty_update_task_assignees",
  "nifty_prepare_task_for_delivery",
  "nifty_create_comment",
])
const LIFECYCLE_AUTO_START_EXCLUDED_TOOLS = new Set([
  "nifty_move_task_to_status",
  "nifty_complete_task",
  "nifty_archive_task",
  "nifty_delete_task",
  "nifty_delete_tasks",
])

// ─────────────────────────────────────────────────────────────────────────────
// Mandatory context bootstrap: tools that write, move, delete, or archive
// MUST have had their primary entity (task or project) fully resolved before
// the call is allowed to proceed. Read-only and discovery tools are exempt.
// ─────────────────────────────────────────────────────────────────────────────
const BOOTSTRAP_MUTATING_TASK_TOOLS = new Set([
  "nifty_update_task",
  "nifty_update_task_custom_fields",
  "nifty_update_task_assignees",
  "nifty_move_task_to_status",
  "nifty_complete_task",
  "nifty_archive_task",
  "nifty_delete_task",
  "nifty_prepare_task_for_delivery",
  "nifty_create_comment",
])

const BOOTSTRAP_MUTATING_PROJECT_TOOLS = new Set([
  "nifty_create_task",
  "nifty_delete_tasks",
  "nifty_create_status",
  "nifty_update_status",
  "nifty_delete_status",
  "nifty_create_milestone",
  "nifty_update_milestone",
  "nifty_delete_milestone",
  "nifty_create_doc",
  "nifty_update_doc",
  "nifty_delete_doc",
])

/** Extract task_id from a tool's args using the canonical arg key. */
function extractBootstrapTaskID(args) {
  return args?.task_id || args?.id || null
}

/** Extract project_id from a tool's args using the canonical arg key. */
function extractBootstrapProjectID(args) {
  return args?.project_id || null
}

/**
 * Throws a hard-fail BootstrapError if the mutating tool's entity has not been
 * bootstrapped in policyState. This gate is NOT best-effort — it must propagate.
 *
 * @param {string} toolName
 * @param {object} args
 * @param {object} policyState - { bootstrappedTasks: Set, bootstrappedProjects: Set }
 * @param {object} context - execution context used to read env flags
 */
function assertContextBootstrapped(toolName, args, policyState, context) {
  if (!envBoolean("NIFTY_BOOTSTRAP_REQUIRED", true, context)) return

  // An external bootstrapState on context (test or multi-session callers) is used
  // alongside the session-level policyState. Either one having the ID is sufficient.
  const externalBootstrap = context?.bootstrapState

  if (BOOTSTRAP_MUTATING_TASK_TOOLS.has(toolName)) {
    const taskID = extractBootstrapTaskID(args)
    if (!taskID) {
      // No task_id means we can't check — fall through and let the API validate
      return
    }
    const isBootstrapped =
      policyState.bootstrappedTasks?.has(taskID) ||
      externalBootstrap?.resolvedTasks?.has(taskID) ||
      externalBootstrap?.bootstrappedTasks?.has(taskID)
    if (!isBootstrapped) {
      throw Object.assign(
        new Error(
          `[BootstrapGate] bootstrap context required: call nifty_get_task_full_context({ task_id: "${taskID}" }) before attempting mutation with '${toolName}'.`,
        ),
        { code: "NIFTY_BOOTSTRAP_REQUIRED", taskID, toolName },
      )
    }
  }

  if (BOOTSTRAP_MUTATING_PROJECT_TOOLS.has(toolName)) {
    const projectID = extractBootstrapProjectID(args)
    if (!projectID) return
    const isBootstrapped =
      policyState.bootstrappedProjects?.has(projectID) ||
      externalBootstrap?.resolvedProjects?.has(projectID) ||
      externalBootstrap?.bootstrappedProjects?.has(projectID)
    if (!isBootstrapped) {
      throw Object.assign(
        new Error(
          `[BootstrapGate] bootstrap context required: call nifty_get_project_full_context with project_id "${projectID}" before attempting mutation with '${toolName}'.`,
        ),
        { code: "NIFTY_BOOTSTRAP_REQUIRED", projectID, toolName },
      )
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Central Policy-as-Code Engine
//
// Policy document schema (JSON):
//   {
//     "version": 1,                      // schema version
//     "effective_date": "2026-06-01",
//     "description": "...",
//     "default_effect": "allow" | "deny",
//     "rules": [
//       {
//         "id": "rule-001",              // optional stable identifier
//         "action": "nifty_delete_*",   // exact name or glob (* and ** supported)
//         "effect": "allow" | "deny",
//         "condition": {                 // optional — arg-level guard
//           "arg": "task_ids",          // args key to inspect
//           "op": "count_gt",           // operator: count_gt | count_lte | eq | neq | exists | absent
//           "value": 5
//         },
//         "reason": "Human-readable explanation."
//       }
//     ]
//   }
//
// Evaluation: deny overrides allow. Specificity does NOT matter — first deny wins.
// default_effect is used when zero rules match.
// ─────────────────────────────────────────────────────────────────────────────

/** Test whether an action name matches a rule action pattern (glob: * = word, ** = any). */
function matchesActionPattern(pattern, action) {
  if (pattern === "*" || pattern === "**") return true
  if (!pattern.includes("*")) return pattern === action
  // Convert glob to regex: * matches any non-dot chars within a segment
  const re = new RegExp("^" + pattern.replace(/\*\*/g, ".+").replace(/\*/g, "[^.]+") + "$")
  return re.test(action)
}

/** Evaluate a single rule condition against the provided args object. */
function evaluateCondition(condition, args) {
  if (!condition) return true
  const { arg, op, value } = condition
  const argValue = args?.[arg]
  switch (op) {
    case "count_gt": return Array.isArray(argValue) ? argValue.length > value : false
    case "count_lte": return Array.isArray(argValue) ? argValue.length <= value : true
    case "eq": return argValue === value
    case "neq": return argValue !== value
    case "exists": return argValue !== undefined && argValue !== null
    case "absent": return argValue === undefined || argValue === null
    default: return true
  }
}

/**
 * Evaluate a policy document against a tool invocation.
 *
 * @param {string} toolName
 * @param {object} args - tool arguments
 * @param {object} policy - policy document (JSON-parsed)
 * @param {{ auditLog?: Array }} [options]
 * @returns {{ allowed: boolean, matched_rules: Array, reason?: string }}
 */
function evaluatePolicy(toolName, args, policy, options = {}) {
  const { auditLog } = options
  const defaultEffect = policy?.default_effect ?? "allow"
  const rules = Array.isArray(policy?.rules) ? policy.rules : []

  const matchedRules = []
  let denyReason = null
  let hasExplicitAllow = false

  for (const rule of rules) {
    if (!matchesActionPattern(rule.action, toolName)) continue
    if (!evaluateCondition(rule.condition, args)) continue

    matchedRules.push(rule)
    if (rule.effect === "deny") {
      denyReason = rule.reason || `Denied by policy rule${rule.id ? ` '${rule.id}'` : ""}.`
    } else if (rule.effect === "allow") {
      hasExplicitAllow = true
    }
  }

  // Deny overrides allow — any matched deny rule blocks the call
  const allowed = denyReason !== null ? false : (matchedRules.length === 0 ? defaultEffect === "allow" : hasExplicitAllow || defaultEffect === "allow")

  const entry = {
    timestamp: new Date().toISOString(),
    tool: toolName,
    allowed,
    matched_rules: matchedRules.map((r) => r.id || r.action).filter(Boolean),
    ...(denyReason ? { reason: denyReason } : {}),
  }

  if (Array.isArray(auditLog)) auditLog.push(entry)

  return { allowed, matched_rules: matchedRules, ...(denyReason ? { reason: denyReason } : {}) }
}

/** Load a policy document from env or from a local path. Returns null if disabled. */
function loadPolicy(context) {
  // Inline JSON takes precedence (primarily for tests and CI)
  const inline = process.env.NIFTY_POLICY_INLINE
  if (inline) {
    try {
      return JSON.parse(inline)
    } catch {
      throw new Error("[PolicyGate] NIFTY_POLICY_INLINE contains invalid JSON.")
    }
  }

  const policyPath = process.env.NIFTY_POLICY_PATH
  if (policyPath && policyPath !== "/dev/null" && existsSync(policyPath)) {
    try {
      return JSON.parse(readFileSync(policyPath, "utf8"))
    } catch (err) {
      throw new Error(`[PolicyGate] Failed to parse policy at ${policyPath}: ${err.message}`)
    }
  }

  return null // Policy enforcement is optional when neither source is configured
}

/**
 * Enforce the central policy at a tool-call boundary.
 * Throws a hard PolicyViolationError on deny.
 *
 * @param {string} toolName
 * @param {object} args
 * @param {object} policyState - shared state (includes auditLog array)
 * @param {object} context
 */
function enforcePolicyGate(toolName, args, policyState, context) {
  const policy = policyState.loadedPolicy
  if (!policy) return // No policy configured — pass through

  const result = evaluatePolicy(toolName, args, policy, { auditLog: policyState.auditLog })
  if (!result.allowed) {
    throw Object.assign(
      new Error(`[PolicyGate] Tool '${toolName}' denied: ${result.reason}`),
      { code: "NIFTY_POLICY_VIOLATION", toolName, policy_reason: result.reason },
    )
  }
}

const RECOMMENDED_WORKFLOW = {
  statuses: [
    { key: "ideas", name: "Ideas", order: 100, color: "#9E9E9E" },
    { key: "shaping", name: "Shaping", order: 200, color: "#7E57C2" },
    { key: "shaped", name: "Shaped", order: 300, color: "#42A5F5" },
    { key: "planned", name: "Planned", order: 400, color: "#26A69A" },
    { key: "not_now", name: "Not Now", order: 450, color: "#78909C" },
    { key: "todo", name: "To Do", order: 500, color: "#26A69A" },
    { key: "in_progress", name: "In Progress", order: 600, color: "#FFA726" },
    { key: "dev_review", name: "Dev Review", order: 700, color: "#FF7043" },
    { key: "ready_for_staging", name: "Ready for Staging", order: 800, color: "#AB47BC" },
    { key: "in_staging", name: "In Staging", order: 900, color: "#5C6BC0" },
    { key: "ready_for_prod", name: "Ready for Prod", order: 1000, color: "#66BB6A" },
    { key: "released", name: "Released in Prod", order: 1100, color: "#29B6F6" },
    { key: "done", name: "Done", order: 1200, color: "#8BC34A" },
    { key: "blocked", name: "Blocked", order: 1300, color: "#EF5350" },
  ],
  lists: [
    { key: "ui", name: "UI" },
    { key: "api", name: "API" },
    { key: "infrastructure", name: "Infrastructure" },
    { key: "auth", name: "Auth" },
    { key: "billing", name: "Billing" },
    { key: "content", name: "Content" },
    { key: "docs", name: "Docs" },
    { key: "data", name: "Data/Migrations" },
    { key: "devops", name: "DevOps" },
  ],
}

function recommendedWorkflowConfig(alias, projectSelector = {}, options = {}) {
  return {
    workflows: {
      [alias]: {
        project: projectSelector,
        states: Object.fromEntries(
          RECOMMENDED_WORKFLOW.statuses.map((status) => [status.key, status.name]),
        ),
        lists: Object.fromEntries(
          RECOMMENDED_WORKFLOW.lists.map((list) => [list.key, list.name]),
        ),
        ...(options.milestones?.length
          ? {
              milestones: Object.fromEntries(
                options.milestones.map((name) => [normalize(name).replaceAll(" ", "_"), name]),
              ),
            }
          : {}),
      },
    },
  }
}

function workflowAlias(alias, project = {}) {
  const fallback = normalize(project.nice_id || project.name || project.id || "default").replaceAll(" ", "_")
  return alias || defaultWorkflowAlias() || fallback || "default"
}

function projectConfigSelector(project = {}) {
  if (project.nice_id) return { nice_id: project.nice_id }
  if (project.name) return { name: project.name }
  return { id: project.id }
}

function recommendedWorkflowSummary() {
  return {
    principle: "Use statuses for lifecycle, lists for stable app areas, and milestones for release/sprint/timebox goals.",
    statuses: RECOMMENDED_WORKFLOW.statuses,
    lists: RECOMMENDED_WORKFLOW.lists,
    milestone_examples: ["MVP Launch", "v1.0 Release", "May Sprint 2", "Production Cutover"],
  }
}

function parseEnvFile(content) {
  const values = {}
  for (const rawLine of String(content || "").split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#") || !line.includes("=")) continue
    const index = line.indexOf("=")
    const key = line.slice(0, index).trim()
    let value = line.slice(index + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  return values
}

function envFileValues(context = {}) {
  const candidates = [context.directory, context.worktree, process.cwd()]
    .filter(Boolean)
    .map((directory) => join(directory, ".nifty.env"))
  for (const path of [...new Set(candidates)]) {
    if (!existsSync(path)) continue
    try {
      return parseEnvFile(readFileSync(path, "utf8"))
    } catch {
      return {}
    }
  }
  return {}
}

function env(name, context = {}) {
  const fileValue = envFileValues(context)[name]
  if (typeof fileValue === "string" && fileValue.trim()) return fileValue.trim()
  const value = process.env[name]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function envList(name, fallback = [], context = {}) {
  const value = env(name, context)
  if (!value) return fallback
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function getClientConfig(context = {}) {
  return {
    clientID: env("NIFTY_CLIENT_ID", context),
    clientSecret: env("NIFTY_CLIENT_SECRET", context),
    redirectURI: env("NIFTY_REDIRECT_URI", context),
    authorizeURL: env("NIFTY_AUTHORIZE_URL", context),
    accessToken: env("NIFTY_ACCESS_TOKEN", context),
    refreshToken: env("NIFTY_REFRESH_TOKEN", context),
  }
}

function defaultWorkflowAlias(context = {}) {
  return env("NIFTY_DEFAULT_WORKFLOW", context)
}

async function readTokenCache() {
  try {
    const raw = await readFile(TOKEN_PATH, "utf8")
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

async function writeTokenCache(token) {
  const tokenDir = dirname(TOKEN_PATH)
  await mkdir(tokenDir, { recursive: true, mode: 0o700 })
  await chmod(tokenDir, 0o700).catch(() => {})
  await writeFile(TOKEN_PATH, `${JSON.stringify(token, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  })
  await chmod(TOKEN_PATH, 0o600).catch(() => {})
}

function resolveAuthNodeBinary(context = {}) {
  const override = env("NIFTY_NODE_BINARY", context)
  if (!override) return DEFAULT_AUTH_NODE_BINARY
  if (override === DEFAULT_AUTH_NODE_BINARY || override === process.execPath) return override
  if (envBoolean("NIFTY_ALLOW_UNSAFE_NODE_BINARY_OVERRIDE", false, context)) return override

  throw new Error(
    "NIFTY_NODE_BINARY override is disabled by default because the auth subprocess handles credentials. Use the current Node executable or set NIFTY_ALLOW_UNSAFE_NODE_BINARY_OVERRIDE=true only in trusted local test environments.",
  )
}

function isTokenUsable(token) {
  return Boolean(
    token?.access_token &&
      token?.expires_at &&
      Date.now() + TOKEN_SKEW_MS < Number(token.expires_at),
  )
}

function basicAuth(clientID, clientSecret) {
  return Buffer.from(`${clientID}:${clientSecret}`).toString("base64")
}

async function requestToken(body, context = {}) {
  const config = getClientConfig(context)
  if (!config.clientID || !config.clientSecret) {
    throw new Error(
      "Missing Nifty client credentials. Set NIFTY_CLIENT_ID and NIFTY_CLIENT_SECRET.",
    )
  }

  const response = await fetch(`${API_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth(config.clientID, config.clientSecret)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  })

  const payload = await parseResponse(response, {
    method: "POST",
    path: "/oauth/token",
  })
  const token = {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    token_type: payload.token_type,
    expires_in: payload.expires_in,
    expires_at: Date.now() + Number(payload.expires_in || 0) * 1000,
    scope: payload.scope,
  }
  await writeTokenCache(token)
  return token
}

function getLocalRedirectURI(host, port) {
  return `http://${host}:${port}/callback`
}

function getAuthPort(context = {}, explicitPort) {
  if (explicitPort !== undefined && explicitPort !== null) return explicitPort
  const configuredPort = env("NIFTY_AUTH_PORT", context)
  if (!configuredPort) return 8787
  const port = Number(configuredPort)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("NIFTY_AUTH_PORT must be an integer between 1 and 65535.")
  }
  return port
}

function getAuthorizeURL(host, port, state, context = {}) {
  const config = getClientConfig(context)
  if (!config.authorizeURL) {
    throw new Error("Missing NIFTY_AUTHORIZE_URL.")
  }

  const url = new URL(config.authorizeURL)
  url.searchParams.set("redirect_uri", getLocalRedirectURI(host, port))
  if (state) url.searchParams.set("state", state)
  return url.toString()
}

function createOAuthState() {
  return randomBytes(16).toString("hex")
}

async function assertPortAvailable(host, port) {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once("error", (error) => {
      reject(new Error(`Unable to start localhost auth server on ${host}:${port}: ${error.message}`))
    })
    server.listen(port, host, () => {
      server.close(() => resolve())
    })
  })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

async function waitForCallbackServer(host, port) {
  const readinessHost = host === "0.0.0.0" ? "127.0.0.1" : host
  const url = getLocalRedirectURI(readinessHost, port)
  const deadline = Date.now() + 3000
  let lastError

  while (Date.now() < deadline) {
    try {
      await fetchWithTimeout(url, 500)
      return
    } catch (error) {
      lastError = error
      await sleep(100)
    }
  }

  throw new Error(
    [
      `Nifty auth callback server did not respond at ${url}.`,
      `Check that port ${port} is forwarded and inspect ${AUTH_LOG_PATH}.`,
      lastError?.message ? `Last error: ${lastError.message}` : undefined,
    ]
      .filter(Boolean)
      .join(" "),
  )
}

async function fetchText(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Unable to fetch ${url}: ${response.status} ${response.statusText}`)
  }
  return response.text()
}

async function fetchLatestCommit(ref) {
  try {
    const response = await fetch(`https://api.github.com/repos/CaveIM/opencode-nifty/commits/${encodeURIComponent(ref)}`)
    if (!response.ok) return null
    const payload = await response.json()
    return payload?.sha || null
  } catch {
    return null
  }
}

function currentPluginSource() {
  return readFileSync(fileURLToPath(import.meta.url), "utf8")
}

function samePluginSource(current, latest) {
  return String(current).trim() === String(latest).trim()
}

async function runInstallScript(script, ref, context = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["-s"], {
      cwd: context.directory || context.worktree || process.cwd(),
      env: {
        ...process.env,
        NIFTY_INSTALL_REF: ref,
      },
      stdio: ["pipe", "pipe", "pipe"],
    })
    const output = []
    const append = (chunk) => {
      output.push(String(chunk))
      while (output.join("").length > 20000) output.shift()
    }
    const timeout = setTimeout(() => {
      child.kill("SIGTERM")
      reject(new Error("Nifty plugin installer timed out."))
    }, 120000)

    child.stdout.on("data", append)
    child.stderr.on("data", append)
    child.once("error", (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once("close", (code) => {
      clearTimeout(timeout)
      const text = output.join("")
      if (code === 0) {
        resolve(text)
        return
      }
      reject(new Error(`Nifty plugin installer failed with exit code ${code}.\n${text}`))
    })
    child.stdin.end(script)
  })
}

async function waitForAuthorizationCode(host, port, signal, expectedState) {
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      try {
        const requestURL = new URL(request.url || "/", `http://${host}:${port}`)
        if (requestURL.pathname !== "/callback") {
          response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
          response.end("Not found")
          return
        }

        const error = requestURL.searchParams.get("error")
        const code = requestURL.searchParams.get("code")
        const state = requestURL.searchParams.get("state")

        if (error) {
          response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
          response.end("<h1>Nifty authorization failed</h1><p>You can close this tab.</p>")
          server.close()
          reject(new Error(`Nifty authorization failed: ${error}`))
          return
        }

        if (!code) {
          response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
          response.end("<h1>Missing code</h1><p>You can close this tab.</p>")
          return
        }

        if (expectedState && state !== expectedState) {
          response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
          response.end("<h1>Invalid OAuth state</h1><p>You can close this tab.</p>")
          server.close()
          reject(new Error("Nifty authorization failed: OAuth state mismatch."))
          return
        }

        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
        response.end("<h1>Nifty connected</h1><p>You can close this tab and return to OpenCode.</p>")
        server.close()
        resolve(code)
      } catch (error) {
        server.close()
        reject(error)
      }
    })

    const onAbort = () => {
      server.close()
      reject(new Error("Authorization cancelled."))
    }

    signal?.addEventListener("abort", onAbort, { once: true })

    server.listen(port, host, () => {})
    server.on("error", (error) => {
      signal?.removeEventListener("abort", onAbort)
      reject(error)
    })
    server.on("close", () => {
      signal?.removeEventListener("abort", onAbort)
    })
  })
}

async function startBackgroundAuthorizationServer(host, port, state, context = {}) {
  const redirectURI = getLocalRedirectURI(host, port)
  const config = getClientConfig(context)
  const script = `
    import { createServer } from "node:http";
    import { appendFile, chmod, writeFile, mkdir } from "node:fs/promises";
    import { dirname } from "node:path";
    import { homedir } from "node:os";

    const host = process.env.NIFTY_AUTH_HOST || "127.0.0.1";
    const port = Number(process.env.NIFTY_AUTH_PORT || "8787");
    const redirectURI = process.env.NIFTY_REDIRECT_URI || \`http://\${host}:\${port}/callback\`;
    const tokenPath = process.env.NIFTY_TOKEN_PATH || homedir() + "/.config/opencode/nifty-auth.json";
    const logPath = process.env.NIFTY_AUTH_LOG_PATH || homedir() + "/.config/opencode/nifty-auth-server.log";
    const expectedState = process.env.NIFTY_AUTH_STATE;

    async function log(message) {
      try {
        await mkdir(dirname(logPath), { recursive: true, mode: 0o700 });
        await chmod(dirname(logPath), 0o700).catch(() => {});
        await appendFile(logPath, \`[\${new Date().toISOString()}] \${message}\\n\`, "utf8");
      } catch {}
    }

    function html(title, body) {
      return \`<!doctype html><html><head><title>\${title}</title></head><body><h1>\${title}</h1><p>\${body}</p></body></html>\`;
    }

    const server = createServer(async (request, response) => {
      try {
        const requestURL = new URL(request.url || "/", redirectURI);
        if (requestURL.pathname !== "/callback") {
          response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          response.end("Not found");
          return;
        }

        const error = requestURL.searchParams.get("error");
        const code = requestURL.searchParams.get("code");
        const state = requestURL.searchParams.get("state");

        if (error) {
          response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          response.end(html("Nifty authorization failed", "You can close this tab and return to OpenCode."));
          await log("authorization failed callback received");
          server.close(() => process.exit(1));
          return;
        }

        if (!code) {
          response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          response.end(html("Missing authorization code", "Nifty did not include a code in the callback URL."));
          return;
        }

        if (expectedState && state !== expectedState) {
          response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          response.end(html("Invalid OAuth state", "The callback state did not match. Retry auth from OpenCode."));
          await log("invalid oauth state received");
          server.close(() => process.exit(1));
          return;
        }

        const clientID = process.env.NIFTY_CLIENT_ID;
        const clientSecret = process.env.NIFTY_CLIENT_SECRET;
        if (!clientID || !clientSecret) {
          response.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
          response.end(html("Missing Nifty credentials", "Set NIFTY_CLIENT_ID and NIFTY_CLIENT_SECRET in this OpenCode environment."));
          await log("missing client credentials in auth server environment");
          server.close(() => process.exit(1));
          return;
        }

        const basic = Buffer.from(\`\${clientID}:\${clientSecret}\`).toString("base64");
        const tokenResponse = await fetch("https://openapi.niftypm.com/oauth/token", {
          method: "POST",
          headers: {
            Authorization: \`Basic \${basic}\`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: redirectURI }),
        });

        const text = await tokenResponse.text();
        if (!tokenResponse.ok) {
          response.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
          response.end(html("Nifty token exchange failed", "Check your redirect URI and Nifty app credentials."));
          await log(\`token exchange failed with status \${tokenResponse.status}\`);
          server.close(() => process.exit(1));
          return;
        }

        const token = JSON.parse(text);
        token.expires_at = Date.now() + Number(token.expires_in || 0) * 1000;
        await mkdir(dirname(tokenPath), { recursive: true, mode: 0o700 });
        await chmod(dirname(tokenPath), 0o700).catch(() => {});
        await writeFile(tokenPath, JSON.stringify(token, null, 2) + "\\n", { encoding: "utf8", mode: 0o600 });
        await chmod(tokenPath, 0o600).catch(() => {});

        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(html("Nifty connected", "You can close this tab and return to OpenCode."));
        await log("token exchange completed successfully");
        server.close(() => process.exit(0));
      } catch (error) {
        await log(\`request handling failed: \${error?.message || "unexpected error"}\`);
        response.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
        response.end(html("Nifty auth server failed", "Return to OpenCode and retry."));
        server.close(() => process.exit(1));
      }
    });

    server.once("error", async (error) => {
      await log(\`listen failed on \${host}:\${port}: \${error?.message || error}\`);
      process.exit(1);
    });
    server.listen(port, host, () => {
      void log(\`listening on \${host}:\${port}; redirect_uri=\${redirectURI}\`);
    });
    setTimeout(async () => {
      await log("auth server timed out");
      server.close(() => process.exit(1));
    }, 10 * 60 * 1000);
  `

  const authNodeBinary = resolveAuthNodeBinary(context)
  mkdirSync(dirname(AUTH_LOG_PATH), { recursive: true, mode: 0o700 })
  appendFileSync(
    AUTH_LOG_PATH,
    `[${new Date().toISOString()}] starting auth server with ${authNodeBinary} on ${host}:${port}; redirect_uri=${redirectURI}\n`,
    "utf8",
  )
  const logFd = openSync(AUTH_LOG_PATH, "a")
  const child = spawn(authNodeBinary, ["--input-type=module", "-e", script], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: {
      ...process.env,
      NIFTY_AUTH_HOST: host,
      NIFTY_AUTH_PORT: String(port),
      NIFTY_AUTH_STATE: state,
      NIFTY_CLIENT_ID: config.clientID || "",
      NIFTY_CLIENT_SECRET: config.clientSecret || "",
      NIFTY_AUTHORIZE_URL: config.authorizeURL || "",
      NIFTY_REDIRECT_URI: redirectURI,
      NIFTY_TOKEN_PATH: TOKEN_PATH,
      NIFTY_AUTH_LOG_PATH: AUTH_LOG_PATH,
    },
  })
  closeSync(logFd)
  child.once("error", (error) => {
    appendFileSync(AUTH_LOG_PATH, `[${new Date().toISOString()}] spawn failed: ${error.message}\n`, "utf8")
  })
  child.unref()
  await waitForCallbackServer(host, port)
  return redirectURI
}

async function getAccessToken() {
  const config = getClientConfig()
  if (config.accessToken) return config.accessToken

  const cached = await readTokenCache()
  if (isTokenUsable(cached)) {
    return cached.access_token
  }

  const refreshToken = config.refreshToken || cached?.refresh_token
  if (refreshToken) {
    const refreshed = await requestToken({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      ...(config.redirectURI ? { redirect_uri: config.redirectURI } : {}),
    })
    return refreshed.access_token
  }

  throw new Error(
    [
      "Nifty auth is not configured.",
      "Set NIFTY_CLIENT_ID, NIFTY_CLIENT_SECRET, NIFTY_REDIRECT_URI, and NIFTY_AUTHORIZE_URL.",
      "Then run the nifty_auth_help tool and complete the one-time code exchange with nifty_auth_exchange_code.",
      "If you already have a token, you can also set NIFTY_ACCESS_TOKEN directly.",
    ].join(" "),
  )
}

async function parseResponse(response, context = {}) {
  const text = await response.text()
  const contentType = response.headers.get("content-type") || ""
  const isJSON = contentType.includes("application/json")
  const payload = text ? (isJSON ? JSON.parse(text) : text) : undefined

  if (!response.ok) {
    const detail = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2)
    const request = context.method && context.path ? ` ${context.method} ${context.path}` : ""
    throw new Error(`Nifty API ${response.status} ${response.statusText}${request}: ${detail}`)
  }

  return payload
}

function appendQueryParams(url, query) {
  if (!query) return url

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue
    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(key, String(item))
      }
      continue
    }
    url.searchParams.set(key, String(value))
  }

  return url
}

function cleanObject(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  )
}

function cleanWriteObject(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => {
      if (value === undefined || value === null) return false
      if (typeof value === "string" && value.trim() === "") return false
      if (Array.isArray(value) && value.length === 0) return false
      return true
    }),
  )
}

function documentContentFromText(text) {
  const value = String(text ?? "").trimEnd()
  if (!value.trim()) return undefined

  const paragraphs = value.split(/\n{2,}/).map((block) => {
    const content = []
    const lines = block.split(/\n/)
    for (const [index, line] of lines.entries()) {
      if (line) content.push({ type: "text", text: line })
      if (index < lines.length - 1) content.push({ type: "hardBreak" })
    }
    return content.length ? { type: "paragraph", content } : { type: "paragraph" }
  })

  return { type: "doc", content: paragraphs }
}

function requireBulkTaskConfirmation(action, taskIDs, confirmation) {
  const count = Array.isArray(taskIDs) ? taskIDs.length : 0
  const expected = `${action} ${count} ${count === 1 ? "task" : "tasks"}`
  if (confirmation !== expected) {
    throw new Error(
      `Bulk task ${action} requires explicit confirmation. Re-run with confirmation: ${JSON.stringify(expected)}.`,
    )
  }
}

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function configPath(context = {}) {
  if (context.config_path) return context.config_path
  const directory = context.directory || context.worktree || process.cwd()
  return join(directory, "nifty-workflows.json")
}

function projectWorkflowConfigPath(context = {}, explicitPath) {
  if (explicitPath) return explicitPath
  const directory = context.directory || context.worktree || process.cwd()
  return join(directory, "nifty-workflows.json")
}

function workflowContext(context = {}, explicitPath) {
  return explicitPath ? { ...context, config_path: explicitPath } : context
}

async function readWorkflowConfig(context = {}) {
  try {
    const raw = await readFile(configPath(context), "utf8")
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? parsed : { workflows: {} }
  } catch {
    return { workflows: {} }
  }
}

function getWorkflowAliasMap(config) {
  return config?.workflows && typeof config.workflows === "object"
    ? config.workflows
    : {}
}

async function workflowForArgs(input = {}, context = {}) {
  const contextWithConfig = workflowContext(context, input.config_path)
  const alias = input.workflow_alias || defaultWorkflowAlias(contextWithConfig)
  if (!alias) return {}
  const config = await readWorkflowConfig(contextWithConfig)
  return getWorkflowAliasMap(config)[alias] || {}
}

function defaultCaptureStateKey(workflow = {}) {
  const states = workflow.states || workflow.statuses || {}
  return states.ideas ? "ideas" : "backlog"
}

async function writeWorkflowAliasConfig(path, alias, workflow, options = {}) {
  let config = { workflows: {} }
  let existed = false

  try {
    const raw = await readFile(path, "utf8")
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object") config = parsed
    existed = true
  } catch {
    config = { workflows: {} }
  }

  config.workflows = getWorkflowAliasMap(config)
  const aliasExisted = Boolean(config.workflows[alias])
  const overwrite = options.overwrite === true

  if (!aliasExisted || overwrite) {
    config.workflows[alias] = workflow
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf8")
  }

  return {
    path,
    file_existed: existed,
    alias_existed: aliasExisted,
    written: !aliasExisted || overwrite,
    overwritten: aliasExisted && overwrite,
  }
}

async function fetchProjects(limit = 100, offset = 0, archived) {
  const response = await niftyRequest("/api/v1.0/projects", {
    query: cleanObject({
      archived: archived === undefined ? undefined : String(archived),
      limit,
      offset,
      sort: "ascending",
    }),
  })
  return response.projects || response.items || []
}

async function fetchAllProjects(options = {}) {
  const items = []
  const archivedModes = options.includeArchived ? [false, true] : [options.archived]

  for (const archived of archivedModes) {
    let offset = 0
    while (true) {
      const batch = await fetchProjects(100, offset, archived)
      items.push(...batch)
      if (batch.length < 100) break
      offset += batch.length
    }
  }

  return Array.from(new Map(items.map((item) => [item.id, item])).values())
}

async function fetchStatuses(projectID, archived = false) {
  const response = await niftyRequest("/api/v1.0/taskgroups", {
    query: {
      project_id: projectID,
      archived,
    },
  })
  return response.items || response.taskgroups || []
}

async function fetchAllStatuses(projectID) {
  return fetchStatuses(projectID, false)
}

async function createStatus(projectID, status) {
  return niftyRequest("/api/v1.0/taskgroups", {
    method: "POST",
    body: cleanWriteObject({
      project_id: projectID,
      name: status.name,
    }),
  })
}

async function fetchMilestones(projectID, options = {}) {
  const response = await niftyRequest("/api/v1.0/milestones", {
    query: cleanObject({
      project_id: projectID,
      is_list: options.isList === undefined ? undefined : String(options.isList),
      limit: options.limit || 100,
      offset: options.offset || 0,
      sort: options.sort || "ascending",
    }),
  })
  return {
    items: response.items || response.milestones || [],
    hasMore: Boolean(response.hasMore || response.has_more),
  }
}

async function fetchAllMilestones(projectID, options = {}) {
  const items = []
  let offset = 0

  while (true) {
    const response = await fetchMilestones(projectID, { ...options, limit: 100, offset })
    items.push(...response.items)
    if (!response.hasMore || response.items.length < 100) break
    offset += response.items.length
  }

  return items
}

async function createList(projectID, list) {
  return niftyRequest("/api/v1.0/milestones", {
    method: "POST",
    body: {
      project_id: projectID,
      name: list.name,
      description: "",
      is_list: true,
    },
  })
}

async function recommendedWorkflowSetupPlan(projectID, options = {}) {
  const [statuses, lists] = await Promise.all([
    fetchAllStatuses(projectID),
    fetchAllMilestones(projectID, { isList: true }),
  ])

  const statusPlan = RECOMMENDED_WORKFLOW.statuses.map((status) => ({
    ...status,
    existing: statuses.find((item) => statusMatches(item, status.name)) || null,
  }))
  const listPlan = RECOMMENDED_WORKFLOW.lists.map((list) => ({
    ...list,
    existing: lists.find((item) => milestoneMatches(item, list.name)) || null,
  }))

  const createdStatuses = []
  const createdLists = []
  const dryRun = options.dryRun !== false
  const createStatuses = options.createStatuses !== false
  const createLists = options.createLists !== false

  if (!dryRun) {
    if (createStatuses) {
      for (const status of statusPlan.filter((item) => !item.existing)) {
        createdStatuses.push(await createStatus(projectID, status))
      }
    }

    if (createLists) {
      for (const list of listPlan.filter((item) => !item.existing)) {
        createdLists.push(await createList(projectID, list))
      }
    }
  }

  return {
    dry_run: dryRun,
    statuses: {
      existing: statusPlan
        .filter((item) => item.existing)
        .map((item) => ({ key: item.key, name: item.name, id: item.existing.id })),
      missing: createStatuses
        ? statusPlan.filter((item) => !item.existing).map(({ existing, ...item }) => item)
        : [],
      skipped: createStatuses
        ? []
        : statusPlan.filter((item) => !item.existing).map(({ existing, ...item }) => item),
      created: createdStatuses,
    },
    lists: {
      existing: listPlan
        .filter((item) => item.existing)
        .map((item) => ({ key: item.key, name: item.name, id: item.existing.id })),
      missing: createLists
        ? listPlan.filter((item) => !item.existing).map(({ existing, ...item }) => item)
        : [],
      skipped: createLists
        ? []
        : listPlan.filter((item) => !item.existing).map(({ existing, ...item }) => item),
      created: createdLists,
    },
  }
}

function projectMatches(project, selector) {
  const wanted = normalize(selector)
  if (!wanted) return false
  return [project.id, project.name, project.nice_id]
    .filter(Boolean)
    .some((value) => normalize(value) === wanted)
}

async function resolveProjectSelector(input = {}, context = {}) {
  const contextWithConfig = workflowContext(context, input.config_path)
  const config = await readWorkflowConfig(contextWithConfig)
  const workflows = getWorkflowAliasMap(config)
  const workflowAlias = input.workflow_alias || defaultWorkflowAlias(contextWithConfig)
  const workflow = workflowAlias ? workflows[workflowAlias] : undefined

  if (input.project_id) {
    return { project: { id: input.project_id }, workflow, workflowAlias }
  }

  const projects = await fetchAllProjects()
  const selector = input.project_name || input.project_nice_id || workflow?.project?.id || workflow?.project?.name || workflow?.project?.nice_id || workflow?.project || input.project_selector

  if (!selector) {
    throw new Error("Project selector missing. Provide project_id, project_name, project_nice_id, or workflow_alias.")
  }

  const project = projects.find((item) => projectMatches(item, selector))
  if (!project) {
    throw new Error(`Unable to resolve project from selector: ${selector}`)
  }

  return { project, workflow, workflowAlias }
}

function statusMatches(status, selector) {
  const wanted = normalize(selector)
  if (!wanted) return false
  return [status.id, status.name]
    .filter(Boolean)
    .some((value) => normalize(value) === wanted)
}

function milestoneMatches(milestone, selector) {
  const wanted = normalize(selector)
  if (!wanted) return false
  return [milestone.id, milestone.name]
    .filter(Boolean)
    .some((value) => normalize(value) === wanted)
}

async function resolveMilestoneSelector(projectID, input = {}) {
  if (!input.milestone_id && !input.milestone_name && !input.list_key && !input.list_name) {
    return undefined
  }

  const milestones = await fetchAllMilestones(projectID, {
    isList: input.isList,
  })
  const workflowLists = input.workflow?.lists || input.workflow?.milestones || {}
  const listName = input.list_key ? workflowLists[input.list_key] : input.list_name
  const selector = input.milestone_id || input.milestone_name || listName

  if (!selector) {
    throw new Error(`Workflow list '${input.list_key}' is not configured.`)
  }

  const milestone = milestones.find((item) => milestoneMatches(item, selector))
  if (!milestone) {
    throw new Error(`Unable to resolve milestone/list '${selector}' for project ${projectID}.`)
  }

  return milestone
}

async function resolveStatusSelector(projectID, input = {}) {
  if (!input.status_id && !input.status_name && !input.state_key) {
    return undefined
  }

  const statuses = await fetchAllStatuses(projectID)
  const statusName = input.state_key
    ? input.workflow?.states?.[input.state_key] || input.workflow?.statuses?.[input.state_key]
    : input.status_name
  const selector = input.status_id || statusName

  if (!selector) {
    throw new Error(`Workflow state '${input.state_key}' is not configured.`)
  }

  const status = statuses.find((item) => statusMatches(item, selector))
  if (!status) {
    throw new Error(`Unable to resolve status '${selector}' for project ${projectID}.`)
  }

  return status
}

function getTaskProjectID(task) {
  return (
    task?.project_id ||
    task?.project?.id ||
    task?.project ||
    task?.task_group?.project_id ||
    task?.task_group?.project
  )
}

function getTaskStatusID(task) {
  return task?.task_group_id || task?.task_group?.id || task?.task_group || task?.group_id
}

function getWorkflowCustomFields(workflow = {}) {
  return workflow?.custom_fields && typeof workflow.custom_fields === "object"
    ? workflow.custom_fields
    : {}
}

function resolveCustomField(workflow = {}, input = {}) {
  const customFields = getWorkflowCustomFields(workflow)
  const selector = input.key || input.custom_field_key || input.id || input.custom_field_id
  if (!selector) return undefined
  const wanted = normalize(selector)
  const entry = Object.entries(customFields).find(([key, field]) =>
    [key, field?.id, field?.name]
      .filter(Boolean)
      .some((value) => normalize(value) === wanted),
  )
  if (entry) return { key: entry[0], ...entry[1] }
  if (input.id || input.custom_field_id) return { key: selector, id: selector }
  throw new Error(`Workflow custom field '${selector}' is not configured.`)
}

function customFieldWriteValue(field = {}, input = {}) {
  const valueKey = input.value_key || input.custom_field_value_key
  const value = input.value ?? input.custom_field_value
  if (valueKey) {
    const mapped = field.values?.[valueKey]
    if (mapped === undefined) {
      throw new Error(`Workflow custom field '${field.key}' value '${valueKey}' is not configured.`)
    }
    return mapped
  }
  if (value !== undefined && field.values?.[value] !== undefined) return field.values[value]
  return value
}

function taskFieldValue(task, fieldID) {
  const field = (task?.fields || []).find((item) => item?.id === fieldID)
  return field ? field.value : undefined
}

function customFieldValueKey(field = {}, value) {
  const entry = Object.entries(field.values || {}).find(([, label]) => normalize(label) === normalize(value))
  return entry?.[0] || null
}

function taskCustomFields(task, workflow = {}) {
  const entries = Object.entries(getWorkflowCustomFields(workflow))
  if (!entries.length) return {}
  return Object.fromEntries(
    entries
      .map(([key, field]) => {
        if (!field?.id) return null
        const value = taskFieldValue(task, field.id)
        if (value === undefined) return null
        return [
          key,
          cleanWriteObject({
            id: field.id,
            name: field.name,
            type: field.type,
            value,
            value_key: customFieldValueKey(field, value),
          }),
        ]
      })
      .filter(Boolean),
  )
}

function enrichTaskCustomFields(task, workflow = {}) {
  const customFields = taskCustomFields(task, workflow)
  if (!Object.keys(customFields).length) return task
  return { ...task, custom_fields: customFields }
}

function customFieldPayload(workflow = {}, customFields = []) {
  if (!customFields?.length) return undefined
  return customFields.map((item) => {
    const field = resolveCustomField(workflow, item)
    if (!field?.id) {
      throw new Error(`Custom field '${item.key || item.id || item.custom_field_key || item.custom_field_id}' is missing an id.`)
    }
    const value = customFieldWriteValue(field, item)
    if (value === undefined || value === null || value === "") {
      throw new Error(`Custom field '${field.key}' is missing a value.`)
    }
    return { id: field.id, value }
  })
}

function filterTasksByCustomField(tasks, workflow = {}, input = {}) {
  if (!input.custom_field_key && !input.custom_field_id) return tasks
  const field = resolveCustomField(workflow, input)
  if (!field?.id) return tasks
  const expected = customFieldWriteValue(field, input)
  return tasks.filter((task) => {
    const value = taskFieldValue(task, field.id)
    if (expected === undefined || expected === null || expected === "") return value !== undefined
    return normalize(value) === normalize(expected)
  })
}

async function updateTaskCustomFields(taskID, workflow = {}, customFields = []) {
  const responses = []
  for (const field of customFieldPayload(workflow, customFields) || []) {
    responses.push(await niftyRequest(
      `/api/v1.0/tasks/${encodeURIComponent(taskID)}/fields/${encodeURIComponent(field.id)}`,
      {
        method: "PUT",
        body: { value: field.value },
      },
    ))
  }
  return responses
}

function statusMap(statuses) {
  return new Map(statuses.map((status) => [status.id, status.name]))
}

function summarizeTask(task, statusesByID = new Map(), workflow = {}) {
  const rawStatus = getTaskStatusID(task)
  const summary = {
    id: task.id,
    name: task.name,
    completed: task.completed,
    archived: task.archived,
    due_date: task.due_date || null,
    project_id: getTaskProjectID(task) || null,
    status_id: rawStatus || null,
    status_name: rawStatus ? statusesByID.get(rawStatus) || null : null,
    story_points: task.story_points ?? null,
    assignees: task.assignees || [],
  }
  const customFields = taskCustomFields(task, workflow)
  if (Object.keys(customFields).length) summary.custom_fields = customFields
  return summary
}

function filterTasksByStatus(tasks, statusID) {
  if (!statusID) return tasks
  return tasks.filter((task) => getTaskStatusID(task) === statusID)
}

function findMatchingProjects(projects, query) {
  const wanted = normalize(query)
  if (!wanted) return []
  return projects.filter((project) =>
    [project.id, project.name, project.nice_id]
      .filter(Boolean)
      .some((value) => normalize(value).includes(wanted)),
  )
}

function renderSection(title, value) {
  if (!value) return []
  return [`## ${title}`, String(value).trim(), ""]
}

function renderListSection(title, items, checkbox = false) {
  if (!items?.length) return []
  return [
    `## ${title}`,
    ...items.map((item) => `${checkbox ? "- [ ]" : "-"} ${String(item).trim()}`),
    "",
  ]
}

function nonEmptyItems(items = []) {
  return Array.isArray(items) ? items.map((item) => String(item).trim()).filter(Boolean) : []
}

function assertNoOpenQuestions(input, label = "task") {
  const questions = nonEmptyItems(input.open_questions)
  if (!questions.length) return
  throw new Error(
    [
      `Cannot create or update ${label} with unresolved open questions.`,
      "Ask the user to answer these first, then use the answers to update the task summary, acceptance criteria, implementation notes, or checklist:",
      ...questions.map((question) => `- ${question}`),
    ].join("\n"),
  )
}

function buildTaskDescription(input) {
  const lines = [
    ...renderSection("Summary", input.summary),
    ...renderSection("Problem", input.problem),
    ...renderSection("Desired Outcome", input.desired_outcome),
    ...renderListSection("Acceptance Criteria", input.acceptance_criteria),
    ...renderListSection("Implementation Notes", input.implementation_notes),
    ...renderListSection("Checklist", input.checklist, true),
  ]

  return lines.join("\n").trim() || undefined
}

const SHAPING_FIELDS = [
  {
    key: "summary",
    title: "Summary",
    question: "What is the concise one- or two-sentence summary of this feature?",
  },
  {
    key: "problem",
    title: "Problem",
    question: "What user or business problem does this solve, and who experiences it?",
  },
  {
    key: "desired_outcome",
    title: "Desired Outcome",
    question: "What should be true after this ships? Include the success outcome, not just the implementation.",
  },
  {
    key: "user_experience",
    title: "User Experience",
    question: "What should the user experience look like, including key screens, states, copy, and failure paths?",
  },
  {
    key: "acceptance_criteria",
    title: "Acceptance Criteria",
    list: true,
    question: "What specific acceptance criteria must be met before this is considered complete?",
  },
  {
    key: "security_privacy",
    title: "Security / Privacy",
    question: "What security, privacy, permission, auth, abuse, or data exposure concerns need to be handled? If none, say why none apply.",
  },
  {
    key: "performance",
    title: "Performance",
    question: "What performance, latency, scale, or resource-usage expectations or risks should be considered? If none, say why none apply.",
  },
  {
    key: "data_integrations",
    title: "Data / API / Integrations",
    question: "What data, API, database, migration, webhook, or third-party integration changes are needed? If none, say none.",
  },
  {
    key: "edge_cases",
    title: "Edge Cases",
    question: "What edge cases, empty states, error states, permissions cases, or rollback cases should be handled?",
  },
  {
    key: "implementation_notes",
    title: "Implementation Notes",
    question: "What implementation notes, constraints, likely files/components, or technical approach should the developer AI know?",
  },
  {
    key: "test_plan",
    title: "Test Plan",
    question: "How should this be tested? Include automated tests, manual QA, and important regression checks.",
  },
  {
    key: "rollout",
    title: "Rollout / Release Notes",
    question: "How should this roll out? Include flags, migrations, release notes, monitoring, or deployment sequencing if relevant.",
  },
  {
    key: "non_goals",
    title: "Non-Goals",
    question: "What is explicitly out of scope for this task so the developer AI does not overbuild it?",
  },
]

function fieldHasAnswer(input, field) {
  const value = input[field.key]
  if (field.list) return nonEmptyItems(value).length > 0
  return typeof value === "string" && value.trim().length > 0
}

function missingShapingFields(input = {}) {
  return SHAPING_FIELDS.filter((field) => !fieldHasAnswer(input, field))
}

function nextShapingQuestion(input = {}) {
  const field = missingShapingFields(input)[0]
  return field ? { field: field.key, question: field.question } : null
}

function buildShapedTaskDescription(input = {}) {
  const lines = []
  for (const field of SHAPING_FIELDS) {
    const value = input[field.key]
    if (field.list) lines.push(...renderListSection(field.title, value))
    else lines.push(...renderSection(field.title, value))
  }
  return lines.join("\n").trim() || undefined
}

function summarizeShapingInput(input = {}) {
  return Object.fromEntries(
    SHAPING_FIELDS.map((field) => [
      field.key,
      field.list ? nonEmptyItems(input[field.key]) : (input[field.key] || null),
    ]),
  )
}

function requireSubtaskConfirmation(subtasks = [], confirmation) {
  const count = Array.isArray(subtasks) ? subtasks.length : 0
  const expected = `create ${count} ${count === 1 ? "subtask" : "subtasks"}`
  if (confirmation !== expected) {
    throw new Error(
      `Creating shaped subtasks requires explicit confirmation. Re-run with subtask_confirmation: ${JSON.stringify(expected)}.`,
    )
  }
}

function parseJSONArg(value, label) {
  if (!value) return undefined
  try {
    return JSON.parse(value)
  } catch (error) {
    throw new Error(`${label} must be valid JSON: ${error.message}`)
  }
}

function botCommentText(text, enabled = true) {
  const trimmed = String(text || "").trimStart()
  if (!enabled) return trimmed
  if (trimmed.startsWith(BOT_COMMENT_PREFIX)) return trimmed
  const withoutLegacyPrefix = trimmed.startsWith(LEGACY_MCP_COMMENT_PREFIX)
    ? trimmed.slice(LEGACY_MCP_COMMENT_PREFIX.length).trimStart()
    : trimmed.startsWith(LEGACY_BOT_COMMENT_PREFIX)
    ? trimmed.slice(LEGACY_BOT_COMMENT_PREFIX.length).trimStart()
    : trimmed
  return `${BOT_COMMENT_PREFIX} ${withoutLegacyPrefix}`
}

function niftyShellCommandHint(command) {
  const normalized = normalize(command)
  if (normalized === "nifty health check" || normalized === "nifty healthcheck") {
    return NIFTY_SHELL_COMMAND_HINT
  }
  return undefined
}

function envBoolean(name, fallback, context = {}) {
  const value = env(name, context)
  if (value === undefined) return fallback
  const normalized = String(value).trim().toLowerCase()
  return ["1", "true", "yes", "on"].includes(normalized)
}

function lifecyclePolicyEnabled(context = {}) {
  return envBoolean("NIFTY_AUTOPOLICY_ENABLED", true, context)
}

function autoContextEnabled(context = {}) {
  return envBoolean("NIFTY_AUTOCONTEXT_ENABLED", true, context)
}

function envInteger(name, fallback, context = {}) {
  const value = env(name, context)
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) return fallback
  return parsed
}

function autoContextCommentLimit(context = {}) {
  return envInteger("NIFTY_AUTOCONTEXT_COMMENT_LIMIT", AUTOCONTEXT_DEFAULT_COMMENT_LIMIT, context)
}

function autoContextTaskLimit(context = {}) {
  return envInteger("NIFTY_AUTOCONTEXT_TASK_LIMIT", AUTOCONTEXT_DEFAULT_TASK_LIMIT, context)
}

function lifecycleAssignSelfEnabled(context = {}) {
  return envBoolean("NIFTY_AUTOPOLICY_ASSIGN_SELF", true, context)
}

function lifecycleDeliveryGateEnabled(context = {}) {
  return envBoolean("NIFTY_AUTOPOLICY_ENFORCE_DELIVERY_GATE", true, context)
}

/**
 * When false (default), the routine "Status set to In Progress / Assignee
 * unchanged" auto-lifecycle comment is suppressed. The delivery gate comment
 * (which carries real evidence) is never suppressed by this flag.
 * Enable with NIFTY_LIFECYCLE_STATUS_COMMENTS=true for verbose audit trails.
 */
function lifecycleStatusCommentsEnabled(context = {}) {
  return envBoolean("NIFTY_LIFECYCLE_STATUS_COMMENTS", false, context)
}

function lifecycleInProgressStateKey(context = {}) {
  return env("NIFTY_AUTOPOLICY_IN_PROGRESS_STATE", context) || LIFECYCLE_DEFAULT_IN_PROGRESS_KEY
}

function lifecycleDevReviewStateKey(context = {}) {
  return env("NIFTY_AUTOPOLICY_DEV_REVIEW_STATE", context) || LIFECYCLE_DEFAULT_DEV_REVIEW_KEY
}

function lifecycleDefaultAssigneeIDs(context = {}) {
  const configured = env("NIFTY_AUTOPOLICY_DEFAULT_ASSIGNEE_IDS", context)
  if (!configured) return []
  return configured
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
}

function taskAssigneeIDs(task = {}) {
  const list = [
    ...(Array.isArray(task.assignees) ? task.assignees : []),
    ...(Array.isArray(task.members) ? task.members : []),
  ]
  return list
    .map((member) => (typeof member === "string" ? member : member?.id))
    .filter(Boolean)
}

function changedFilesFromGit(context = {}) {
  const worktree = context.directory || context.worktree || process.cwd()
  const commands = [
    ["diff", "--name-only", "HEAD", "--"],
    ["show", "--name-only", "--pretty=format:", "HEAD"],
  ]

  for (const args of commands) {
    const result = spawnSync("git", args, {
      cwd: worktree,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    if (result.status !== 0) continue
    const files = String(result.stdout || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    if (files.length) return [...new Set(files)]
  }

  return []
}

function isVisualFile(filePath = "") {
  const path = String(filePath || "").toLowerCase()
  if (!path) return false
  if (/(^|\/)(public|frontend|docs-site|resources\/views|resources\/css|resources\/js)\//.test(path)) {
    return true
  }
  return /\.(css|scss|sass|less|styl|html|htm|jsx|tsx|vue|svelte|astro|png|jpe?g|gif|webp|svg)$/i.test(path)
}

function requiresVisualProof(changedFiles = []) {
  return (changedFiles || []).some((filePath) => isVisualFile(filePath))
}

function engineeringQualityConfig(policy) {
  const defaults = {
    enabled: true,
    require_architectural_integration: true,
    require_tdd_red_green: true,
    require_regression_proof: true,
    require_iterative_validation: true,
    forbid_placeholder_delivery: true,
    minimum_evidence_chars: 40,
    forbidden_claim_patterns: [
      "fixed it",
      "works now",
      "tests pass",
      "handled",
      "done",
      "should work",
      "looks good",
      "minor fix",
    ],
  }
  if (!policy || typeof policy !== "object") return defaults
  return { ...defaults, ...(policy.engineering_quality ?? {}) }
}

function assertSubstantiveEvidence(label, value, quality = engineeringQualityConfig(null)) {
  const text = String(value || "").trim()
  if (!text) throw new Error(`delivery_evidence.${label} is required before moving to Dev Review.`)
  if (!quality.forbid_placeholder_delivery) return text

  const normalizedText = normalize(text)
  const forbidden = quality.forbidden_claim_patterns || []
  const matchesForbidden = forbidden.some((pattern) => normalizedText === normalize(pattern))
  const minimumChars = Number.isFinite(quality.minimum_evidence_chars) ? quality.minimum_evidence_chars : 40
  if (matchesForbidden || text.length < minimumChars) {
    throw new Error(
      `delivery_evidence.${label} is hand-wavy placeholder evidence and not enough evidence for delivery. `
      + "Provide concrete architectural integration, regression/TDD proof, and iterative validation details.",
    )
  }
  return text
}

function validateDeliveryEvidence(evidence = {}, options = {}) {
  const quality = options.engineeringQuality || engineeringQualityConfig(options.policy)
  const visualRequired = options.visualRequired === true
  const redProof = String(evidence.red_proof || "").trim()
  const greenProof = String(evidence.green_proof || "").trim()
  const sadPathProof = String(evidence.sad_path_proof || "").trim()
  const architectureProof = String(evidence.architecture_proof || "").trim()
  const regressionProof = String(evidence.regression_proof || "").trim()
  const iterativeProof = String(evidence.iterative_proof || "").trim()
  const visualProof = Array.isArray(evidence.visual_proof)
    ? evidence.visual_proof.map((item) => String(item || "").trim()).filter(Boolean)
    : []

  if (quality.require_tdd_red_green !== false && !redProof) {
    throw new Error("delivery_evidence.red_proof is required before moving to Dev Review.")
  }
  if (quality.require_tdd_red_green !== false && !greenProof) {
    throw new Error("delivery_evidence.green_proof is required before moving to Dev Review.")
  }
  if (!sadPathProof) throw new Error("delivery_evidence.sad_path_proof is required before moving to Dev Review.")
  const validatedArchitectureProof = quality.enabled !== false && quality.require_architectural_integration !== false
    ? assertSubstantiveEvidence("architecture_proof", architectureProof, quality)
    : architectureProof
  const validatedRegressionProof = quality.enabled !== false && quality.require_regression_proof !== false
    ? assertSubstantiveEvidence("regression_proof", regressionProof, quality)
    : regressionProof
  const validatedIterativeProof = quality.enabled !== false && quality.require_iterative_validation !== false
    ? assertSubstantiveEvidence("iterative_proof", iterativeProof, quality)
    : iterativeProof
  if (visualRequired && visualProof.length === 0) {
    throw new Error("delivery_evidence.visual_proof is required when visual-impacting files changed.")
  }

  return {
    ...evidence,
    red_proof: redProof,
    green_proof: greenProof,
    sad_path_proof: sadPathProof,
    architecture_proof: validatedArchitectureProof,
    regression_proof: validatedRegressionProof,
    iterative_proof: validatedIterativeProof,
    visual_proof: visualProof,
  }
}

function looksLikeDevReviewStatus(status = {}, workflow = {}, context = {}) {
  const wantedStateKey = lifecycleDevReviewStateKey(context)
  const configuredStatusName = workflow?.states?.[wantedStateKey] || workflow?.statuses?.[wantedStateKey]
  if (configuredStatusName && statusMatches(status, configuredStatusName)) return true
  return normalize(status?.name) === "dev review"
}

function looksLikeDoneStatus(status = {}, workflow = {}) {
  const doneNames = [
    workflow?.states?.done,
    workflow?.statuses?.done,
    workflow?.states?.released,
    workflow?.statuses?.released,
    "Done",
    "Released in Prod",
  ].filter(Boolean)
  return doneNames.some((name) => statusMatches(status, name))
}

async function resolveLifecycleStatus(projectID, workflow = {}, stateKey, fallbackStatusNames = []) {
  const statuses = await fetchAllStatuses(projectID)
  const configured = stateKey
    ? workflow?.states?.[stateKey] || workflow?.statuses?.[stateKey]
    : undefined
  const selectors = [configured, ...fallbackStatusNames].filter(Boolean)
  if (!selectors.length) return undefined
  return statuses.find((status) => selectors.some((selector) => statusMatches(status, selector)))
}

// ─────────────────────────────────────────────────────────────────────────────
// Global report standard

/**
 * Returns the effective reporting configuration from the loaded policy,
 * with safe defaults when no reporting section is present.
 *
 * @param {object|null} policy - the loaded policy document (or null)
 * @returns {{ suppress_routine_status_comments: boolean, require_structured_report: boolean, require_playwright_proof_for_visual_changes: boolean, comment_template: string }}
 */
function reportingConfig(policy) {
  const defaults = {
    suppress_routine_status_comments: true,
    require_structured_report: true,
    require_playwright_proof_for_visual_changes: true,
    comment_template:
      "## What was done\n{summary}\n\n## Completed\n{completed_items}\n\n## Evidence / Tests\n{evidence}\n\n## How to verify\n{verification_steps}\n\n## Visual proof (Playwright screenshots)\n{visual_proof}",
  }
  if (!policy || typeof policy !== "object") return defaults
  return { ...defaults, ...(policy.reporting ?? {}) }
}

/**
 * Renders the global structured report template for AI-generated task comments.
 *
 * Rules (all sections are optional — omitted when blank):
 *  - summary           : one-line description of what happened
 *  - completed         : string[] — each item becomes a bullet
 *  - evidence          : free-form test/command output or reference
 *  - verification      : how to validate the change manually
 *  - visual_proof      : string[] of screenshot/video URLs
 *  - visual_required   : boolean — when true and visual_proof is empty,
 *                        shows a mandatory-proof warning
 *
 * Mandatory Playwright screenshot rule (from policy):
 *   When visual_required=true, the visual_proof section is ALWAYS included
 *   and warns loudly if no screenshots are attached.
 *
 * @param {{ summary?: string, completed?: string[], evidence?: string, verification?: string, visual_proof?: string[], visual_required?: boolean }} fields
 * @returns {string}
 */
function structuredReport({
  summary = "",
  completed = [],
  evidence = "",
  verification = "",
  visual_proof = [],
  visual_required = false,
} = {}) {
  const sections = []

  if (summary) {
    sections.push(`## What was done\n${summary}`)
  }

  if (completed.length) {
    const bullets = completed
      .map((item) => `- ${String(item).replace(/^[-•*]\s*/, "")}`)
      .join("\n")
    sections.push(`## Completed\n${bullets}`)
  }

  if (evidence) {
    sections.push(`## Evidence / Tests\n${evidence}`)
  }

  if (verification) {
    sections.push(`## How to verify\n${verification}`)
  }

  if (visual_required || visual_proof.length) {
    const proofText = visual_proof.length
      ? visual_proof.join("\n")
      : "⚠️ MANDATORY: Playwright screenshot proof required for this visual change — attach before marking Done."
    sections.push(`## Visual proof (Playwright screenshots)\n${proofText}`)
  }

  return sections.join("\n\n")
}

function automationConfig(policy, context = {}) {
  const defaults = {
    enabled: false,
    active_task_id: env("NIFTY_AUTOMATION_ACTIVE_TASK_ID", context) || null,
    parent_tasks: {
      auto_complete_when_subtasks_complete: false,
      comment_on_auto_complete: true,
    },
    subtasks: {
      auto_create_from_checklist: true,
    },
    completion: {
      sync_done_status_with_complete: true,
      require_explicit_close_trigger: true,
      close_confirmation_template: "close {task_id}",
    },
    progress_comments: {
      enabled: true,
      milestones: ["first_edit", "first_green_test", "push", "done"],
      edit_tools: AUTOMATION_DEFAULT_EDIT_TOOLS,
      test_command_patterns: AUTOMATION_DEFAULT_TEST_COMMAND_PATTERNS,
      push_command_patterns: AUTOMATION_DEFAULT_PUSH_COMMAND_PATTERNS,
      max_output_chars: 1000,
    },
    task_context_gate: {
      enabled: true,
      prompt_on_context_loss: true,
      hard_fail_if_unresolved: true,
      prompt: AUTOMATION_DEFAULT_TASK_CONTEXT_PROMPT,
    },
    playwright: {
      auto_capture_visual_proof: true,
      command: env("NIFTY_AUTOMATION_PLAYWRIGHT_COMMAND", context) || "",
      publish_command: env("NIFTY_AUTOMATION_PLAYWRIGHT_PUBLISH_COMMAND", context) || "",
      output_dir: env("NIFTY_AUTOMATION_PLAYWRIGHT_OUTPUT_DIR", context) || "test-results",
      timeout_ms: envInteger("NIFTY_AUTOMATION_PLAYWRIGHT_TIMEOUT_MS", 300000, context),
    },
  }
  const configured = policy?.automation && typeof policy.automation === "object"
    ? policy.automation
    : {}
  const configuredProgress = configured.progress_comments || {}
  const configuredTaskContextGate = configured.task_context_gate || {}
  const configuredPlaywright = configured.playwright || {}

  return {
    ...defaults,
    ...configured,
    active_task_id: env("NIFTY_AUTOMATION_ACTIVE_TASK_ID", context) || configured.active_task_id || defaults.active_task_id,
    parent_tasks: { ...defaults.parent_tasks, ...(configured.parent_tasks || {}) },
    subtasks: { ...defaults.subtasks, ...(configured.subtasks || {}) },
    completion: { ...defaults.completion, ...(configured.completion || {}) },
    progress_comments: {
      ...defaults.progress_comments,
      ...configuredProgress,
      milestones: Array.isArray(configuredProgress.milestones)
        ? configuredProgress.milestones
        : defaults.progress_comments.milestones,
      edit_tools: envList(
        "NIFTY_AUTOMATION_EDIT_TOOLS",
        Array.isArray(configuredProgress.edit_tools) ? configuredProgress.edit_tools : defaults.progress_comments.edit_tools,
        context,
      ),
      test_command_patterns: envList(
        "NIFTY_AUTOMATION_TEST_COMMAND_PATTERNS",
        Array.isArray(configuredProgress.test_command_patterns)
          ? configuredProgress.test_command_patterns
          : defaults.progress_comments.test_command_patterns,
        context,
      ),
      push_command_patterns: envList(
        "NIFTY_AUTOMATION_PUSH_COMMAND_PATTERNS",
        Array.isArray(configuredProgress.push_command_patterns)
          ? configuredProgress.push_command_patterns
          : defaults.progress_comments.push_command_patterns,
        context,
      ),
      max_output_chars: envInteger(
        "NIFTY_AUTOMATION_PROGRESS_MAX_OUTPUT_CHARS",
        configuredProgress.max_output_chars ?? defaults.progress_comments.max_output_chars,
        context,
      ),
    },
    task_context_gate: {
      ...defaults.task_context_gate,
      ...configuredTaskContextGate,
    },
    playwright: {
      ...defaults.playwright,
      ...configuredPlaywright,
      command: env("NIFTY_AUTOMATION_PLAYWRIGHT_COMMAND", context) || configuredPlaywright.command || defaults.playwright.command,
      publish_command: env("NIFTY_AUTOMATION_PLAYWRIGHT_PUBLISH_COMMAND", context)
        || configuredPlaywright.publish_command
        || defaults.playwright.publish_command,
      output_dir: env("NIFTY_AUTOMATION_PLAYWRIGHT_OUTPUT_DIR", context)
        || configuredPlaywright.output_dir
        || defaults.playwright.output_dir,
      timeout_ms: envInteger(
        "NIFTY_AUTOMATION_PLAYWRIGHT_TIMEOUT_MS",
        configuredPlaywright.timeout_ms ?? defaults.playwright.timeout_ms,
        context,
      ),
    },
  }
}

function automationProgressTrigger(toolName, args = {}, automation = {}) {
  if (!automation.enabled || !automation.progress_comments?.enabled) return false
  const milestones = new Set(automation.progress_comments.milestones || [])

  if (
    milestones.has("first_edit")
    && (automation.progress_comments.edit_tools || []).some((pattern) => matchesActionPattern(pattern, toolName))
  ) {
    return true
  }

  if (
    milestones.has("first_green_test")
    && toolName === "bash"
    && commandMatchesAutomationPattern(args.command, automation.progress_comments.test_command_patterns)
  ) {
    return true
  }

  if (
    milestones.has("push")
    && toolName === "bash"
    && commandMatchesAutomationPattern(args.command, automation.progress_comments.push_command_patterns)
  ) {
    return true
  }

  if (
    milestones.has("done")
    && ((toolName === "nifty_complete_task" && args.completed !== false)
      || (toolName === "nifty_update_task" && args.completed === true))
  ) {
    return true
  }

  return false
}

function extractAutomationTaskIDAnswer(answer) {
  if (typeof answer === "string") return answer.trim() || null
  if (!answer || typeof answer !== "object") return null

  const direct = answer.task_id || answer.taskID || answer.value || answer.text || answer.answer || null
  if (typeof direct === "string" && direct.trim()) return direct.trim()

  if (typeof answer.input === "string" && answer.input.trim()) return answer.input.trim()
  if (Array.isArray(answer.answers)) {
    const firstString = answer.answers.find((item) => typeof item === "string" && item.trim())
    if (firstString) return firstString.trim()
  }

  return null
}

async function promptForAutomationTaskID(context = {}, automation = {}) {
  const ask = context?.ask
  if (typeof ask !== "function") return null

  const prompt = automation.task_context_gate?.prompt || AUTOMATION_DEFAULT_TASK_CONTEXT_PROMPT
  const promptAttempts = [
    () => ask({
      question: prompt,
      label: "Active Task Card",
      placeholder: "MBC-462",
      required: true,
    }),
    () => ask(prompt),
  ]

  for (const invokeAsk of promptAttempts) {
    try {
      const answer = await invokeAsk()
      const taskID = extractAutomationTaskIDAnswer(answer)
      if (taskID) return taskID
    } catch {
      // Try the fallback ask signature; hard-fail decision is handled by caller.
    }
  }

  return null
}

async function enforceAutomationTaskContextGate({ toolName, args = {}, sessionState = {}, automation = {}, context = {} }) {
  const gate = automation.task_context_gate || {}
  if (gate.enabled === false) return null
  if (!automationProgressTrigger(toolName, args, automation)) return null

  const existingTaskID = sessionState.activeTaskID || automation.active_task_id || null
  if (existingTaskID) return existingTaskID

  let promptedTaskID = null
  if (gate.prompt_on_context_loss !== false) {
    promptedTaskID = await promptForAutomationTaskID(context, automation)
    if (promptedTaskID) {
      sessionState.activeTaskID = promptedTaskID
      return promptedTaskID
    }
  }

  if (gate.hard_fail_if_unresolved === false) return null

  throw Object.assign(
    new Error(
      [
        "[AutomationGate] Lost task-card context for autonomous progress update.",
        "Enter the active task card ID and retry.",
        "You can provide it by running nifty_get_task_full_context with the target task_id.",
      ].join(" "),
    ),
    { code: "NIFTY_AUTOMATION_TASK_CONTEXT_REQUIRED", toolName },
  )
}

function closeConfirmationForTask(taskID, automation = {}) {
  const template = automation.completion?.close_confirmation_template || "close {task_id}"
  return template.replaceAll("{task_id}", String(taskID || "").trim())
}

function assertExplicitCloseConfirmation(taskID, args = {}, context = {}) {
  const automation = automationConfig(loadPolicy(context), context)
  if (automation.completion?.require_explicit_close_trigger === false) return
  const expected = closeConfirmationForTask(taskID, automation)
  const actual = String(args.close_confirmation || "").trim()
  if (actual === expected) return

  throw new Error(
    [
      "Task completion is blocked while the task chat may still be active.",
      "Ask the user whether the task should be closed or moved to a review/staging lane.",
      `To close this task, retry with close_confirmation: "${expected}".`,
    ].join(" "),
  )
}

function checklistSubtasks(checklist = [], existingSubtasks = []) {
  const existing = new Set(
    (existingSubtasks || [])
      .map((item) => normalize(typeof item === "string" ? item : item?.name))
      .filter(Boolean),
  )
  const seen = new Set()
  return (checklist || [])
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item) => {
      const key = normalize(item)
      if (!key || existing.has(key) || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((name) => ({ name }))
}

function commandMatchesAutomationPattern(command, patterns = []) {
  const normalizedCommand = normalize(command)
  return (patterns || []).some((pattern) => normalizedCommand.includes(normalize(pattern)))
}

function extractTaskIDFromToolOutput(outputText) {
  try {
    const parsed = JSON.parse(outputText)
    if (!parsed || typeof parsed !== "object") return null
    return parsed.task_id || parsed.id || parsed.task?.id || parsed.response?.id || parsed.document?.task_id || null
  } catch {
    return null
  }
}

function automationSessionState(store, sessionID = "default") {
  const key = sessionID || "default"
  if (!store.has(key)) {
    store.set(key, {
      activeTaskID: null,
      postedMilestones: new Set(),
    })
  }
  return store.get(key)
}

function rememberAutomationTask(sessionState, args = {}, outputText = "", automation = {}) {
  const taskID = args.parent_task_id
    || args.task_id
    || args.id
    || extractTaskIDFromToolOutput(outputText)
    || automation.active_task_id
    || sessionState.activeTaskID
    || null
  if (taskID) sessionState.activeTaskID = taskID
  return sessionState.activeTaskID
}

function detectAutomationMilestones({ toolName, args = {}, sessionState = {}, automation = {} }) {
  if (!automation.enabled || !automation.progress_comments?.enabled) return []
  const taskID = sessionState.activeTaskID || args.parent_task_id || args.task_id || automation.active_task_id
  if (!taskID) return []

  const milestones = new Set(automation.progress_comments.milestones || [])
  const posted = sessionState.postedMilestones || new Set()
  const events = []

  if (
    milestones.has("first_edit")
    && (automation.progress_comments.edit_tools || []).some((pattern) => matchesActionPattern(pattern, toolName))
    && !posted.has(`${taskID}:first_edit`)
  ) {
    events.push("first_edit")
  }

  if (
    milestones.has("first_green_test")
    && toolName === "bash"
    && commandMatchesAutomationPattern(args.command, automation.progress_comments.test_command_patterns)
    && !posted.has(`${taskID}:first_green_test`)
  ) {
    events.push("first_green_test")
  }

  if (
    milestones.has("push")
    && toolName === "bash"
    && commandMatchesAutomationPattern(args.command, automation.progress_comments.push_command_patterns)
    && !posted.has(`${taskID}:push`)
  ) {
    events.push("push")
  }

  if (
    milestones.has("done")
    && ((toolName === "nifty_complete_task" && args.completed !== false)
      || (toolName === "nifty_update_task" && args.completed === true))
    && !posted.has(`${taskID}:done`)
  ) {
    events.push("done")
  }

  return events
}

function summarizeAutomationOutput(text, maxChars = 1000) {
  const trimmed = String(text || "").trim()
  if (!trimmed) return ""
  return trimmed.length <= maxChars ? trimmed : `${trimmed.slice(0, maxChars)}...`
}

function buildAutomationMilestoneReport(milestone, input = {}, output = "", automation = {}) {
  const evidenceParts = []
  if (input.args?.command) evidenceParts.push(`Command: ${input.args.command}`)
  const outputSummary = summarizeAutomationOutput(output, automation.progress_comments?.max_output_chars || 1000)
  if (outputSummary && milestone !== "first_edit") evidenceParts.push(outputSummary)

  switch (milestone) {
    case "first_edit":
      return structuredReport({
        summary: "First edit detected — implementation has started.",
        completed: [`First edit detected via ${input.toolName || input.tool || "unknown"}.`],
      })
    case "first_green_test":
      return structuredReport({
        summary: "First GREEN test recorded.",
        completed: [input.args?.command ? `Successful test command: ${input.args.command}` : "A successful test command completed."],
        evidence: evidenceParts.join("\n\n"),
      })
    case "push":
      return structuredReport({
        summary: "Changes pushed to remote.",
        completed: [input.args?.command ? `Push command: ${input.args.command}` : "A successful push completed."],
        evidence: evidenceParts.join("\n\n"),
      })
    case "done":
      return structuredReport({
        summary: "Task marked complete.",
        completed: ["Automation recorded the task as done."],
        evidence: evidenceParts.join("\n\n"),
      })
    default:
      return ""
  }
}

async function runAutomationCommand(command, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      cwd: options.cwd || process.cwd(),
      env: { ...process.env, ...(options.env || {}) },
      stdio: ["ignore", "pipe", "pipe"],
    })

    const stdout = []
    const stderr = []
    const timeout = setTimeout(() => {
      child.kill("SIGTERM")
      reject(new Error(`Automation command timed out: ${command}`))
    }, options.timeoutMs || 300000)

    child.stdout.on("data", (chunk) => stdout.push(String(chunk)))
    child.stderr.on("data", (chunk) => stderr.push(String(chunk)))
    child.once("error", (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once("close", (code) => {
      clearTimeout(timeout)
      if (code === 0) {
        resolve({ stdout: stdout.join(""), stderr: stderr.join(""), code })
        return
      }
      reject(new Error(`Automation command failed with exit code ${code}: ${command}\n${stderr.join("") || stdout.join("")}`))
    })
  })
}

function parseAutomationPublisherOutput(text = "") {
  const trimmed = String(text || "").trim()
  if (!trimmed) return { urls: [], nifty_file_ids: [] }

  try {
    const parsed = JSON.parse(trimmed)
    if (Array.isArray(parsed)) {
      return {
        urls: parsed.map((item) => String(item || "").trim()).filter((item) => /^https?:\/\//i.test(item)),
        nifty_file_ids: [],
      }
    }
    return {
      urls: (parsed.urls || []).map((item) => String(item || "").trim()).filter((item) => /^https?:\/\//i.test(item)),
      nifty_file_ids: (parsed.nifty_file_ids || []).map((item) => String(item || "").trim()).filter(Boolean),
    }
  } catch {
    return {
      urls: trimmed.split(/\r?\n/).map((item) => item.trim()).filter((item) => /^https?:\/\//i.test(item)),
      nifty_file_ids: [],
    }
  }
}

function collectArtifactFiles(rootDir, sinceMs = 0) {
  if (!rootDir || !existsSync(rootDir)) return []
  const files = []
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = join(directory, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
        continue
      }
      if (!/\.(png|jpe?g|webp|gif)$/i.test(entry.name)) continue
      const stat = statSync(fullPath)
      if (!sinceMs || stat.mtimeMs >= sinceMs) files.push(fullPath)
    }
  }
  walk(rootDir)
  return files
}

async function autoGenerateVisualProof(taskID, changedFiles = [], context = {}, automation = automationConfig(null, context), deps = {}) {
  if (!automation.enabled || !automation.playwright?.auto_capture_visual_proof) return null

  const captureCommand = deps.captureCommand || automation.playwright.command
  if (!captureCommand) return null

  const runCommand = deps.runCommand || runAutomationCommand
  const publishCommand = deps.publishCommand === undefined ? automation.playwright.publish_command : deps.publishCommand
  const cwd = context.directory || context.worktree || process.cwd()
  const startedAt = Date.now()

  const captureResult = await runCommand(captureCommand, {
    cwd,
    timeoutMs: automation.playwright.timeout_ms,
    env: {
      NIFTY_AUTOMATION_TASK_ID: taskID,
      NIFTY_AUTOMATION_CHANGED_FILES: JSON.stringify(changedFiles || []),
    },
  })

  let published = { urls: [], nifty_file_ids: [] }
  if (publishCommand) {
    const publishResult = await runCommand(publishCommand, {
      cwd,
      timeoutMs: automation.playwright.timeout_ms,
      env: {
        NIFTY_AUTOMATION_TASK_ID: taskID,
        NIFTY_AUTOMATION_CAPTURE_OUTPUT: captureResult.stdout,
      },
    })
    published = parseAutomationPublisherOutput(publishResult.stdout)
  }

  const artifactFiles = collectArtifactFiles(join(cwd, automation.playwright.output_dir), startedAt)

  return {
    visual_proof: [...published.urls],
    nifty_file_ids: published.nifty_file_ids,
    artifact_files: artifactFiles,
    capture_command: captureCommand,
  }
}

function commentExternalFiles(visualProof = []) {
  return (visualProof || []).filter((item) => /^https?:\/\//i.test(String(item || "").trim()))
}

async function maybeAutoCompleteParentTask(taskID, context = {}) {
  const automation = automationConfig(loadPolicy(context), context)
  if (!automation.enabled || !automation.parent_tasks?.auto_complete_when_subtasks_complete) return null

  const task = await niftyRequest(`/api/v1.0/tasks/${encodeURIComponent(taskID)}`)
  const parentTaskID = taskParentID(task)
  if (!parentTaskID) return null

  const parentContext = await fetchTaskFullContext(parentTaskID, { task_id: parentTaskID }, context)
  const subtasks = parentContext?.subtasks || []
  if (!subtasks.length || !subtasks.every((item) => item?.completed === true)) {
    return { parent_task_id: parentTaskID, completed: false }
  }

  if (automation.completion?.require_explicit_close_trigger) {
    return {
      parent_task_id: parentTaskID,
      completed: false,
      blocked: true,
      reason: `Explicit close confirmation required: ${closeConfirmationForTask(parentTaskID, automation)}`,
    }
  }

  await niftyRequest(`/api/v1.0/tasks/${encodeURIComponent(parentTaskID)}/complete`, {
    method: "POST",
    body: { completed: true },
  })

  if (automation.parent_tasks?.comment_on_auto_complete) {
    await postLifecycleComment(
      parentTaskID,
      structuredReport({
        summary: "Parent task auto-completed because all subtasks are complete.",
        completed: subtasks.map((item) => `Completed subtask: ${item?.name || item?.id || "unknown"}`),
      }),
    )
  }

  return {
    parent_task_id: parentTaskID,
    completed: true,
    subtask_count: subtasks.length,
  }
}

async function maybeSyncCompletionForStatus(taskID, targetStatus, workflow, context = {}, args = {}) {
  const automation = automationConfig(loadPolicy(context), context)
  if (!automation.enabled || !automation.completion?.sync_done_status_with_complete) return null
  if (!looksLikeDoneStatus(targetStatus, workflow)) return null

  assertExplicitCloseConfirmation(taskID, args, context)

  const response = await niftyRequest(`/api/v1.0/tasks/${encodeURIComponent(taskID)}/complete`, {
    method: "POST",
    body: { completed: true },
  })

  return { completed: true, response }
}

// ─────────────────────────────────────────────────────────────────────────────

async function postLifecycleComment(taskID, text, options = {}) {
  await niftyRequest("/api/v1.0/messages", {
    method: "POST",
    body: cleanObject({
      type: "text",
      task_id: taskID,
      text: botCommentText(text, options.botMarker !== false),
      external_files: options.externalFiles?.length ? options.externalFiles : undefined,
          nifty_files: options.niftyFiles?.length ? options.niftyFiles : undefined,
    }),
  })
}

async function maybeAutoAssignTask(taskID, task, policyState, context = {}) {
  if (!lifecycleAssignSelfEnabled(context)) return false
  if (taskAssigneeIDs(task).length) return false

  let assigneeIDs = lifecycleDefaultAssigneeIDs(context)
  if (!assigneeIDs.length) {
    if (!policyState.currentUserID) {
      const me = await niftyRequest("/api/v1.0/users/me")
      policyState.currentUserID = me?.id
    }
    if (policyState.currentUserID) assigneeIDs = [policyState.currentUserID]
  }
  if (!assigneeIDs.length) return false

  await niftyRequest(`/api/v1.0/tasks/${encodeURIComponent(taskID)}`, {
    method: "PUT",
    body: { assignees: assigneeIDs },
  })
  return true
}

function safeContextMetadata(context, payload) {
  if (!context || typeof context.metadata !== "function") return
  try {
    context.metadata("nifty:auto_context", payload)
  } catch {}

  try {
    context.metadata({
      title: payload.title || "Nifty auto context",
      metadata: payload,
    })
  } catch {}
}

function taskProjectSubtasks(task = {}, tasks = []) {
  const taskID = task?.id
  if (!taskID) return []
  return (tasks || []).filter((item) => {
    const parent = item?.task_id || item?.parent_task_id || item?.parent?.id
    return parent && String(parent) === String(taskID)
  })
}

function taskParentID(task = {}) {
  return task?.task_id || task?.parent_task_id || task?.parent?.id || null
}

function projectStatusSummary(tasks = [], statuses = []) {
  const namesByID = new Map((statuses || []).map((status) => [status.id, status.name]))
  const counts = {}
  for (const task of tasks || []) {
    const statusID = task?.task_group || task?.task_group_id || task?.task_group?.id
    const statusName = namesByID.get(statusID) || task?.task_group?.name || "unknown"
    counts[statusName] = (counts[statusName] || 0) + 1
  }
  return counts
}

async function fetchTaskFullContext(taskID, input = {}, context = {}) {
  const commentLimit = input.comment_limit || autoContextCommentLimit(context)
  const taskLimit = input.project_task_limit || autoContextTaskLimit(context)
  const workflow = await workflowForArgs(input, context)

  const task = enrichTaskCustomFields(
    await niftyRequest(`/api/v1.0/tasks/${encodeURIComponent(taskID)}`),
    workflow,
  )
  const projectID = getTaskProjectID(task)
  const [commentsResponse, projects, statuses, milestones, projectTasksResponse] = await Promise.all([
    niftyRequest("/api/v1.0/messages", {
      query: { task_id: taskID, limit: commentLimit, offset: 0 },
    }),
    projectID ? fetchAllProjects({ includeArchived: true }) : Promise.resolve([]),
    projectID ? fetchAllStatuses(projectID) : Promise.resolve([]),
    projectID ? fetchAllMilestones(projectID) : Promise.resolve([]),
    projectID
      ? niftyRequest("/api/v1.0/tasks", {
          query: {
            project_id: projectID,
            include_subtasks: "true",
            limit: taskLimit,
            offset: 0,
          },
        })
      : Promise.resolve({ tasks: [] }),
  ])

  const comments = commentsResponse?.items || commentsResponse?.messages || []
  const projectTasks = projectTasksResponse?.tasks || []
  const subtasks = taskProjectSubtasks(task, projectTasks)
  const project = projects.find((item) => item.id === projectID) || null

  return {
    task,
    project,
    workflow,
    project_id: projectID || null,
    comments,
    subtasks,
    statuses,
    milestones,
    project_status_counts: projectStatusSummary(projectTasks, statuses),
    project_task_sample_size: projectTasks.length,
    fetched_at: new Date().toISOString(),
  }
}

async function fetchProjectFullContext(input = {}, context = {}) {
  const taskLimit = input.task_limit || autoContextTaskLimit(context)
  const contextWithConfig = workflowContext(context, input.config_path)
  const resolved = await resolveProjectSelector(input, contextWithConfig)
  const projectID = resolved.project?.id
  if (!projectID) throw new Error("Unable to resolve project for full context")

  const [statuses, milestones, tasksResponse, docsResponse, validation] = await Promise.all([
    fetchAllStatuses(projectID),
    fetchAllMilestones(projectID),
    niftyRequest("/api/v1.0/tasks", {
      query: {
        project_id: projectID,
        include_subtasks: "false",
        limit: taskLimit,
        offset: 0,
      },
    }),
    niftyRequest("/api/v1.0/docs", {
      query: {
        project_id: projectID,
        limit: 100,
        offset: 0,
      },
    }).catch(() => ({ items: [] })),
    validateWorkflows(contextWithConfig).catch(() => ({ workflows: [] })),
  ])

  const tasks = tasksResponse?.tasks || []
  const docs = docsResponse?.items || docsResponse?.docs || []
  const workflowValidation = (validation?.workflows || []).find((item) => {
    if (resolved.workflowAlias && item.alias === resolved.workflowAlias) return true
    const selector = item?.project?.id || item?.project?.nice_id || item?.project?.name
    return selector && normalize(selector) === normalize(projectID)
  }) || null

  return {
    project: resolved.project,
    workflow_alias: resolved.workflowAlias || null,
    workflow: resolved.workflow || {},
    workflow_validation: workflowValidation,
    statuses,
    milestones,
    tasks,
    documents: docs,
    status_counts: projectStatusSummary(tasks, statuses),
    fetched_at: new Date().toISOString(),
  }
}

async function maybeAutoHydrateContext(toolName, args = {}, context = {}, policyState = {}) {
  if (!autoContextEnabled(context)) return

  if (args.task_id) {
    const cacheKey = `task:${args.task_id}`
    if (policyState.contextCache?.has(cacheKey)) {
      safeContextMetadata(context, {
        title: "Nifty full task context",
        task_context: policyState.contextCache.get(cacheKey),
        source: "cache",
        tool: toolName,
      })
      return
    }

    const taskContext = await fetchTaskFullContext(args.task_id, args, context)
    policyState.contextCache?.set(cacheKey, taskContext)
    policyState.bootstrappedTasks?.add(args.task_id)
    safeContextMetadata(context, {
      title: "Nifty full task context",
      task_context: taskContext,
      source: "live",
      tool: toolName,
    })
    return
  }

  if (args.project_id || args.project_name || args.project_nice_id || args.workflow_alias) {
    const selector = args.project_id || args.project_name || args.project_nice_id || args.workflow_alias
    const cacheKey = `project:${selector}`
    if (policyState.contextCache?.has(cacheKey)) {
      safeContextMetadata(context, {
        title: "Nifty full project context",
        project_context: policyState.contextCache.get(cacheKey),
        source: "cache",
        tool: toolName,
      })
      return
    }

    const projectContext = await fetchProjectFullContext(args, context)
    policyState.contextCache?.set(cacheKey, projectContext)
    policyState.bootstrappedProjects?.add(selector)
    if (args.project_id) policyState.bootstrappedProjects?.add(args.project_id)
    safeContextMetadata(context, {
      title: "Nifty full project context",
      project_context: projectContext,
      source: "live",
      tool: toolName,
    })
  }
}

async function maybeAutoStartLifecycle(toolName, args = {}, context = {}, policyState = {}) {
  if (!lifecyclePolicyEnabled(context)) return
  if (LIFECYCLE_AUTO_START_EXCLUDED_TOOLS.has(toolName)) return
  if (!LIFECYCLE_AUTO_START_TOOLS.has(toolName)) return
  if (!args.task_id) return
  if (policyState.startedTasks?.has(args.task_id)) return

  const task = await niftyRequest(`/api/v1.0/tasks/${encodeURIComponent(args.task_id)}`)
  if (task?.completed || task?.archived) return

  const projectID = getTaskProjectID(task)
  if (!projectID) return

  const workflow = await workflowForArgs(args, context)
  const currentStatus = { id: getTaskStatusID(task), name: task?.task_group?.name }
  if (looksLikeDevReviewStatus(currentStatus, workflow, context) || looksLikeDoneStatus(currentStatus, workflow)) {
    policyState.startedTasks?.add(args.task_id)
    return
  }

  const inProgress = await resolveLifecycleStatus(
    projectID,
    workflow,
    lifecycleInProgressStateKey(context),
    ["In Progress", "In progress", "Doing"],
  )
  if (!inProgress) return

  const alreadyInProgress = statusMatches({ id: getTaskStatusID(task), name: task?.task_group?.name }, inProgress.id)
    || statusMatches({ id: getTaskStatusID(task), name: task?.task_group?.name }, inProgress.name)

  if (!alreadyInProgress) {
    await niftyRequest(`/api/v1.0/tasks/${encodeURIComponent(args.task_id)}`, {
      method: "PUT",
      body: { task_group_id: inProgress.id },
    })
  }

  const assigned = await maybeAutoAssignTask(args.task_id, task, policyState, context)
  if (lifecycleStatusCommentsEnabled(context)) {
    await postLifecycleComment(
      args.task_id,
      [
        "Lifecycle policy auto-update:",
        `- Status set to ${inProgress.name}.`,
        assigned ? "- Assignee set automatically." : "- Assignee unchanged.",
      ].join("\n"),
    )
  }

  policyState.startedTasks?.add(args.task_id)
}

async function enforceDeliveryLifecyclePolicy(taskID, targetStatus, workflow, deliveryEvidence, context = {}) {
  if (!lifecyclePolicyEnabled(context) || !lifecycleDeliveryGateEnabled(context)) return
  if (!looksLikeDevReviewStatus(targetStatus, workflow, context)) return

  const policy = loadPolicy(context)

  const changedFiles = Array.isArray(deliveryEvidence?.changed_files) && deliveryEvidence.changed_files.length
    ? deliveryEvidence.changed_files
    : changedFilesFromGit(context)
  const visualRequired = requiresVisualProof(changedFiles)
  const evidenceForValidation = { ...(deliveryEvidence || {}) }
  let generatedVisualProof = null
  if (visualRequired && (!Array.isArray(evidenceForValidation.visual_proof) || evidenceForValidation.visual_proof.length === 0)) {
    generatedVisualProof = await autoGenerateVisualProof(
      taskID,
      changedFiles,
      context,
      automationConfig(policy, context),
    )
    if (generatedVisualProof?.visual_proof?.length) {
      evidenceForValidation.visual_proof = generatedVisualProof.visual_proof
    }
  }
  const validated = validateDeliveryEvidence(evidenceForValidation, { visualRequired, policy })

  const completedItems = [
    `Architecture integration: ${validated.architecture_proof}`,
    `RED proof: ${validated.red_proof}`,
    `GREEN proof: ${validated.green_proof}`,
    `Regression proof: ${validated.regression_proof}`,
    `Iterative validation: ${validated.iterative_proof}`,
    `Sad path proof: ${validated.sad_path_proof}`,
    changedFiles.length ? `Changed files: ${changedFiles.join(", ")}` : "Changed files: none detected",
  ]
  if (validated.notes) completedItems.push(`Notes: ${validated.notes}`)

  const report = structuredReport({
    summary: "Delivery gate passed — change is ready for Dev Review.",
    completed: completedItems,
    evidence: `Visual proof required: ${visualRequired ? "yes" : "no"}`,
    visual_proof: visualRequired ? (validated.visual_proof ?? []) : [],
    visual_required: visualRequired,
  })

  await postLifecycleComment(taskID, report, {
    externalFiles: visualRequired ? commentExternalFiles(validated.visual_proof) : undefined,
    niftyFiles: generatedVisualProof?.nifty_file_ids?.length ? generatedVisualProof.nifty_file_ids : undefined,
  })
}

/**
 * Inject RAG context into the tool call context metadata.
 * Best-effort: never throws, never blocks tool execution.
 * NIFTY_RAG_ENABLED must be true (default false) or this is a no-op.
 *
 * @param {string} toolName
 * @param {object} args
 * @param {object} context - tool call context
 * @param {object} policyState
 * @param {Function} [_ragFn] - injectable for tests (bypasses dynamic import)
 */
async function maybeInjectRagContext(toolName, args, context, policyState, _ragFn) {
  if (!envBoolean("NIFTY_RAG_ENABLED", false, context)) return
  try {
    const ragFn = _ragFn ?? (await import("./rag.mjs")).ragContextForTool
    const rag = await ragFn(toolName, args)
    if (rag.historical_context.length || rag.policy_citations.length) {
      safeContextMetadata(context, {
        title: "Nifty RAG context",
        rag_context: rag,
        tool: toolName,
      })
    }
  } catch {
    // RAG is best-effort. Failure never blocks tool execution.
  }
}

function withLifecyclePolicy(tools = {}, initContext = {}) {
  const policyState = {
    startedTasks: new Set(),
    currentUserID: null,
    contextCache: new Map(),
    // Bootstrap gate: records which task/project IDs have had full context resolved
    bootstrappedTasks: new Set(),
    bootstrappedProjects: new Set(),
    // Policy-as-code: loaded once per session, shared across all tool calls
    loadedPolicy: (() => {
      try {
        return loadPolicy(initContext)
      } catch {
        return null
      }
    })(),
    // Append-only policy audit log for this session
    auditLog: [],
  }

  return Object.fromEntries(
    Object.entries(tools).map(([name, definition]) => {
      if (!definition || typeof definition.execute !== "function") return [name, definition]
      return [
        name,
        {
          ...definition,
          async execute(args, context) {
            // 1. Central policy enforcement — hard-fail on deny (not best-effort)
            enforcePolicyGate(name, args, policyState, context)

            // 2. Mandatory context bootstrap gate — hard-fail if entity not yet resolved
            //    Share bootstrapState from context if an external caller provided it,
            //    otherwise fall back to policyState (standard single-session usage).
            const effectiveBootstrapState = context?.bootstrapState ?? policyState
            assertContextBootstrapped(name, args, effectiveBootstrapState, context)

            // 3. Auto context hydration — best-effort; registers bootstrap on success
            try {
              await maybeAutoHydrateContext(name, args, context, policyState)
            } catch {
              // Auto context hydration is best-effort for compatibility.
            }

            // 4. Auto lifecycle start — best-effort
            try {
              await maybeAutoStartLifecycle(name, args, context, policyState)
            } catch {
              // Auto lifecycle start is best-effort; delivery gate remains hard-fail.
            }

            // 5. RAG context injection — best-effort, never blocks tool execution
            try {
              await maybeInjectRagContext(name, args, context, policyState)
            } catch {
              // RAG is best-effort.
            }

            const result = await definition.execute(args, context)

            // 5. After a successful explicit full-context call, register bootstrap.
            //    This covers the case where the caller used the explicit tools
            //    (nifty_get_task_full_context / nifty_get_project_full_context)
            //    rather than relying on auto-hydration.
            if (name === "nifty_get_task_full_context" && args.task_id) {
              policyState.bootstrappedTasks.add(args.task_id)
              const effectiveBootstrap = context?.bootstrapState
              if (effectiveBootstrap) effectiveBootstrap.resolvedTasks?.add(args.task_id)
            }
            if (name === "nifty_get_project_full_context") {
              const pid = args.project_id || args.project_name || args.project_nice_id || args.workflow_alias
              if (pid) {
                policyState.bootstrappedProjects.add(pid)
                if (args.project_id) policyState.bootstrappedProjects.add(args.project_id)
              }
            }

            return result
          },
        },
      ]
    }),
  )
}

async function listTasksWithStatusNames(query, projectID) {
  const [statuses, response] = await Promise.all([
    fetchAllStatuses(projectID),
    niftyRequest("/api/v1.0/tasks", { query }),
  ])

  const tasks = response.tasks || []
  const statusesByID = statusMap(statuses)
  return {
    statuses,
    statusesByID,
    tasks,
    hasMore: response.hasMore,
  }
}

function ensureWorkflow(workflow, alias, context = {}) {
  if (!workflow) {
    throw new Error(
      `Workflow alias '${alias}' is not configured. Create ${configPath(context)} or provide project_id, project_name, or project_nice_id.`,
    )
  }
}

async function validateWorkflows(options = {}) {
  const config = await readWorkflowConfig(options)
  const workflows = getWorkflowAliasMap(config)
  const projects = await fetchAllProjects({ includeArchived: options.includeArchived })
  const defaultAlias = defaultWorkflowAlias(options)
  const aliases = Object.keys(workflows)
  const results = []

  for (const [alias, workflow] of Object.entries(workflows)) {
    const selector = workflow?.project?.id || workflow?.project?.name || workflow?.project?.nice_id || workflow?.project
    const project = projects.find((item) => projectMatches(item, selector))
    const errors = []
    const warnings = []
    const states = workflow?.states || workflow?.statuses || {}
    const lists = workflow?.lists || workflow?.milestones || {}
    const customFields = getWorkflowCustomFields(workflow)
    let statuses = []
    let milestones = []
    let sampledTasks = []

    if (!selector) {
      errors.push("project selector is missing")
    }

    if (!project) {
      errors.push(`project not found: ${selector || "<missing>"}`)
    } else {
      try {
        statuses = await fetchAllStatuses(project.id)
        milestones = await fetchAllMilestones(project.id)
        if (Object.keys(customFields).length) {
          const taskResponse = await niftyRequest("/api/v1.0/tasks", {
            query: { project_id: project.id, limit: 100, offset: 0 },
          })
          sampledTasks = taskResponse.tasks || []
        }
      } catch (error) {
        errors.push(`project metadata lookup failed: ${error.message}`)
      }
    }

    for (const [stateKey, statusName] of Object.entries(states)) {
      if (!statuses.some((status) => statusMatches(status, statusName))) {
        errors.push(`state '${stateKey}' status not found: ${statusName}`)
      }
    }

    for (const [listKey, listName] of Object.entries(lists)) {
      if (!milestones.some((milestone) => milestoneMatches(milestone, listName))) {
        errors.push(`list '${listKey}' milestone/list not found: ${listName}`)
      }
    }

    if (!states.ideas && !states.backlog) warnings.push("state 'ideas' or 'backlog' is not configured")
    if (!states.todo && !states.ready) warnings.push("state 'todo' or 'ready' is not configured")

    const observedFieldIDs = new Set(
      sampledTasks.flatMap((task) => (task.fields || []).map((field) => field?.id).filter(Boolean)),
    )
    const customFieldResults = Object.fromEntries(
      Object.entries(customFields).map(([key, field]) => [
        key,
        cleanWriteObject({
          id: field?.id,
          name: field?.name,
          type: field?.type,
          values: field?.values,
          observed_on_sampled_tasks: field?.id ? observedFieldIDs.has(field.id) : false,
        }),
      ]),
    )

    results.push({
      alias,
      default: alias === defaultAlias,
      ok: errors.length === 0,
      project_selector: selector || null,
      project: project
        ? { id: project.id, name: project.name, nice_id: project.nice_id, archived: project.archived }
        : null,
      states,
      lists,
      custom_fields: customFieldResults,
      statuses: statuses.map((status) => ({ id: status.id, name: status.name })),
      milestones: milestones.map((milestone) => ({
        id: milestone.id,
        name: milestone.name,
        is_list: milestone.is_list,
      })),
      errors,
      warnings,
    })
  }

  return {
    ok: results.every((item) => item.ok) && (!defaultAlias || aliases.includes(defaultAlias)),
    config_path: configPath(options),
    default_workflow: defaultAlias || null,
    default_workflow_found: defaultAlias ? aliases.includes(defaultAlias) : null,
    workflows: results,
  }
}

async function niftyRequest(path, options = {}) {
  const token = await getAccessToken()
  const { query, body, headers, ...rest } = options
  const hasBody = Object.prototype.hasOwnProperty.call(options, "body") && body !== undefined
  const url = new URL(path, API_BASE_URL)
  appendQueryParams(url, query)
  const method = rest.method || "GET"

  const response = await fetch(url, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(hasBody ? { body: JSON.stringify(body) } : {}),
  })

  return parseResponse(response, {
    method,
    path: `${url.pathname}${url.search}`,
  })
}

function json(value) {
  if (value === undefined) return "OK"
  return JSON.stringify(value, null, 2)
}

const __test = {
  appendQueryParams,
  botCommentText,
  buildTaskDescription,
  buildShapedTaskDescription,
  configPath,
  defaultCaptureStateKey,
  enrichTaskCustomFields,
  filterTasksByStatus,
  filterTasksByCustomField,
  findMatchingProjects,
  getTaskProjectID,
  getTaskStatusID,
  customFieldPayload,
  getAuthPort,
  isTokenUsable,
  milestoneMatches,
  niftyShellCommandHint,
  normalize,
  parseEnvFile,
  parseJSONArg,
  missingShapingFields,
  nextShapingQuestion,
  projectMatches,
  projectConfigSelector,
  projectWorkflowConfigPath,
  assertNoOpenQuestions,
  requireBulkTaskConfirmation,
  requireSubtaskConfirmation,
  recommendedWorkflowConfig,
  recommendedWorkflowSummary,
  samePluginSource,
  requiresVisualProof,
  validateDeliveryEvidence,
  statusMatches,
  summarizeTask,
  writeWorkflowAliasConfig,
  workflowAlias,
  evaluatePolicy,
  assertContextBootstrapped,
  BOOTSTRAP_MUTATING_TASK_TOOLS,
  BOOTSTRAP_MUTATING_PROJECT_TOOLS,
  maybeInjectRagContext,
  lifecycleStatusCommentsEnabled,
  reportingConfig,
  structuredReport,
  automationConfig,
  detectAutomationMilestones,
  taskParentID,
  checklistSubtasks,
  autoGenerateVisualProof,
  resolveAuthNodeBinary,
  writeTokenCache,
}

export const NiftyPlugin = async () => {
  const customFieldArg = tool.schema.object({
    key: tool.schema.string().optional().describe("Configured workflow custom field key"),
    id: tool.schema.string().optional().describe("Raw Nifty custom field ID"),
    value: tool.schema.string().optional().describe("Raw custom field value or configured value key"),
    value_key: tool.schema.string().optional().describe("Configured value key for select fields"),
  })
  const deliveryEvidenceArg = tool.schema.object({
    red_proof: tool.schema.string().optional().describe("RED proof command/output reference"),
    green_proof: tool.schema.string().optional().describe("GREEN proof command/output reference"),
    sad_path_proof: tool.schema.string().optional().describe("Sad-path verification evidence"),
    architecture_proof: tool.schema.string().optional().describe("How this change integrates with the existing architecture instead of hand-waving or adding a parallel path"),
    regression_proof: tool.schema.string().optional().describe("Regression tests or checks added/updated to lock the behavior"),
    iterative_proof: tool.schema.string().optional().describe("Iterative RED/GREEN/refactor or reproduce/fix/retest loop evidence"),
    visual_proof: tool.schema.array(tool.schema.string()).optional().describe("Screenshot/video URLs required when visual changes are detected"),
    changed_files: tool.schema.array(tool.schema.string()).optional().describe("Optional changed files list override for lifecycle gate detection"),
    notes: tool.schema.string().optional().describe("Optional delivery notes appended to lifecycle gate comment"),
  })
  const automationSessions = new Map()

  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "bash") return
      const hint = niftyShellCommandHint(output.args?.command)
      if (hint) throw new Error(hint)
    },

    "tool.execute.after": async (input = {}, result = {}) => {
      const toolName = input.tool || input.toolName || result.tool || ""
      const context = input.context || result.context || {}
      const automation = automationConfig(loadPolicy(context), context)
      if (!automation.enabled || !automation.progress_comments?.enabled) return

      const state = automationSessionState(automationSessions, input.sessionID || input.sessionId || "default")
      rememberAutomationTask(state, input.args || {}, result.output || result.text || "", automation)
      await enforceAutomationTaskContextGate({
        toolName,
        args: input.args || {},
        sessionState: state,
        automation,
        context,
      })
      const milestones = detectAutomationMilestones({
        toolName,
        args: input.args || {},
        sessionState: state,
        automation,
      })

      for (const milestone of milestones) {
        const taskID = state.activeTaskID || automation.active_task_id
        if (!taskID) continue
        const text = buildAutomationMilestoneReport(
          milestone,
          { ...input, toolName },
          result.output || result.text || "",
          automation,
        )
        if (!text) continue
        await postLifecycleComment(taskID, text)
        state.postedMilestones.add(`${taskID}:${milestone}`)
      }
    },

    tool: withLifecyclePolicy({
      nifty_update_plugin: tool({
        description: "Updates the installed Nifty plugin from GitHub. In OpenCode mode, updates the installed plugin file. In MCP mode (NIFTY_MCP_ROOT set), also updates mcp/mcp-server.mjs in the cloned repo.",
        args: {
          ref: tool.schema.string().default("main").describe("GitHub ref to install, usually main or a commit SHA"),
          force: tool.schema.boolean().default(false).describe("Run the installer even when the installed plugin already matches the ref"),
        },
        async execute(args, context) {
          const ref = args.ref || "main"
          const latestPluginURL = `${NIFTY_REPO_RAW_BASE}/${encodeURIComponent(ref)}/plugin/nifty.js`
          const latestInstallURL = `${NIFTY_REPO_RAW_BASE}/${encodeURIComponent(ref)}/scripts/install.sh`
          const latestMcpServerURL = `${NIFTY_REPO_RAW_BASE}/${encodeURIComponent(ref)}/mcp/mcp-server.mjs`

          const [latestPlugin, latestCommit] = await Promise.all([
            fetchText(latestPluginURL),
            fetchLatestCommit(ref),
          ])
          const currentPlugin = currentPluginSource()

          // Detect MCP mode: NIFTY_MCP_ROOT points to the root of the cloned repo
          const mcpRoot = process.env.NIFTY_MCP_ROOT
          let mcpUpdated = false
          let mcpUpdateError = null

          if (mcpRoot) {
            try {
              const latestMcpServer = await fetchText(latestMcpServerURL)
              const mcpServerPath = join(mcpRoot, "mcp", "mcp-server.mjs")
              const currentMcpServer = existsSync(mcpServerPath) ? readFileSync(mcpServerPath, "utf8") : ""
              if (args.force || currentMcpServer.trim() !== latestMcpServer.trim()) {
                await writeFile(mcpServerPath, latestMcpServer, { encoding: "utf8" })
                mcpUpdated = true
              }
            } catch (err) {
              mcpUpdateError = err instanceof Error ? err.message : String(err)
            }
          }

          if (!args.force && samePluginSource(currentPlugin, latestPlugin) && !mcpUpdated) {
            return json({
              ok: true,
              updated: false,
              mcp_updated: false,
              ref,
              latest_commit: latestCommit,
              message: "No new Nifty plugin or MCP server version is available.",
              restart_required: false,
            })
          }

          const installScript = await fetchText(latestInstallURL)
          const installer_output = await runInstallScript(installScript, ref, context)

          const messages = ["Nifty plugin updated. Restart OpenCode so it loads the new plugin version."]
          if (mcpUpdated) messages.push("MCP server updated. Restart the MCP server process to apply changes.")
          if (mcpUpdateError) messages.push(`MCP server update warning: ${mcpUpdateError}`)

          return json({
            ok: true,
            updated: true,
            mcp_updated: mcpUpdated,
            mcp_root: mcpRoot || null,
            mcp_update_error: mcpUpdateError || null,
            ref,
            latest_commit: latestCommit,
            restart_required: true,
            message: messages.join(" "),
            installer_output,
          })
        },
      }),

      nifty_auth_help: tool({
        description: "Shows how to authorize the Nifty plugin",
        args: {},
        async execute(_args, context) {
          const config = getClientConfig(context)
          const cached = await readTokenCache()
          return [
            "Nifty plugin setup:",
            "1. In Nifty, create an API app and collect Client ID, Client Secret, Redirect URL, and Authorize URL.",
            "2. Export these vars before starting OpenCode:",
            "   NIFTY_CLIENT_ID",
            "   NIFTY_CLIENT_SECRET",
            "   NIFTY_REDIRECT_URI",
            "   NIFTY_AUTHORIZE_URL",
            "3. Open the authorize URL in a browser, approve the app, and copy the returned code from the redirect URL.",
            "4. Run nifty_auth_exchange_code with that code once.",
            "",
            `Authorize URL: ${config.authorizeURL || "not set"}`,
            `Redirect URI: ${config.redirectURI || "not set"}`,
            `Cached refresh token: ${cached?.refresh_token ? "yes" : "no"}`,
            `Env access token override: ${config.accessToken ? "yes" : "no"}`,
          ].join("\n")
        },
      }),

      nifty_auth_exchange_code: tool({
        description: "Exchanges a Nifty authorization code for tokens",
        args: {
          code: tool.schema.string().describe("Authorization code returned by Nifty"),
        },
        async execute(args, context) {
          const config = getClientConfig(context)
          if (!config.redirectURI) {
            throw new Error("Missing NIFTY_REDIRECT_URI.")
          }

          const token = await requestToken({
            grant_type: "authorization_code",
            code: args.code,
            redirect_uri: config.redirectURI,
          }, context)

          return json({
            ok: true,
            token_type: token.token_type,
            scope: token.scope,
            expires_at: new Date(token.expires_at).toISOString(),
            token_cache: TOKEN_PATH,
          })
        },
      }),

      nifty_auth_localhost_login: tool({
        description: "Starts a localhost callback server and completes Nifty auth",
        args: {
          host: tool.schema.string().default("127.0.0.1").describe("Local host to listen on"),
          port: tool.schema.number().int().min(1).max(65535).optional().describe("Local port to listen on; defaults to NIFTY_AUTH_PORT or 8787"),
        },
        async execute(args, context) {
          const port = getAuthPort(context, args.port)
          await assertPortAvailable(args.host, port)
          const state = createOAuthState()
          const authorizeURL = getAuthorizeURL(args.host, port, state, context)
          const redirectURI = getLocalRedirectURI(args.host, port)

          context.metadata({
            title: "Authorize Nifty in browser",
            metadata: {
              authorizeURL,
              redirectURI,
            },
          })

          const code = await waitForAuthorizationCode(args.host, port, context.abort, state)
          const token = await requestToken({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectURI,
          }, context)

          return [
            "Open this URL in your browser to finish connecting Nifty:",
            authorizeURL,
            "",
            json({
              ok: true,
              token_type: token.token_type,
              scope: token.scope,
              expires_at: new Date(token.expires_at).toISOString(),
              token_cache: TOKEN_PATH,
            }),
          ].join("\n")
        },
      }),

      nifty_auth_localhost_start: tool({
        description: "Starts localhost Nifty auth in the background and immediately returns the browser URL",
        args: {
          host: tool.schema.string().default("127.0.0.1").describe("Local host to listen on"),
          port: tool.schema.number().int().min(1).max(65535).optional().describe("Local port to listen on; defaults to NIFTY_AUTH_PORT or 8787"),
        },
        async execute(args, context) {
          const port = getAuthPort(context, args.port)
          await assertPortAvailable(args.host, port)
          const state = createOAuthState()
          const authorizeURL = getAuthorizeURL(args.host, port, state, context)
          const redirectURI = await startBackgroundAuthorizationServer(args.host, port, state, context)

          return [
            "Open this URL in your browser to finish connecting Nifty:",
            authorizeURL,
            "",
            "The callback server is running in the background for 10 minutes.",
            `Redirect URI: ${redirectURI}`,
            `Token cache: ${TOKEN_PATH}`,
            `Auth server log: ${AUTH_LOG_PATH}`,
          ].join("\n")
        },
      }),

      nifty_me: tool({
        description: "Gets the current Nifty user",
        args: {},
        async execute() {
          const response = await niftyRequest("/api/v1.0/users/me")
          return json(response)
        },
      }),

      nifty_list_projects: tool({
        description: "Lists Nifty projects",
        args: {
          subteam_id: tool.schema.string().optional().describe("Optional portfolio or subteam ID"),
          archived: tool.schema.boolean().optional().describe("List archived projects instead of active ones"),
          limit: tool.schema.number().int().min(1).max(100).optional().describe("Page size"),
          offset: tool.schema.number().int().min(0).optional().describe("Pagination offset"),
          sort: tool.schema.enum(["ascending", "descending"]).optional().describe("Sort order"),
        },
        async execute(args) {
          const response = await niftyRequest("/api/v1.0/projects", {
            query: cleanObject({
              subteam_id: args.subteam_id,
              archived: args.archived === undefined ? undefined : String(args.archived),
              limit: args.limit,
              offset: args.offset,
              sort: args.sort,
            }),
          })
          return json(response)
        },
      }),

      nifty_find_project: tool({
        description: "Searches Nifty projects by name, nice ID, or project ID",
        args: {
          query: tool.schema.string().describe("Project search text, nice ID, or project ID"),
          include_archived: tool.schema.boolean().optional().describe("Include archived projects"),
          limit: tool.schema.number().int().min(1).max(100).optional().describe("Maximum matches to return"),
        },
        async execute(args) {
          const projects = await fetchAllProjects({ includeArchived: args.include_archived })
          const matches = findMatchingProjects(projects, args.query).slice(0, args.limit || 25)

          return json({
            query: args.query,
            count: matches.length,
            projects: matches.map((project) => ({
              id: project.id,
              nice_id: project.nice_id,
              name: project.name,
              archived: project.archived,
              subteam: project.subteam,
            })),
          })
        },
      }),

      nifty_get_project_full_context: tool({
        description: "Gets comprehensive project context including statuses, milestones, workflow mapping, tasks, and documents",
        args: {
          workflow_alias: tool.schema.string().optional().describe("Workflow alias used to resolve project and mapping"),
          config_path: tool.schema.string().optional().describe("Explicit workflow config path; defaults to the OpenCode project directory"),
          project_id: tool.schema.string().optional().describe("Project ID"),
          project_name: tool.schema.string().optional().describe("Project name"),
          project_nice_id: tool.schema.string().optional().describe("Project nice ID"),
          task_limit: tool.schema.number().int().min(1).max(500).optional().describe("Maximum tasks to include in project snapshot"),
        },
        async execute(args, context) {
          const fullContext = await fetchProjectFullContext(args, context)
          return json(fullContext)
        },
      }),

      nifty_list_members: tool({
        description: "Lists Nifty workspace members",
        args: {},
        async execute() {
          const response = await niftyRequest("/api/v1.0/members")
          return json(response)
        },
      }),

      nifty_list_statuses: tool({
        description: "Lists task statuses for a project",
        args: {
          project_id: tool.schema.string().describe("Project ID"),
          archived: tool.schema.boolean().optional().describe("Include archived statuses"),
          limit: tool.schema.number().int().min(1).max(100).optional().describe("Page size"),
          offset: tool.schema.number().int().min(0).optional().describe("Pagination offset"),
          sort: tool.schema.enum(["ascending", "descending"]).optional().describe("Sort order"),
        },
        async execute(args) {
          const response = await niftyRequest("/api/v1.0/taskgroups", {
            query: cleanObject({
              project_id: args.project_id,
              archived: args.archived ?? false,
            }),
          })
          return json(response)
        },
      }),

      nifty_delete_status: tool({
        description: "Deletes a Nifty task status/task group by ID",
        args: {
          status_id: tool.schema.string().describe("Status or task group ID"),
        },
        async execute(args) {
          const response = await niftyRequest(`/api/v1.0/taskgroups/${encodeURIComponent(args.status_id)}`, {
            method: "DELETE",
          })
          return json(response)
        },
      }),

      nifty_list_milestones: tool({
        description: "Lists Nifty milestones or lists for a project",
        args: {
          project_id: tool.schema.string().describe("Project ID"),
          is_list: tool.schema.boolean().optional().describe("Only return Nifty lists when true, milestones when false"),
          limit: tool.schema.number().int().min(1).max(100).optional().describe("Page size"),
          offset: tool.schema.number().int().min(0).optional().describe("Pagination offset"),
          sort: tool.schema.enum(["ascending", "descending"]).optional().describe("Sort order"),
        },
        async execute(args) {
          const response = await niftyRequest("/api/v1.0/milestones", {
            query: cleanObject({
              project_id: args.project_id,
              is_list: args.is_list === undefined ? undefined : String(args.is_list),
              limit: args.limit || 100,
              offset: args.offset || 0,
              sort: args.sort || "ascending",
            }),
          })
          return json(response)
        },
      }),

      nifty_get_milestone: tool({
        description: "Gets a Nifty milestone or list by ID",
        args: {
          milestone_id: tool.schema.string().describe("Milestone or list ID"),
        },
        async execute(args) {
          const response = await niftyRequest(`/api/v1.0/milestones/${encodeURIComponent(args.milestone_id)}`)
          return json(response)
        },
      }),

      nifty_create_milestone: tool({
        description: "Creates a Nifty milestone or list",
        args: {
          project_id: tool.schema.string().describe("Project ID"),
          name: tool.schema.string().describe("Milestone/list name"),
          description: tool.schema.string().optional().describe("Milestone/list description"),
          is_list: tool.schema.boolean().optional().describe("Create as Nifty list"),
          task_group_id: tool.schema.string().optional().describe("Task group/status ID"),
          start: tool.schema.string().optional().describe("Start date, ISO format"),
          end: tool.schema.string().optional().describe("End date, ISO format"),
          dependency: tool.schema.string().optional().describe("Dependency milestone ID"),
        },
        async execute(args) {
          const response = await niftyRequest("/api/v1.0/milestones", {
            method: "POST",
            body: cleanObject({
              project_id: args.project_id,
              name: args.name,
              description: args.description || "",
              is_list: args.is_list,
              task_group_id: args.task_group_id,
              start: args.start,
              end: args.end,
              dependency: args.dependency,
            }),
          })
          return json(response)
        },
      }),

      nifty_update_milestone: tool({
        description: "Updates a Nifty milestone or list",
        args: {
          milestone_id: tool.schema.string().describe("Milestone or list ID"),
          name: tool.schema.string().optional().describe("Milestone/list name"),
          description: tool.schema.string().optional().describe("Milestone/list description"),
          is_list: tool.schema.boolean().optional().describe("Whether this is a Nifty list"),
          start: tool.schema.string().optional().describe("Start date, ISO format"),
          end: tool.schema.string().optional().describe("End date, ISO format"),
          dependency: tool.schema.string().optional().describe("Dependency milestone ID"),
        },
        async execute(args) {
          const response = await niftyRequest(`/api/v1.0/milestones/${encodeURIComponent(args.milestone_id)}`, {
            method: "PUT",
            body: cleanObject({
              name: args.name,
              description: args.description,
              is_list: args.is_list,
              start: args.start,
              end: args.end,
              dependency: args.dependency,
            }),
          })
          return json(response)
        },
      }),

      nifty_update_milestone_tasks: tool({
        description: "Adds or removes tasks from a Nifty milestone/list",
        args: {
          milestone_id: tool.schema.string().describe("Milestone or list ID"),
          task_ids: tool.schema.array(tool.schema.string()).describe("Task IDs to add or remove"),
          mode: tool.schema.enum(["add", "remove"]).describe("Whether to add or remove tasks"),
        },
        async execute(args) {
          const response = await niftyRequest(`/api/v1.0/milestones/${encodeURIComponent(args.milestone_id)}/tasks`, {
            method: args.mode === "add" ? "PUT" : "DELETE",
            body: { tasks: args.task_ids },
          })
          return json(response)
        },
      }),

      nifty_list_labels: tool({
        description: "Lists Nifty labels/tags",
        args: {
          type: tool.schema.number().int().optional().describe("0 for task labels, 1 for member labels"),
          limit: tool.schema.number().int().min(1).max(100).optional().describe("Page size"),
          offset: tool.schema.number().int().min(0).optional().describe("Pagination offset"),
        },
        async execute(args) {
          const response = await niftyRequest("/api/v1.0/labels", {
            query: cleanObject({
              type: args.type,
              limit: args.limit || 100,
              offset: args.offset || 0,
            }),
          })
          return json(response)
        },
      }),

      nifty_create_label: tool({
        description: "Creates a Nifty label/tag",
        args: {
          name: tool.schema.string().describe("Label name"),
          color: tool.schema.string().describe("Hex color, for example #4A90D9"),
          type: tool.schema.number().int().optional().describe("0 for task labels, 1 for member labels"),
        },
        async execute(args) {
          const response = await niftyRequest("/api/v1.0/labels", {
            method: "POST",
            body: cleanObject({ name: args.name, color: args.color, type: args.type }),
          })
          return json(response)
        },
      }),

      nifty_update_label: tool({
        description: "Updates a Nifty label/tag",
        args: {
          label_id: tool.schema.string().describe("Label ID"),
          name: tool.schema.string().describe("Label name"),
          color: tool.schema.string().describe("Hex color, for example #E74C3C"),
        },
        async execute(args) {
          const response = await niftyRequest(`/api/v1.0/labels/${encodeURIComponent(args.label_id)}`, {
            method: "PUT",
            body: { name: args.name, color: args.color },
          })
          return json(response)
        },
      }),

      nifty_list_documents: tool({
        description: "Lists Nifty documents for a project, task, folder, or workflow alias",
        args: {
          workflow_alias: tool.schema.string().optional().describe("Workflow alias from the workflow config file, defaults to NIFTY_DEFAULT_WORKFLOW"),
          config_path: tool.schema.string().optional().describe("Explicit workflow config path; defaults to the OpenCode project directory"),
          project_id: tool.schema.string().optional().describe("Project ID"),
          project_name: tool.schema.string().optional().describe("Project name"),
          project_nice_id: tool.schema.string().optional().describe("Project nice ID"),
          task_id: tool.schema.string().optional().describe("Task ID"),
          parent_doc_id: tool.schema.string().optional().describe("Parent document ID"),
          folder_id: tool.schema.string().optional().describe("Folder ID"),
          author: tool.schema.string().optional().describe("Author ID"),
          name: tool.schema.string().optional().describe("Document name filter"),
          tag: tool.schema.string().optional().describe("Document tag filter"),
          limit: tool.schema.number().int().min(1).max(100).optional().describe("Page size"),
          offset: tool.schema.number().int().min(0).optional().describe("Pagination offset"),
          sort: tool.schema.enum(["ascending", "descending"]).optional().describe("Sort order"),
        },
        async execute(args, context) {
          const resolved = await resolveProjectSelector(
            {
              workflow_alias: args.workflow_alias,
              config_path: args.config_path,
              project_id: args.project_id,
              project_name: args.project_name,
              project_nice_id: args.project_nice_id,
            },
            context,
          )

          const response = await niftyRequest("/api/v1.0/docs", {
            query: cleanObject({
              project_id: resolved.project.id,
              task_id: args.task_id,
              parent_doc_id: args.parent_doc_id,
              folder_id: args.folder_id,
              author: args.author,
              name: args.name,
              tag: args.tag,
              limit: args.limit || 100,
              offset: args.offset || 0,
              sort: args.sort || "ascending",
            }),
          })
          return json({
            project: {
              id: resolved.project.id,
              name: resolved.project.name,
              nice_id: resolved.project.nice_id,
            },
            ...response,
          })
        },
      }),

      nifty_get_document: tool({
        description: "Gets a Nifty document by ID",
        args: {
          document_id: tool.schema.string().describe("Document ID"),
        },
        async execute(args) {
          const response = await niftyRequest(`/api/v1.0/docs/${encodeURIComponent(args.document_id)}`)
          return json(response)
        },
      }),

      nifty_create_document: tool({
        description: "Creates a Nifty project document",
        args: {
          name: tool.schema.string().describe("Document name"),
          workflow_alias: tool.schema.string().optional().describe("Workflow alias from the workflow config file, defaults to NIFTY_DEFAULT_WORKFLOW"),
          config_path: tool.schema.string().optional().describe("Explicit workflow config path; defaults to the OpenCode project directory"),
          project_id: tool.schema.string().optional().describe("Project ID"),
          project_name: tool.schema.string().optional().describe("Project name"),
          project_nice_id: tool.schema.string().optional().describe("Project nice ID"),
          parent_doc_id: tool.schema.string().optional().describe("Parent document ID"),
          folder_id: tool.schema.string().optional().describe("Folder ID"),
          folder_stack: tool.schema.array(tool.schema.string()).optional().describe("Folder path stack"),
          type: tool.schema.string().optional().describe("Document type"),
          subtype: tool.schema.string().optional().describe("Document subtype"),
          private: tool.schema.boolean().optional().describe("Whether the document is private"),
          access_type: tool.schema.number().int().optional().describe("Access type: 0, 1, or 2"),
          content_json: tool.schema.string().optional().describe("Raw Nifty document content as a JSON string"),
          content_text: tool.schema.string().optional().describe("Convenience plain-text content, converted to rich document content when content_json is omitted"),
          external_id: tool.schema.string().optional().describe("External ID"),
          order: tool.schema.number().optional().describe("Document order"),
        },
        async execute(args, context) {
          const resolved = await resolveProjectSelector(
            {
              workflow_alias: args.workflow_alias,
              config_path: args.config_path,
              project_id: args.project_id,
              project_name: args.project_name,
              project_nice_id: args.project_nice_id,
            },
            context,
          )
          const content = parseJSONArg(args.content_json, "content_json") || documentContentFromText(args.content_text)

          const response = await niftyRequest("/api/v1.0/docs", {
            method: "POST",
            body: cleanObject({
              name: args.name,
              project_id: resolved.project.id,
              parent_doc_id: args.parent_doc_id,
              folder_id: args.folder_id,
              folder_stack: args.folder_stack,
              type: args.type,
              subtype: args.subtype,
              private: args.private,
              access_type: args.access_type,
              content,
              external_id: args.external_id,
              order: args.order,
            }),
          })

          return json({
            project: {
              id: resolved.project.id,
              name: resolved.project.name,
              nice_id: resolved.project.nice_id,
            },
            document: response,
          })
        },
      }),

      nifty_update_document: tool({
        description: "Updates a Nifty document",
        args: {
          document_id: tool.schema.string().describe("Document ID"),
          name: tool.schema.string().optional().describe("Document name"),
          archived: tool.schema.boolean().optional().describe("Archive or unarchive the document"),
          access_type: tool.schema.number().int().optional().describe("Access type: 0, 1, or 2"),
          force: tool.schema.boolean().optional().describe("Force update flag"),
          content_json: tool.schema.string().optional().describe("Raw Nifty document content as a JSON string"),
          content_text: tool.schema.string().optional().describe("Convenience plain-text content, converted to rich document content when content_json is omitted"),
          folder_id: tool.schema.string().optional().describe("Folder ID"),
          folder_stack: tool.schema.array(tool.schema.string()).optional().describe("Folder path stack"),
          multipage: tool.schema.boolean().optional().describe("Whether this is a multipage document"),
          order: tool.schema.number().optional().describe("Document order"),
        },
        async execute(args) {
          const content = parseJSONArg(args.content_json, "content_json") || documentContentFromText(args.content_text)
          const response = await niftyRequest(`/api/v1.0/docs/${encodeURIComponent(args.document_id)}`, {
            method: "PUT",
            body: cleanObject({
              name: args.name,
              archived: args.archived,
              access_type: args.access_type,
              force: args.force,
              content,
              folder_id: args.folder_id,
              folder_stack: args.folder_stack,
              multipage: args.multipage,
              order: args.order,
            }),
          })
          return json(response)
        },
      }),

      nifty_delete_document: tool({
        description: "Deletes a Nifty document by ID",
        args: {
          document_id: tool.schema.string().describe("Document ID"),
        },
        async execute(args) {
          const response = await niftyRequest(`/api/v1.0/docs/${encodeURIComponent(args.document_id)}`, {
            method: "DELETE",
          })
          return json(response)
        },
      }),

      nifty_move_document: tool({
        description: "Moves a Nifty document to another project folder",
        args: {
          document_id: tool.schema.string().describe("Document ID"),
          workflow_alias: tool.schema.string().optional().describe("Target workflow alias, defaults to NIFTY_DEFAULT_WORKFLOW"),
          config_path: tool.schema.string().optional().describe("Explicit workflow config path; defaults to the OpenCode project directory"),
          project_id: tool.schema.string().optional().describe("Target project ID"),
          project_name: tool.schema.string().optional().describe("Target project name"),
          project_nice_id: tool.schema.string().optional().describe("Target project nice ID"),
          folder_id: tool.schema.string().describe("Target folder ID"),
          folder_stack: tool.schema.string().describe("Target folder stack"),
        },
        async execute(args, context) {
          const resolved = await resolveProjectSelector(
            {
              workflow_alias: args.workflow_alias,
              config_path: args.config_path,
              project_id: args.project_id,
              project_name: args.project_name,
              project_nice_id: args.project_nice_id,
            },
            context,
          )
          const response = await niftyRequest(
            `/api/v1.0/docs/${encodeURIComponent(args.document_id)}/move_to_project`,
            {
              method: "PUT",
              body: {
                project_id: resolved.project.id,
                folder_id: args.folder_id,
                folder_stack: args.folder_stack,
              },
            },
          )
          return json(response)
        },
      }),

      nifty_update_document_labels: tool({
        description: "Adds or removes labels from a Nifty document",
        args: {
          document_id: tool.schema.string().describe("Document ID"),
          label_ids: tool.schema.array(tool.schema.string()).describe("Label IDs to add or remove"),
          mode: tool.schema.enum(["add", "remove"]).describe("Whether to add or remove labels"),
        },
        async execute(args) {
          const response = await niftyRequest(`/api/v1.0/docs/${encodeURIComponent(args.document_id)}/labels`, {
            method: args.mode === "add" ? "PUT" : "DELETE",
            body: { labels: args.label_ids },
          })
          return json(response)
        },
      }),

      nifty_list_workflows: tool({
        description: "Lists configured Nifty workflow aliases and resolved projects",
        args: {
          config_path: tool.schema.string().optional().describe("Explicit workflow config path; defaults to the OpenCode project directory"),
        },
        async execute(args, context) {
          const contextWithConfig = workflowContext(context, args.config_path)
          const config = await readWorkflowConfig(contextWithConfig)
          const workflows = getWorkflowAliasMap(config)
          const projects = await fetchAllProjects()

          const items = Object.entries(workflows).map(([alias, workflow]) => {
            const project = projects.find((item) =>
              projectMatches(
                item,
                workflow?.project?.id || workflow?.project?.name || workflow?.project?.nice_id || workflow?.project,
              ),
            )

            return {
              alias,
              project_selector: workflow?.project || null,
              project_id: project?.id || null,
              project_name: project?.name || null,
              project_nice_id: project?.nice_id || null,
              states: workflow?.states || workflow?.statuses || {},
              lists: workflow?.lists || workflow?.milestones || {},
              custom_fields: getWorkflowCustomFields(workflow),
            }
          })

          return json({
            config_path: configPath(contextWithConfig),
            workflows: items,
          })
        },
      }),

      nifty_validate_workflows: tool({
        description: "Validates workflow aliases against real Nifty projects and statuses",
        args: {
          config_path: tool.schema.string().optional().describe("Explicit workflow config path; defaults to the OpenCode project directory"),
          include_archived: tool.schema.boolean().optional().describe("Include archived projects when resolving aliases"),
        },
        async execute(args, context) {
          const result = await validateWorkflows({
            config_path: args.config_path,
            includeArchived: args.include_archived,
            directory: context.directory,
            worktree: context.worktree,
          })
          return json(result)
        },
      }),

      nifty_health_check: tool({
        description: "Checks Nifty credentials, token access, workflow config, and default workflow readiness",
        args: {},
        async execute(_args, context) {
          const config = getClientConfig(context)
          const cached = await readTokenCache()
          const checks = {
            credentials: {
              client_id: Boolean(config.clientID),
              client_secret: Boolean(config.clientSecret),
              authorize_url: Boolean(config.authorizeURL),
              access_token_override: Boolean(config.accessToken),
              refresh_token_available: Boolean(config.refreshToken || cached?.refresh_token),
              cached_access_token_usable: isTokenUsable(cached),
            },
            api: { ok: false, error: null },
            workflows: null,
          }

          try {
            await niftyRequest("/api/v1.0/users/me")
            checks.api.ok = true
          } catch (error) {
            checks.api.error = error.message
          }

          try {
            checks.workflows = await validateWorkflows({
              directory: context.directory,
              worktree: context.worktree,
            })
          } catch (error) {
            checks.workflows = { ok: false, error: error.message }
          }

          return json({
            ok: checks.api.ok && checks.workflows?.ok !== false,
            token_cache: TOKEN_PATH,
            workflow_config: configPath(context),
            default_workflow: defaultWorkflowAlias(context) || null,
            checks,
          })
        },
      }),

      nifty_recommended_workflow: tool({
        description: "Shows the recommended Nifty lifecycle workflow and optional workflow config snippet",
        args: {
          workflow_alias: tool.schema.string().optional().describe("Workflow alias to use in the config snippet"),
          project_id: tool.schema.string().optional().describe("Project ID for the config snippet"),
          project_name: tool.schema.string().optional().describe("Project name for the config snippet"),
          project_nice_id: tool.schema.string().optional().describe("Project nice ID for the config snippet"),
        },
        async execute(args, context) {
          const project = cleanObject({
            id: args.project_id,
            name: args.project_name,
            nice_id: args.project_nice_id,
          })
          const alias = workflowAlias(args.workflow_alias, project, context)

          return json({
            ...recommendedWorkflowSummary(),
            workflow_alias: alias,
            config_snippet: recommendedWorkflowConfig(alias, projectConfigSelector(project)),
          })
        },
      }),

      nifty_setup_recommended_workflow: tool({
        description: "Dry-runs or creates the recommended Nifty statuses and lists for a project",
        args: {
          workflow_alias: tool.schema.string().optional().describe("Workflow alias for the returned config snippet"),
          project_id: tool.schema.string().optional().describe("Project ID"),
          project_name: tool.schema.string().optional().describe("Project name"),
          project_nice_id: tool.schema.string().optional().describe("Project nice ID"),
          dry_run: tool.schema.boolean().optional().describe("Plan only; defaults to true"),
          create_statuses: tool.schema.boolean().optional().describe("Create missing statuses; defaults to true"),
          create_lists: tool.schema.boolean().optional().describe("Create missing Nifty lists; defaults to true"),
          write_config: tool.schema.boolean().optional().describe("Write or merge the workflow alias into a project-local nifty-workflows.json"),
          config_path: tool.schema.string().optional().describe("Explicit workflow config path; defaults to the OpenCode project directory"),
          overwrite_config: tool.schema.boolean().optional().describe("Overwrite an existing alias in the config file; defaults to false"),
        },
        async execute(args, context) {
          const contextWithConfig = workflowContext(context, args.config_path)
          const resolved = await resolveProjectSelector(
            {
              workflow_alias: args.workflow_alias,
              config_path: args.config_path,
              project_id: args.project_id,
              project_name: args.project_name,
              project_nice_id: args.project_nice_id,
            },
            contextWithConfig,
          )
          const alias = workflowAlias(resolved.workflowAlias || args.workflow_alias, resolved.project, contextWithConfig)
          const plan = await recommendedWorkflowSetupPlan(resolved.project.id, {
            dryRun: args.dry_run !== false,
            createStatuses: args.create_statuses !== false,
            createLists: args.create_lists !== false,
          })
          const configSnippet = recommendedWorkflowConfig(alias, projectConfigSelector(resolved.project))
          const configWrite = args.write_config
            ? await writeWorkflowAliasConfig(
                projectWorkflowConfigPath(contextWithConfig, args.config_path),
                alias,
                configSnippet.workflows[alias],
                { overwrite: args.overwrite_config === true },
              )
            : null

          return json({
            workflow_alias: alias,
            project: {
              id: resolved.project.id,
              name: resolved.project.name || null,
              nice_id: resolved.project.nice_id || null,
            },
            ...plan,
            config_snippet: configSnippet,
            config_write: configWrite,
          })
        },
      }),

      nifty_shape_task: tool({
        description: "Guides feature shaping one question at a time, then updates or creates a fully shaped Nifty task",
        args: {
          task_id: tool.schema.string().optional().describe("Existing Nifty task ID to shape/update"),
          title: tool.schema.string().optional().describe("Proposed final task title"),
          idea: tool.schema.string().optional().describe("Short initial idea or existing rough description"),
          workflow_alias: tool.schema.string().optional().describe("Workflow alias for resolving project and target Shaped status"),
          config_path: tool.schema.string().optional().describe("Explicit workflow config path; defaults to the OpenCode project directory"),
          project_id: tool.schema.string().optional().describe("Project ID when creating a new task or resolving target status"),
          project_name: tool.schema.string().optional().describe("Project name when creating a new task"),
          project_nice_id: tool.schema.string().optional().describe("Project nice ID when creating a new task"),
          target_task_group_id: tool.schema.string().optional().describe("Explicit target status/task group ID; defaults to target_state_key when resolvable"),
          target_state_key: tool.schema.string().default("shaped").describe("Workflow state key to move/create into when finalizing"),
          target_status_name: tool.schema.string().optional().describe("Raw target status name override"),
          summary: tool.schema.string().optional().describe("Concise feature summary"),
          problem: tool.schema.string().optional().describe("Problem statement and affected users"),
          desired_outcome: tool.schema.string().optional().describe("Desired outcome after shipping"),
          user_experience: tool.schema.string().optional().describe("UX, screens, states, copy, and failure paths"),
          acceptance_criteria: tool.schema.array(tool.schema.string()).optional().describe("Acceptance criteria"),
          security_privacy: tool.schema.string().optional().describe("Security, privacy, permissions, auth, abuse, or data exposure notes"),
          performance: tool.schema.string().optional().describe("Performance, latency, scale, or resource considerations"),
          data_integrations: tool.schema.string().optional().describe("Data, API, database, migration, webhook, or third-party integration notes"),
          edge_cases: tool.schema.string().optional().describe("Edge cases, empty states, errors, permissions, or rollback cases"),
          implementation_notes: tool.schema.string().optional().describe("Implementation approach and technical constraints"),
          test_plan: tool.schema.string().optional().describe("Automated, manual, and regression test plan"),
          rollout: tool.schema.string().optional().describe("Rollout, flags, migrations, release notes, monitoring, or sequencing"),
          non_goals: tool.schema.string().optional().describe("Explicitly out-of-scope work"),
          proposed_subtasks: tool.schema.array(tool.schema.object({
            name: tool.schema.string(),
            description: tool.schema.string().optional(),
          })).optional().describe("Optional subtasks to create after user approval"),
          create_subtasks: tool.schema.boolean().default(false).describe("Create proposed subtasks while finalizing"),
          subtask_confirmation: tool.schema.string().optional().describe('Required when create_subtasks is true, for example "create 3 subtasks"'),
          finalize: tool.schema.boolean().default(false).describe("Update/create the Nifty task once all shaping fields are answered"),
        },
        async execute(args, context) {
          const existingTask = args.task_id
            ? await niftyRequest(`/api/v1.0/tasks/${encodeURIComponent(args.task_id)}`)
            : null
          const title = args.title || existingTask?.name || existingTask?.title
          const idea = args.idea || existingTask?.description || existingTask?.text || null
          const shapeInput = { ...args, title, idea }
          const missing = []
          if (!title) missing.push({ field: "title", question: "What should the final task title be?" })
          missing.push(...missingShapingFields(shapeInput).map((field) => ({ field: field.key, question: field.question })))

          const blueprint = {
            title: title || null,
            source_idea: idea || null,
            sections: summarizeShapingInput(shapeInput),
            proposed_subtasks: args.proposed_subtasks || [],
          }

          if (missing.length) {
            return json({
              ok: true,
              ready: false,
              next_question: missing[0],
              missing_fields: missing.map((item) => item.field),
              blueprint,
            })
          }

          const description = buildShapedTaskDescription(shapeInput)
          blueprint.description = description

          if (!args.finalize) {
            return json({
              ok: true,
              ready: true,
              next_question: null,
              message: "Shaping is complete. Review the blueprint, ask whether to create proposed subtasks, then re-run with finalize true when approved.",
              blueprint,
              subtask_confirmation_required: args.proposed_subtasks?.length
                ? `create ${args.proposed_subtasks.length} ${args.proposed_subtasks.length === 1 ? "subtask" : "subtasks"}`
                : null,
            })
          }

          const contextWithConfig = workflowContext(context, args.config_path)
          let resolved = null
          let projectID = args.project_id || (existingTask ? getTaskProjectID(existingTask) : undefined)
          if (args.workflow_alias || args.project_name || args.project_nice_id || (!projectID && !args.task_id)) {
            resolved = await resolveProjectSelector({
              workflow_alias: args.workflow_alias,
              config_path: args.config_path,
              project_id: args.project_id,
              project_name: args.project_name,
              project_nice_id: args.project_nice_id,
            }, contextWithConfig)
            projectID = resolved.project.id
          }

          let targetStatusID = args.target_task_group_id || undefined
          if (!targetStatusID && projectID && (args.target_state_key || args.target_status_name || resolved?.workflow)) {
            const targetStatus = await resolveStatusSelector(projectID, {
              workflow: resolved?.workflow,
              state_key: args.target_state_key || "shaped",
              status_name: args.target_status_name,
            })
            targetStatusID = targetStatus?.id
          }
          if (!targetStatusID && !args.task_id) {
            throw new Error("Target status missing. Provide target_task_group_id, workflow_alias with target_state_key, or project status_name.")
          }

          const taskResponse = args.task_id
            ? await niftyRequest(`/api/v1.0/tasks/${encodeURIComponent(args.task_id)}`, {
                method: "PUT",
                body: cleanWriteObject({ name: title, description, task_group_id: targetStatusID }),
              })
            : await niftyRequest("/api/v1.0/tasks", {
                method: "POST",
                body: cleanWriteObject({ name: title, task_group_id: targetStatusID, description }),
              })
          const parentTaskID = args.task_id || taskResponse.id || taskResponse.task_id
          const createdSubtasks = []

          if (args.create_subtasks && args.proposed_subtasks?.length) {
            requireSubtaskConfirmation(args.proposed_subtasks, args.subtask_confirmation)
            if (!parentTaskID) throw new Error("Unable to determine parent task ID for subtask creation.")
            const subtaskStatusID = targetStatusID || getTaskStatusID(existingTask)
            if (!subtaskStatusID) throw new Error("Unable to determine subtask status ID.")
            for (const subtask of args.proposed_subtasks) {
              createdSubtasks.push(await niftyRequest("/api/v1.0/tasks", {
                method: "POST",
                body: cleanWriteObject({
                  name: subtask.name,
                  description: subtask.description,
                  task_group_id: subtaskStatusID,
                  task_id: parentTaskID,
                }),
              }))
            }
          }

          return json({
            ok: true,
            ready: true,
            finalized: true,
            task: taskResponse,
            created_subtasks: createdSubtasks,
            proposed_subtasks_not_created: args.create_subtasks ? [] : (args.proposed_subtasks || []),
          })
        },
      }),

      nifty_list_workflow_tasks: tool({
        description: "Lists tasks for a configured workflow alias and optional state name",
        args: {
          workflow_alias: tool.schema.string().optional().describe("Workflow alias from the workflow config file, defaults to NIFTY_DEFAULT_WORKFLOW"),
          config_path: tool.schema.string().optional().describe("Explicit workflow config path; defaults to the OpenCode project directory"),
          state_key: tool.schema.string().optional().describe("Configured state key such as ideas or todo"),
          status_name: tool.schema.string().optional().describe("Raw status name override, for example Ideas or To Do"),
          list_key: tool.schema.string().optional().describe("Configured workflow list key"),
          list_name: tool.schema.string().optional().describe("Raw Nifty list/milestone name override"),
          milestone_id: tool.schema.string().optional().describe("Raw Nifty milestone/list ID override"),
          custom_field_key: tool.schema.string().optional().describe("Configured workflow custom field key to filter by"),
          custom_field_id: tool.schema.string().optional().describe("Raw Nifty custom field ID to filter by"),
          custom_field_value: tool.schema.string().optional().describe("Custom field value or configured value key to filter by"),
          include_completed: tool.schema.boolean().optional().describe("Include completed tasks"),
          include_subtasks: tool.schema.boolean().optional().describe("Include subtasks in the response"),
          limit: tool.schema.number().int().min(1).max(100).optional().describe("Page size"),
          offset: tool.schema.number().int().min(0).optional().describe("Pagination offset"),
        },
        async execute(args, context) {
          const contextWithConfig = workflowContext(context, args.config_path)
          const resolved = await resolveProjectSelector({ workflow_alias: args.workflow_alias, config_path: args.config_path }, contextWithConfig)
          ensureWorkflow(
            resolved.workflow,
            resolved.workflowAlias || args.workflow_alias || defaultWorkflowAlias(contextWithConfig),
            contextWithConfig,
          )

          const status = await resolveStatusSelector(resolved.project.id, {
            workflow: resolved.workflow,
            state_key: args.state_key,
            status_name: args.status_name,
          })
          const milestone = await resolveMilestoneSelector(resolved.project.id, {
            workflow: resolved.workflow,
            list_key: args.list_key,
            list_name: args.list_name,
            milestone_id: args.milestone_id,
          })

          const result = await listTasksWithStatusNames(
            cleanObject({
              project_id: resolved.project.id,
              task_group_id: status?.id,
              milestone_id: milestone?.id,
              completed:
                args.include_completed === undefined ? undefined : String(args.include_completed),
              include_subtasks:
                args.include_subtasks === undefined ? undefined : String(args.include_subtasks),
              limit: args.limit || 100,
              offset: args.offset || 0,
              sort: "ascending",
            }),
            resolved.project.id,
          )

          return json({
            workflow_alias: resolved.workflowAlias || args.workflow_alias || defaultWorkflowAlias(contextWithConfig) || null,
            project: {
              id: resolved.project.id,
              name: resolved.project.name,
              nice_id: resolved.project.nice_id,
            },
            status: status ? { id: status.id, name: status.name } : null,
            milestone: milestone ? { id: milestone.id, name: milestone.name } : null,
            tasks: filterTasksByCustomField(
              filterTasksByStatus(result.tasks, status?.id),
              resolved.workflow,
              args,
            ).map((task) => summarizeTask(task, result.statusesByID, resolved.workflow)),
            has_more: result.hasMore,
          })
        },
      }),

      nifty_capture_backlog_item: tool({
        description: "Creates a new workflow task, defaulting to the ideas state",
        args: {
          workflow_alias: tool.schema.string().optional().describe("Workflow alias from the workflow config file, defaults to NIFTY_DEFAULT_WORKFLOW"),
          config_path: tool.schema.string().optional().describe("Explicit workflow config path; defaults to the OpenCode project directory"),
          name: tool.schema.string().describe("Task name"),
          summary: tool.schema.string().optional().describe("Short summary of the idea"),
          problem: tool.schema.string().optional().describe("Problem the idea addresses"),
          desired_outcome: tool.schema.string().optional().describe("Desired outcome"),
          acceptance_criteria: tool.schema.array(tool.schema.string()).optional().describe("Acceptance criteria items"),
          implementation_notes: tool.schema.array(tool.schema.string()).optional().describe("Implementation notes"),
          open_questions: tool.schema.array(tool.schema.string()).optional().describe("Questions that must be answered by the user before creating the task"),
          checklist: tool.schema.array(tool.schema.string()).optional().describe("Execution checklist"),
          state_key: tool.schema.string().optional().describe("Workflow state key, defaults to ideas"),
          status_name: tool.schema.string().optional().describe("Raw status name override"),
          list_key: tool.schema.string().optional().describe("Configured workflow list key"),
          list_name: tool.schema.string().optional().describe("Raw Nifty list/milestone name override"),
          milestone_id: tool.schema.string().optional().describe("Raw Nifty milestone/list ID override"),
          assignee_ids: tool.schema.array(tool.schema.string()).optional().describe("Assignee member IDs"),
          label_ids: tool.schema.array(tool.schema.string()).optional().describe("Label IDs"),
          due_date: tool.schema.string().optional().describe("Due date, ISO format"),
          start_date: tool.schema.string().optional().describe("Start date, ISO format"),
          story_points: tool.schema.number().int().min(1).optional().describe("Story points"),
          custom_fields: tool.schema.array(customFieldArg).optional().describe("Custom fields to set, using workflow keys or raw Nifty field IDs"),
        },
        async execute(args, context) {
          assertNoOpenQuestions(args, "task")
          const contextWithConfig = workflowContext(context, args.config_path)
          const resolved = await resolveProjectSelector({ workflow_alias: args.workflow_alias, config_path: args.config_path }, contextWithConfig)
          ensureWorkflow(
            resolved.workflow,
            resolved.workflowAlias || args.workflow_alias || defaultWorkflowAlias(contextWithConfig),
            contextWithConfig,
          )

          const status = await resolveStatusSelector(resolved.project.id, {
            workflow: resolved.workflow,
            state_key: args.state_key || defaultCaptureStateKey(resolved.workflow),
            status_name: args.status_name,
          })
          const milestone = await resolveMilestoneSelector(resolved.project.id, {
            workflow: resolved.workflow,
            list_key: args.list_key,
            list_name: args.list_name,
            milestone_id: args.milestone_id,
          })

          const description = buildTaskDescription(args)
          const response = await niftyRequest("/api/v1.0/tasks", {
            method: "POST",
            body: cleanWriteObject({
              name: args.name,
              task_group_id: status.id,
              milestone_id: milestone?.id,
              description,
              due_date: args.due_date,
              start_date: args.start_date,
              assignees: args.assignee_ids,
              labels: args.label_ids,
              story_points: args.story_points,
              fields: customFieldPayload(resolved.workflow, args.custom_fields),
            }),
          })

          return json({
            workflow_alias: resolved.workflowAlias || args.workflow_alias || defaultWorkflowAlias(contextWithConfig) || null,
            project: {
              id: resolved.project.id,
              name: resolved.project.name,
            },
            status: { id: status.id, name: status.name },
            milestone: milestone ? { id: milestone.id, name: milestone.name } : null,
            task: response,
          })
        },
      }),

      nifty_batch_capture_backlog_items: tool({
        description: "Creates multiple standardized workflow idea/backlog items, with dry-run support",
        args: {
          workflow_alias: tool.schema.string().optional().describe("Workflow alias from the workflow config file, defaults to NIFTY_DEFAULT_WORKFLOW"),
          config_path: tool.schema.string().optional().describe("Explicit workflow config path; defaults to the OpenCode project directory"),
          state_key: tool.schema.string().optional().describe("Workflow state key, defaults to ideas"),
          status_name: tool.schema.string().optional().describe("Raw status name override"),
          list_key: tool.schema.string().optional().describe("Configured workflow list key"),
          list_name: tool.schema.string().optional().describe("Raw Nifty list/milestone name override"),
          milestone_id: tool.schema.string().optional().describe("Raw Nifty milestone/list ID override"),
          dry_run: tool.schema.boolean().optional().describe("Return planned creates without writing to Nifty"),
          items: tool.schema.array(tool.schema.object({
            name: tool.schema.string(),
            summary: tool.schema.string().optional(),
            problem: tool.schema.string().optional(),
            desired_outcome: tool.schema.string().optional(),
            acceptance_criteria: tool.schema.array(tool.schema.string()).optional(),
            implementation_notes: tool.schema.array(tool.schema.string()).optional(),
            open_questions: tool.schema.array(tool.schema.string()).optional(),
            checklist: tool.schema.array(tool.schema.string()).optional(),
            assignee_ids: tool.schema.array(tool.schema.string()).optional(),
            label_ids: tool.schema.array(tool.schema.string()).optional(),
            due_date: tool.schema.string().optional(),
            start_date: tool.schema.string().optional(),
            story_points: tool.schema.number().int().min(1).optional(),
            custom_fields: tool.schema.array(customFieldArg).optional(),
          })).describe("Items to create"),
        },
        async execute(args, context) {
          for (const item of args.items) {
            assertNoOpenQuestions(item, `task '${item.name}'`)
          }
          const contextWithConfig = workflowContext(context, args.config_path)
          const resolved = await resolveProjectSelector({ workflow_alias: args.workflow_alias, config_path: args.config_path }, contextWithConfig)
          ensureWorkflow(
            resolved.workflow,
            resolved.workflowAlias || args.workflow_alias || defaultWorkflowAlias(contextWithConfig),
            contextWithConfig,
          )

          const status = await resolveStatusSelector(resolved.project.id, {
            workflow: resolved.workflow,
            state_key: args.state_key || defaultCaptureStateKey(resolved.workflow),
            status_name: args.status_name,
          })
          const milestone = await resolveMilestoneSelector(resolved.project.id, {
            workflow: resolved.workflow,
            list_key: args.list_key,
            list_name: args.list_name,
            milestone_id: args.milestone_id,
          })

          const planned = args.items.map((item) => ({
            name: item.name,
            task_group_id: status.id,
            milestone_id: milestone?.id,
            description: buildTaskDescription(item),
            due_date: item.due_date,
            start_date: item.start_date,
            assignees: item.assignee_ids,
            labels: item.label_ids,
            story_points: item.story_points,
            fields: customFieldPayload(resolved.workflow, item.custom_fields),
          })).map(cleanWriteObject)

          if (args.dry_run) {
            return json({
              dry_run: true,
              workflow_alias: resolved.workflowAlias || args.workflow_alias || defaultWorkflowAlias(contextWithConfig) || null,
              project: { id: resolved.project.id, name: resolved.project.name },
              status: { id: status.id, name: status.name },
              milestone: milestone ? { id: milestone.id, name: milestone.name } : null,
              planned,
            })
          }

          const created = []
          for (const body of planned) {
            created.push(await niftyRequest("/api/v1.0/tasks", { method: "POST", body }))
          }

          return json({
            dry_run: false,
            workflow_alias: resolved.workflowAlias || args.workflow_alias || defaultWorkflowAlias(contextWithConfig) || null,
            project: { id: resolved.project.id, name: resolved.project.name },
            status: { id: status.id, name: status.name },
            milestone: milestone ? { id: milestone.id, name: milestone.name } : null,
            created,
          })
        },
      }),

      nifty_list_tasks: tool({
        description: "Lists Nifty tasks with filters",
        args: {
          workflow_alias: tool.schema.string().optional().describe("Workflow alias used to enrich/filter configured custom fields"),
          config_path: tool.schema.string().optional().describe("Explicit workflow config path; defaults to the OpenCode project directory"),
          project_id: tool.schema.string().optional().describe("Filter by project ID"),
          project_ids: tool.schema.array(tool.schema.string()).optional().describe("Filter by multiple project IDs"),
          task_group_id: tool.schema.string().optional().describe("Filter by status or task group ID"),
          task_id: tool.schema.string().optional().describe("Fetch one task through the list endpoint"),
          member_id: tool.schema.string().optional().describe("Filter by member ID"),
          milestone_id: tool.schema.string().optional().describe("Filter by milestone ID"),
          completed: tool.schema.boolean().optional().describe("Filter by completion state"),
          archived: tool.schema.boolean().optional().describe("Filter by archived state"),
          include_archived: tool.schema.boolean().optional().describe("Include archived tasks together with active tasks"),
          include_subtasks: tool.schema.boolean().optional().describe("Include subtasks in the response"),
          assignee_ids: tool.schema.array(tool.schema.string()).optional().describe("Filter by assignee IDs"),
          custom_field_key: tool.schema.string().optional().describe("Configured workflow custom field key to filter by"),
          custom_field_id: tool.schema.string().optional().describe("Raw Nifty custom field ID to filter by"),
          custom_field_value: tool.schema.string().optional().describe("Custom field value or configured value key to filter by"),
          limit: tool.schema.number().int().min(1).max(100).optional().describe("Page size"),
          offset: tool.schema.number().int().min(0).optional().describe("Pagination offset"),
          order: tool.schema.enum([
            "dueDate:ASC",
            "dueDate:DESC",
            "archivedOn:ASC",
            "archivedOn:DESC",
            "completedOn:ASC",
            "completedOn:DESC",
          ]).optional().describe("Primary sort field and direction"),
          sort: tool.schema.enum(["ascending", "descending"]).optional().describe("Secondary sort order"),
          from: tool.schema.string().optional().describe("Due date from, ISO format"),
          to: tool.schema.string().optional().describe("Due date to, ISO format"),
        },
        async execute(args, context) {
          const workflow = await workflowForArgs(args, context)
          const response = await niftyRequest("/api/v1.0/tasks", {
            query: cleanObject({
              project_id: args.project_id,
              project_ids: args.project_ids?.join(","),
              task_group_id: args.task_group_id,
              task_id: args.task_id,
              member_id: args.member_id,
              milestone_id: args.milestone_id,
              completed: args.completed === undefined ? undefined : String(args.completed),
              archived: args.archived === undefined ? undefined : String(args.archived),
              include_archived:
                args.include_archived === undefined ? undefined : String(args.include_archived),
              include_subtasks:
                args.include_subtasks === undefined ? undefined : String(args.include_subtasks),
              limit: args.limit,
              offset: args.offset,
              order: args.order,
              sort: args.sort,
              from: args.from,
              to: args.to,
              assignee_ids: args.assignee_ids,
            }),
          })
          const tasks = filterTasksByCustomField(response.tasks || [], workflow, args)
            .map((task) => enrichTaskCustomFields(task, workflow))
          return json({ ...response, tasks })
        },
      }),

      nifty_get_task: tool({
        description: "Gets a Nifty task by ID",
        args: {
          task_id: tool.schema.string().describe("Task ID"),
          workflow_alias: tool.schema.string().optional().describe("Workflow alias used to enrich configured custom fields"),
          config_path: tool.schema.string().optional().describe("Explicit workflow config path; defaults to the OpenCode project directory"),
        },
        async execute(args, context) {
          const workflow = await workflowForArgs(args, context)
          const response = await niftyRequest(`/api/v1.0/tasks/${encodeURIComponent(args.task_id)}`)
          return json(enrichTaskCustomFields(response, workflow))
        },
      }),

      nifty_get_task_full_context: tool({
        description: "Gets full task context including task details, comments, subtasks, status map, milestones, and project summary",
        args: {
          task_id: tool.schema.string().describe("Task ID"),
          workflow_alias: tool.schema.string().optional().describe("Workflow alias used to enrich configured custom fields"),
          config_path: tool.schema.string().optional().describe("Explicit workflow config path; defaults to the OpenCode project directory"),
          comment_limit: tool.schema.number().int().min(1).max(500).optional().describe("Maximum comments/messages to include"),
          project_task_limit: tool.schema.number().int().min(1).max(500).optional().describe("Maximum project tasks to sample for context"),
        },
        async execute(args, context) {
          const fullContext = await fetchTaskFullContext(args.task_id, args, context)
          return json(fullContext)
        },
      }),

      nifty_create_task: tool({
        description: "Creates a Nifty task",
        args: {
          workflow_alias: tool.schema.string().optional().describe("Workflow alias used to resolve configured custom fields"),
          config_path: tool.schema.string().optional().describe("Explicit workflow config path; defaults to the OpenCode project directory"),
          name: tool.schema.string().describe("Task name"),
          task_group_id: tool.schema.string().describe("Status or task group ID"),
          description: tool.schema.string().optional().describe("Task description"),
          parent_task_id: tool.schema.string().optional().describe("Parent task ID when creating a subtask"),
          milestone_id: tool.schema.string().optional().describe("Milestone ID"),
          due_date: tool.schema.string().optional().describe("Due date, ISO format"),
          start_date: tool.schema.string().optional().describe("Start date, ISO format"),
          assignee_ids: tool.schema.array(tool.schema.string()).optional().describe("Assignee member IDs"),
          label_ids: tool.schema.array(tool.schema.string()).optional().describe("Label IDs"),
          story_points: tool.schema.number().int().min(1).optional().describe("Story points"),
          custom_fields: tool.schema.array(customFieldArg).optional().describe("Custom fields to set, using workflow keys or raw Nifty field IDs"),
        },
        async execute(args, context) {
          const workflow = await workflowForArgs(args, context)
          const response = await niftyRequest("/api/v1.0/tasks", {
            method: "POST",
            body: cleanWriteObject({
              name: args.name,
              task_group_id: args.task_group_id,
              description: args.description,
              task_id: args.parent_task_id,
              milestone_id: args.milestone_id,
              due_date: args.due_date,
              start_date: args.start_date,
              assignees: args.assignee_ids,
              labels: args.label_ids,
              story_points: args.story_points,
              fields: customFieldPayload(workflow, args.custom_fields),
            }),
          })
          return json(response)
        },
      }),

      nifty_create_subtask: tool({
        description: "Creates a Nifty subtask under an existing parent task",
        args: {
          workflow_alias: tool.schema.string().optional().describe("Workflow alias used to resolve configured custom fields"),
          config_path: tool.schema.string().optional().describe("Explicit workflow config path; defaults to the OpenCode project directory"),
          parent_task_id: tool.schema.string().describe("Parent task ID"),
          name: tool.schema.string().describe("Subtask name"),
          task_group_id: tool.schema.string().describe("Status or task group ID"),
          description: tool.schema.string().optional().describe("Subtask description"),
          milestone_id: tool.schema.string().optional().describe("Milestone ID"),
          due_date: tool.schema.string().optional().describe("Due date, ISO format"),
          start_date: tool.schema.string().optional().describe("Start date, ISO format"),
          assignee_ids: tool.schema.array(tool.schema.string()).optional().describe("Assignee member IDs"),
          label_ids: tool.schema.array(tool.schema.string()).optional().describe("Label IDs"),
          story_points: tool.schema.number().int().min(1).optional().describe("Story points"),
          custom_fields: tool.schema.array(customFieldArg).optional().describe("Custom fields to set, using workflow keys or raw Nifty field IDs"),
        },
        async execute(args, context) {
          const workflow = await workflowForArgs(args, context)
          const response = await niftyRequest("/api/v1.0/tasks", {
            method: "POST",
            body: cleanWriteObject({
              name: args.name,
              task_group_id: args.task_group_id,
              description: args.description,
              task_id: args.parent_task_id,
              milestone_id: args.milestone_id,
              due_date: args.due_date,
              start_date: args.start_date,
              assignees: args.assignee_ids,
              labels: args.label_ids,
              story_points: args.story_points,
              fields: customFieldPayload(workflow, args.custom_fields),
            }),
          })
          return json(response)
        },
      }),

      nifty_update_task: tool({
        description: "Updates a Nifty task",
        args: {
          workflow_alias: tool.schema.string().optional().describe("Workflow alias used to resolve configured custom fields"),
          config_path: tool.schema.string().optional().describe("Explicit workflow config path; defaults to the OpenCode project directory"),
          task_id: tool.schema.string().describe("Task ID"),
          name: tool.schema.string().optional().describe("Task name"),
          description: tool.schema.string().optional().describe("Task description"),
          task_group_id: tool.schema.string().optional().describe("Status or task group ID"),
          due_date: tool.schema.string().optional().describe("Due date, ISO format"),
          start_date: tool.schema.string().optional().describe("Start date, ISO format"),
          reminder: tool.schema.string().optional().describe("Reminder value"),
          archived: tool.schema.boolean().optional().describe("Archive or unarchive the task"),
          completed: tool.schema.boolean().optional().describe("Complete or reopen the task"),
          milestone_id: tool.schema.string().optional().describe("Milestone ID"),
          dependency: tool.schema.string().optional().describe("Dependency task ID"),
          assignee_ids: tool.schema.array(tool.schema.string()).optional().describe("Replace task assignees"),
          label_ids: tool.schema.array(tool.schema.string()).optional().describe("Replace task labels"),
          story_points: tool.schema.number().int().min(1).optional().describe("Story points"),
          custom_fields: tool.schema.array(customFieldArg).optional().describe("Custom fields to set, using workflow keys or raw Nifty field IDs"),
        },
        async execute(args, context) {
          const workflow = await workflowForArgs(args, context)
          const taskBody = cleanWriteObject({
            name: args.name,
            description: args.description,
            task_group_id: args.task_group_id,
            due_date: args.due_date,
            start_date: args.start_date,
            reminder: args.reminder,
            archived: args.archived,
            completed: args.completed,
            milestone_id: args.milestone_id,
            dependency: args.dependency,
            assignees: args.assignee_ids,
            labels: args.label_ids,
            story_points: args.story_points,
          })
          const taskResponse = Object.keys(taskBody).length
            ? await niftyRequest(`/api/v1.0/tasks/${encodeURIComponent(args.task_id)}`, {
                method: "PUT",
                body: taskBody,
              })
            : null
          const fieldResponses = await updateTaskCustomFields(args.task_id, workflow, args.custom_fields)

          return json({
            task: taskResponse,
            custom_fields: fieldResponses,
          })
        },
      }),

      nifty_update_task_custom_fields: tool({
        description: "Updates Nifty task custom fields without sending a generic task update",
        args: {
          workflow_alias: tool.schema.string().optional().describe("Workflow alias used to resolve configured custom fields"),
          config_path: tool.schema.string().optional().describe("Explicit workflow config path; defaults to the OpenCode project directory"),
          task_id: tool.schema.string().describe("Task ID"),
          custom_fields: tool.schema.array(customFieldArg).describe("Custom fields to set, using workflow keys or raw Nifty field IDs"),
        },
        async execute(args, context) {
          const workflow = await workflowForArgs(args, context)
          const responses = await updateTaskCustomFields(args.task_id, workflow, args.custom_fields)

          return json({
            task_id: args.task_id,
            custom_fields: responses,
          })
        },
      }),

      nifty_update_task_assignees: tool({
        description: "Adds, removes, or replaces Nifty task assignees",
        args: {
          task_id: tool.schema.string().describe("Task ID"),
          assignee_ids: tool.schema.array(tool.schema.string()).describe("Member IDs to apply"),
          mode: tool.schema.enum(["add", "remove", "replace"]).describe("How to apply the assignee list"),
        },
        async execute(args) {
          if (args.mode === "replace") {
            const response = await niftyRequest(`/api/v1.0/tasks/${encodeURIComponent(args.task_id)}`, {
              method: "PUT",
              body: { assignees: args.assignee_ids },
            })
            return json(response)
          }

          const method = args.mode === "add" ? "PUT" : "DELETE"
          const response = await niftyRequest(
            `/api/v1.0/tasks/${encodeURIComponent(args.task_id)}/assignees`,
            {
              method,
              body: { assignees: args.assignee_ids },
            },
          )
          return json(response)
        },
      }),

      nifty_delete_task: tool({
        description: "Deletes a Nifty task by ID",
        args: {
          task_id: tool.schema.string().describe("Task ID"),
        },
        async execute(args) {
          const response = await niftyRequest(`/api/v1.0/tasks/${encodeURIComponent(args.task_id)}`, {
            method: "DELETE",
          })
          return json(response)
        },
      }),

      nifty_delete_tasks: tool({
        description: "Deletes multiple Nifty tasks from a project",
        args: {
          project_id: tool.schema.string().describe("Project ID"),
          task_ids: tool.schema.array(tool.schema.string()).describe("Task IDs to delete"),
          confirmation: tool.schema.string().optional().describe('Required safety phrase, for example "delete 3 tasks"'),
        },
        async execute(args) {
          requireBulkTaskConfirmation("delete", args.task_ids, args.confirmation)
          const response = await niftyRequest("/api/v1.0/tasks", {
            method: "DELETE",
            body: {
              project_id: args.project_id,
              task_ids: args.task_ids,
            },
          })
          return json(response)
        },
      }),

      nifty_complete_task: tool({
        description: "Completes or reopens a Nifty task",
        args: {
          task_id: tool.schema.string().describe("Task ID"),
          completed: tool.schema.boolean().default(true).describe("Completion state"),
          close_confirmation: tool.schema.string().optional().describe('Required when completed=true and automation requires explicit close trigger. Use exactly "close {task_id}".'),
        },
        async execute(args, context) {
          if (args.completed !== false) assertExplicitCloseConfirmation(args.task_id, args, context)
          const response = await niftyRequest(`/api/v1.0/tasks/${encodeURIComponent(args.task_id)}/complete`, {
            method: "POST",
            body: { completed: args.completed },
          })
          const parentAutomation = args.completed === false
            ? null
            : await maybeAutoCompleteParentTask(args.task_id, context)
          return json({ ...response, parent_automation: parentAutomation })
        },
      }),

      nifty_archive_task: tool({
        description: "Archives or unarchives a Nifty task",
        args: {
          task_id: tool.schema.string().describe("Task ID"),
          archived: tool.schema.boolean().default(true).describe("Archived state"),
        },
        async execute(args) {
          const response = await niftyRequest(`/api/v1.0/tasks/${encodeURIComponent(args.task_id)}/archive`, {
            method: "POST",
            body: { archived: args.archived },
          })
          return json(response)
        },
      }),

      nifty_clone_task: tool({
        description: "Clones a Nifty task",
        args: {
          task_id: tool.schema.string().describe("Task ID to clone"),
          body_string: tool.schema.string().optional().describe("Optional raw string body for Nifty's clone endpoint"),
        },
        async execute(args) {
          const response = await niftyRequest(`/api/v1.0/tasks/${encodeURIComponent(args.task_id)}/clone`, {
            method: "POST",
            body: args.body_string || "",
          })
          return json(response)
        },
      }),

      nifty_link_tasks: tool({
        description: "Links other tasks to a Nifty task",
        args: {
          task_id: tool.schema.string().describe("Task ID that linked tasks should be associated with"),
          task_ids: tool.schema.array(tool.schema.string()).describe("Task IDs to link"),
        },
        async execute(args) {
          const response = await niftyRequest(`/api/v1.0/tasks/${encodeURIComponent(args.task_id)}/link_task`, {
            method: "POST",
            body: { tasks: args.task_ids },
          })
          return json(response)
        },
      }),

      nifty_update_task_labels: tool({
        description: "Adds, removes, or replaces Nifty task labels",
        args: {
          task_id: tool.schema.string().describe("Task ID"),
          label_ids: tool.schema.array(tool.schema.string()).describe("Label IDs to apply"),
          mode: tool.schema.enum(["add", "remove", "replace"]).describe("How to apply the labels"),
        },
        async execute(args) {
          if (args.mode === "replace") {
            const response = await niftyRequest(`/api/v1.0/tasks/${encodeURIComponent(args.task_id)}`, {
              method: "PUT",
              body: { labels: args.label_ids },
            })
            return json(response)
          }

          const response = await niftyRequest(`/api/v1.0/tasks/${encodeURIComponent(args.task_id)}/labels`, {
            method: args.mode === "add" ? "PUT" : "DELETE",
            body: { labels: args.label_ids },
          })
          return json(response)
        },
      }),

      nifty_attach_task_document: tool({
        description: "Attaches a Nifty document to a task",
        args: {
          task_id: tool.schema.string().describe("Task ID"),
          document_id: tool.schema.string().describe("Document ID to attach"),
        },
        async execute(args) {
          const response = await niftyRequest(`/api/v1.0/tasks/${encodeURIComponent(args.task_id)}/documents`, {
            method: "PUT",
            body: { document_id: args.document_id },
          })
          return json(response)
        },
      }),

      nifty_move_tasks: tool({
        description: "Moves multiple Nifty tasks to a target entity",
        args: {
          task_ids: tool.schema.array(tool.schema.string()).describe("Task IDs to move"),
          target_type: tool.schema.string().describe("Target type expected by Nifty, such as task_group, milestone, or project"),
          target_id: tool.schema.string().describe("Target ID"),
        },
        async execute(args) {
          const response = await niftyRequest("/api/v1.0/tasks/move", {
            method: "POST",
            body: {
              to: {
                type: args.target_type,
                id: args.target_id,
              },
              task_ids: args.task_ids,
            },
          })
          return json(response)
        },
      }),

      nifty_move_task_to_status: tool({
        description: "Moves a task to a named status or configured workflow state",
        args: {
          task_id: tool.schema.string().describe("Task ID"),
          workflow_alias: tool.schema.string().optional().describe("Workflow alias from the workflow config file"),
          config_path: tool.schema.string().optional().describe("Explicit workflow config path; defaults to the OpenCode project directory"),
          project_id: tool.schema.string().optional().describe("Project ID when not using a workflow alias"),
          state_key: tool.schema.string().optional().describe("Configured state key such as ideas or todo"),
          status_name: tool.schema.string().optional().describe("Raw status name override"),
          comment: tool.schema.string().optional().describe("Optional note to add after the move"),
          delivery_evidence: deliveryEvidenceArg.optional().describe("Delivery gate evidence. Required when moving into Dev Review by lifecycle policy"),
          close_confirmation: tool.schema.string().optional().describe('Required when moving to a Done-like status with completion sync. Use exactly "close {task_id}".'),
        },
        async execute(args, context) {
          const task = await niftyRequest(`/api/v1.0/tasks/${encodeURIComponent(args.task_id)}`)
          const contextWithConfig = workflowContext(context, args.config_path)
          const resolved = args.workflow_alias
            ? await resolveProjectSelector({ workflow_alias: args.workflow_alias, config_path: args.config_path }, contextWithConfig)
            : { project: { id: args.project_id || getTaskProjectID(task) }, workflow: undefined }

          if (!resolved.project?.id) {
            throw new Error("Project context missing. Provide workflow_alias or project_id.")
          }

          if (args.workflow_alias) {
            ensureWorkflow(resolved.workflow, resolved.workflowAlias || args.workflow_alias, contextWithConfig)
          }

          const status = await resolveStatusSelector(resolved.project.id, {
            workflow: resolved.workflow,
            state_key: args.state_key,
            status_name: args.status_name,
          })

          if (!status) {
            throw new Error("Target status missing. Provide state_key or status_name.")
          }

          await enforceDeliveryLifecyclePolicy(
            args.task_id,
            status,
            resolved.workflow,
            args.delivery_evidence,
            contextWithConfig,
          )

          if (looksLikeDoneStatus(status, resolved.workflow)) {
            assertExplicitCloseConfirmation(args.task_id, args, contextWithConfig)
          }

          const response = await niftyRequest(`/api/v1.0/tasks/${encodeURIComponent(args.task_id)}`, {
            method: "PUT",
            body: {
              task_group_id: status.id,
            },
          })

          if (args.comment) {
            await niftyRequest("/api/v1.0/messages", {
              method: "POST",
              body: {
                type: "text",
                text: botCommentText(args.comment),
                task_id: args.task_id,
              },
            })
          }

          const completionSync = await maybeSyncCompletionForStatus(
            args.task_id,
            status,
            resolved.workflow,
            contextWithConfig,
            args,
          )

          return json({
            moved: true,
            task_id: args.task_id,
            target_status: { id: status.id, name: status.name },
            completion_sync: completionSync,
            response,
          })
        },
      }),

      nifty_prepare_task_for_delivery: tool({
        description: "Standardizes a task description and optionally moves it to a target workflow state",
        args: {
          task_id: tool.schema.string().describe("Task ID"),
          workflow_alias: tool.schema.string().optional().describe("Workflow alias from the workflow config file"),
          config_path: tool.schema.string().optional().describe("Explicit workflow config path; defaults to the OpenCode project directory"),
          project_id: tool.schema.string().optional().describe("Project ID when not using a workflow alias"),
          name: tool.schema.string().optional().describe("Optional updated task title"),
          summary: tool.schema.string().optional().describe("Short summary"),
          problem: tool.schema.string().optional().describe("Problem statement"),
          desired_outcome: tool.schema.string().optional().describe("Desired outcome"),
          acceptance_criteria: tool.schema.array(tool.schema.string()).optional().describe("Acceptance criteria items"),
          implementation_notes: tool.schema.array(tool.schema.string()).optional().describe("Implementation notes"),
          open_questions: tool.schema.array(tool.schema.string()).optional().describe("Questions that must be answered by the user before updating the task"),
          checklist: tool.schema.array(tool.schema.string()).optional().describe("Implementation checklist"),
          assignee_ids: tool.schema.array(tool.schema.string()).optional().describe("Assignee member IDs"),
          label_ids: tool.schema.array(tool.schema.string()).optional().describe("Label IDs"),
          story_points: tool.schema.number().int().min(1).optional().describe("Story points"),
          due_date: tool.schema.string().optional().describe("Due date, ISO format"),
          start_date: tool.schema.string().optional().describe("Start date, ISO format"),
          reminder: tool.schema.string().optional().describe("Reminder value"),
          state_key: tool.schema.string().optional().describe("Configured state key to move into after update"),
          status_name: tool.schema.string().optional().describe("Raw status name override"),
          delivery_evidence: deliveryEvidenceArg.optional().describe("Delivery gate evidence. Required when moving into Dev Review by lifecycle policy"),
          list_key: tool.schema.string().optional().describe("Configured workflow list key"),
          list_name: tool.schema.string().optional().describe("Raw Nifty list/milestone name override"),
          milestone_id: tool.schema.string().optional().describe("Raw Nifty milestone/list ID override"),
          comment: tool.schema.string().optional().describe("Optional note to append as a task comment"),
        },
        async execute(args, context) {
          assertNoOpenQuestions(args, "task")
          const task = await niftyRequest(`/api/v1.0/tasks/${encodeURIComponent(args.task_id)}`)
          const contextWithConfig = workflowContext(context, args.config_path)
          const resolved = args.workflow_alias
            ? await resolveProjectSelector({ workflow_alias: args.workflow_alias, config_path: args.config_path }, contextWithConfig)
            : { project: { id: args.project_id || getTaskProjectID(task) }, workflow: undefined }

          if (!resolved.project?.id) {
            throw new Error("Project context missing. Provide workflow_alias or project_id.")
          }

          if (args.workflow_alias) {
            ensureWorkflow(resolved.workflow, resolved.workflowAlias || args.workflow_alias, contextWithConfig)
          }

          const description = buildTaskDescription(args)
          const targetStatus = await resolveStatusSelector(resolved.project.id, {
            workflow: resolved.workflow,
            state_key: args.state_key,
            status_name: args.status_name,
          })

          await enforceDeliveryLifecyclePolicy(
            args.task_id,
            targetStatus,
            resolved.workflow,
            args.delivery_evidence,
            contextWithConfig,
          )

          const milestone = await resolveMilestoneSelector(resolved.project.id, {
            workflow: resolved.workflow,
            list_key: args.list_key,
            list_name: args.list_name,
            milestone_id: args.milestone_id,
          })

          const response = await niftyRequest(`/api/v1.0/tasks/${encodeURIComponent(args.task_id)}`, {
            method: "PUT",
            body: cleanWriteObject({
              name: args.name,
              description,
              task_group_id: targetStatus?.id,
              milestone_id: milestone?.id,
              due_date: args.due_date,
              start_date: args.start_date,
              reminder: args.reminder,
              assignees: args.assignee_ids,
              labels: args.label_ids,
              story_points: args.story_points,
            }),
          })

          const automation = automationConfig(loadPolicy(contextWithConfig), contextWithConfig)
          const createdSubtasks = []
          if (automation.enabled && automation.subtasks?.auto_create_from_checklist && args.checklist?.length) {
            const subtaskPlans = checklistSubtasks(args.checklist, task.subtasks || [])
            for (const subtask of subtaskPlans) {
              const created = await niftyRequest("/api/v1.0/tasks", {
                method: "POST",
                body: cleanWriteObject({
                  name: subtask.name,
                  task_id: args.task_id,
                  task_group_id: task.task_group_id || task.task_group || targetStatus?.id,
                }),
              })
              createdSubtasks.push({ ...created, name: subtask.name })
            }
          }

          if (args.comment) {
            await niftyRequest("/api/v1.0/messages", {
              method: "POST",
              body: {
                type: "text",
                text: botCommentText(args.comment),
                task_id: args.task_id,
              },
            })
          }

          return json({
            prepared: true,
            task_id: args.task_id,
            target_status: targetStatus
              ? { id: targetStatus.id, name: targetStatus.name }
              : null,
            milestone: milestone ? { id: milestone.id, name: milestone.name } : null,
            created_subtasks: createdSubtasks,
            response,
          })
        },
      }),

      nifty_list_discussions: tool({
        description: "Lists Nifty chats or discussion threads",
        args: {},
        async execute() {
          const response = await niftyRequest("/api/v1.0/chats")
          return json(response)
        },
      }),

      nifty_get_discussion: tool({
        description: "Gets a Nifty discussion by chat ID",
        args: {
          chat_id: tool.schema.string().describe("Chat ID"),
        },
        async execute(args) {
          const response = await niftyRequest(`/api/v1.0/chats/${encodeURIComponent(args.chat_id)}`)
          return json(response)
        },
      }),

      nifty_list_messages: tool({
        description: "Lists Nifty messages or comments",
        args: {
          chat_id: tool.schema.string().optional().describe("Discussion or chat ID"),
          message_id: tool.schema.string().optional().describe("Parent message ID"),
          task_id: tool.schema.string().optional().describe("Task ID for task comments"),
          file_id: tool.schema.string().optional().describe("File ID"),
          doc_id: tool.schema.string().optional().describe("Document ID"),
          entity_key: tool.schema.string().optional().describe("Document entity key"),
          limit: tool.schema.number().int().min(1).max(100).optional().describe("Page size"),
          offset: tool.schema.number().int().min(0).optional().describe("Pagination offset"),
        },
        async execute(args) {
          const response = await niftyRequest("/api/v1.0/messages", {
            query: cleanObject({
              chat_id: args.chat_id,
              message_id: args.message_id,
              task_id: args.task_id,
              file_id: args.file_id,
              doc_id: args.doc_id,
              entity_key: args.entity_key,
              limit: args.limit,
              offset: args.offset,
            }),
          })
          return json(response)
        },
      }),

      nifty_create_comment: tool({
        description: "Creates a Nifty comment or message",
        args: {
          text: tool.schema.string().describe("Comment body"),
          chat_id: tool.schema.string().optional().describe("Discussion or chat ID"),
          message_id: tool.schema.string().optional().describe("Parent message ID for a reply"),
          task_id: tool.schema.string().optional().describe("Task ID for a task comment"),
          file_id: tool.schema.string().optional().describe("File ID"),
          doc_id: tool.schema.string().optional().describe("Document ID"),
          entity_key: tool.schema.string().optional().describe("Document entity key when doc_id is used"),
          external_files: tool.schema.array(tool.schema.string()).optional().describe("External file URLs or identifiers"),
          nifty_files: tool.schema.array(tool.schema.string()).optional().describe("Nifty file IDs"),
          bot_marker: tool.schema.boolean().optional().describe("Prefix with 🤖 McBotFace marker; defaults to true for AI/tool comments"),
        },
        async execute(args) {
          const targets = [
            args.chat_id,
            args.message_id,
            args.task_id,
            args.file_id,
            args.doc_id,
          ].filter(Boolean)

          if (targets.length !== 1) {
            throw new Error(
              "Provide exactly one target: chat_id, message_id, task_id, file_id, or doc_id.",
            )
          }

          const response = await niftyRequest("/api/v1.0/messages", {
            method: "POST",
            body: cleanObject({
              type: "text",
              text: botCommentText(args.text, args.bot_marker !== false),
              chat_id: args.chat_id,
              message_id: args.message_id,
              task_id: args.task_id,
              file_id: args.file_id,
              doc_id: args.doc_id,
              entity_key: args.entity_key,
              external_files: args.external_files,
              nifty_files: args.nifty_files,
            }),
          })
          return json(response)
        },
      }),

      nifty_update_comment: tool({
        description: "Updates a Nifty message or comment",
        args: {
          message_id: tool.schema.string().describe("Message ID"),
          text: tool.schema.string().describe("Updated message text"),
          hide_link_preview: tool.schema.boolean().optional().describe("Hide link previews"),
          nifty_files: tool.schema.array(tool.schema.string()).optional().describe("Nifty file IDs"),
          bot_marker: tool.schema.boolean().optional().describe("Prefix with 🤖 McBotFace marker; defaults to true for AI/tool comments"),
        },
        async execute(args) {
          const response = await niftyRequest(`/api/v1.0/messages/${encodeURIComponent(args.message_id)}`, {
            method: "PUT",
            body: cleanObject({
              text: botCommentText(args.text, args.bot_marker !== false),
              hide_link_preview: args.hide_link_preview,
              nifty_files: args.nifty_files,
            }),
          })
          return json(response)
        },
      }),
    }),
  }
}

NiftyPlugin.__test = __test
