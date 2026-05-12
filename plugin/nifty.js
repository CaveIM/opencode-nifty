import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { existsSync } from "node:fs"
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises"
import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { randomBytes } from "node:crypto"
import { tool } from "@opencode-ai/plugin"

const API_BASE_URL = "https://openapi.niftypm.com"
const TOKEN_PATH = join(homedir(), ".config", "opencode", "nifty-auth.json")
const WORKFLOW_CONFIG_PATH = join(homedir(), ".config", "opencode", "nifty-workflows.json")
const TOKEN_SKEW_MS = 60 * 1000

function env(name) {
  const value = process.env[name]
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function getClientConfig() {
  return {
    clientID: env("NIFTY_CLIENT_ID"),
    clientSecret: env("NIFTY_CLIENT_SECRET"),
    redirectURI: env("NIFTY_REDIRECT_URI"),
    authorizeURL: env("NIFTY_AUTHORIZE_URL"),
    accessToken: env("NIFTY_ACCESS_TOKEN"),
    refreshToken: env("NIFTY_REFRESH_TOKEN"),
  }
}

function defaultWorkflowAlias() {
  return env("NIFTY_DEFAULT_WORKFLOW")
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
  await mkdir(dirname(TOKEN_PATH), { recursive: true })
  await writeFile(TOKEN_PATH, `${JSON.stringify(token, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  })
  await chmod(TOKEN_PATH, 0o600).catch(() => {})
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

async function requestToken(body) {
  const config = getClientConfig()
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

function getAuthorizeURL(host, port, state) {
  const config = getClientConfig()
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

function startBackgroundAuthorizationServer(host, port, state) {
  const redirectURI = getLocalRedirectURI(host, port)
  const script = `
    import { createServer } from "node:http";
    import { chmod, writeFile, mkdir } from "node:fs/promises";
    import { dirname } from "node:path";
    import { homedir } from "node:os";

    const host = process.env.NIFTY_AUTH_HOST || "127.0.0.1";
    const port = Number(process.env.NIFTY_AUTH_PORT || "8787");
    const redirectURI = process.env.NIFTY_REDIRECT_URI || \`http://\${host}:\${port}/callback\`;
    const tokenPath = process.env.NIFTY_TOKEN_PATH || homedir() + "/.config/opencode/nifty-auth.json";
    const expectedState = process.env.NIFTY_AUTH_STATE;

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
          server.close(() => process.exit(1));
          return;
        }

        const clientID = process.env.NIFTY_CLIENT_ID;
        const clientSecret = process.env.NIFTY_CLIENT_SECRET;
        if (!clientID || !clientSecret) {
          response.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
          response.end(html("Missing Nifty credentials", "Set NIFTY_CLIENT_ID and NIFTY_CLIENT_SECRET in this OpenCode environment."));
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
          server.close(() => process.exit(1));
          return;
        }

        const token = JSON.parse(text);
        token.expires_at = Date.now() + Number(token.expires_in || 0) * 1000;
        await mkdir(dirname(tokenPath), { recursive: true });
        await writeFile(tokenPath, JSON.stringify(token, null, 2) + "\\n", { encoding: "utf8", mode: 0o600 });
        await chmod(tokenPath, 0o600).catch(() => {});

        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(html("Nifty connected", "You can close this tab and return to OpenCode."));
        server.close(() => process.exit(0));
      } catch {
        response.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
        response.end(html("Nifty auth server failed", "Return to OpenCode and retry."));
        server.close(() => process.exit(1));
      }
    });

    server.listen(port, host);
    setTimeout(() => server.close(() => process.exit(1)), 10 * 60 * 1000);
  `

  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      NIFTY_AUTH_HOST: host,
      NIFTY_AUTH_PORT: String(port),
      NIFTY_AUTH_STATE: state,
      NIFTY_REDIRECT_URI: redirectURI,
      NIFTY_TOKEN_PATH: TOKEN_PATH,
    },
  })
  child.unref()
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

function normalize(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function configPath(context = {}) {
  const configuredPath = env("NIFTY_WORKFLOW_CONFIG")
  if (configuredPath) return configuredPath

  const candidates = [context.directory, context.worktree, process.cwd()]
    .filter(Boolean)
    .map((directory) => join(directory, "nifty-workflows.json"))
  const uniqueCandidates = [...new Set(candidates)]
  const projectConfigPath = uniqueCandidates.find((candidate) => existsSync(candidate))

  return projectConfigPath || WORKFLOW_CONFIG_PATH
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

function projectMatches(project, selector) {
  const wanted = normalize(selector)
  if (!wanted) return false
  return [project.id, project.name, project.nice_id]
    .filter(Boolean)
    .some((value) => normalize(value) === wanted)
}

async function resolveProjectSelector(input = {}, context = {}) {
  const config = await readWorkflowConfig(context)
  const workflows = getWorkflowAliasMap(config)
  const workflowAlias = input.workflow_alias || defaultWorkflowAlias()
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

function statusMap(statuses) {
  return new Map(statuses.map((status) => [status.id, status.name]))
}

function summarizeTask(task, statusesByID = new Map()) {
  const rawStatus = getTaskStatusID(task)
  return {
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

function buildTaskDescription(input) {
  const lines = [
    ...renderSection("Summary", input.summary),
    ...renderSection("Problem", input.problem),
    ...renderSection("Desired Outcome", input.desired_outcome),
    ...renderListSection("Acceptance Criteria", input.acceptance_criteria),
    ...renderListSection("Implementation Notes", input.implementation_notes),
    ...renderListSection("Open Questions", input.open_questions),
    ...renderListSection("Checklist", input.checklist, true),
  ]

  return lines.join("\n").trim() || undefined
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
      `Workflow alias '${alias}' is not configured. Set NIFTY_WORKFLOW_CONFIG or create ${configPath(context)}.`,
    )
  }
}

async function validateWorkflows(options = {}) {
  const config = await readWorkflowConfig(options)
  const workflows = getWorkflowAliasMap(config)
  const projects = await fetchAllProjects({ includeArchived: options.includeArchived })
  const defaultAlias = defaultWorkflowAlias()
  const aliases = Object.keys(workflows)
  const results = []

  for (const [alias, workflow] of Object.entries(workflows)) {
    const selector = workflow?.project?.id || workflow?.project?.name || workflow?.project?.nice_id || workflow?.project
    const project = projects.find((item) => projectMatches(item, selector))
    const errors = []
    const warnings = []
    const states = workflow?.states || workflow?.statuses || {}
    const lists = workflow?.lists || workflow?.milestones || {}
    let statuses = []
    let milestones = []

    if (!selector) {
      errors.push("project selector is missing")
    }

    if (!project) {
      errors.push(`project not found: ${selector || "<missing>"}`)
    } else {
      try {
        statuses = await fetchAllStatuses(project.id)
        milestones = await fetchAllMilestones(project.id)
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

    if (!states.backlog) warnings.push("state 'backlog' is not configured")
    if (!states.ready) warnings.push("state 'ready' is not configured")

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
  const url = new URL(path, API_BASE_URL)
  appendQueryParams(url, query)
  const method = rest.method || "GET"

  const response = await fetch(url, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
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

export const __test = {
  appendQueryParams,
  buildTaskDescription,
  configPath,
  filterTasksByStatus,
  findMatchingProjects,
  getTaskProjectID,
  getTaskStatusID,
  isTokenUsable,
  milestoneMatches,
  normalize,
  projectMatches,
  statusMatches,
  summarizeTask,
}

export const NiftyPlugin = async () => {
  return {
    tool: {
      nifty_auth_help: tool({
        description: "Shows how to authorize the Nifty plugin",
        args: {},
        async execute() {
          const config = getClientConfig()
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
        async execute(args) {
          const config = getClientConfig()
          if (!config.redirectURI) {
            throw new Error("Missing NIFTY_REDIRECT_URI.")
          }

          const token = await requestToken({
            grant_type: "authorization_code",
            code: args.code,
            redirect_uri: config.redirectURI,
          })

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
          port: tool.schema.number().int().min(1).max(65535).default(8787).describe("Local port to listen on"),
        },
        async execute(args, context) {
          await assertPortAvailable(args.host, args.port)
          const state = createOAuthState()
          const authorizeURL = getAuthorizeURL(args.host, args.port, state)
          const redirectURI = getLocalRedirectURI(args.host, args.port)

          context.metadata({
            title: "Authorize Nifty in browser",
            metadata: {
              authorizeURL,
              redirectURI,
            },
          })

          const code = await waitForAuthorizationCode(args.host, args.port, context.abort, state)
          const token = await requestToken({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectURI,
          })

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
          port: tool.schema.number().int().min(1).max(65535).default(8787).describe("Local port to listen on"),
        },
        async execute(args) {
          await assertPortAvailable(args.host, args.port)
          const state = createOAuthState()
          const authorizeURL = getAuthorizeURL(args.host, args.port, state)
          const redirectURI = startBackgroundAuthorizationServer(args.host, args.port, state)

          return [
            "Open this URL in your browser to finish connecting Nifty:",
            authorizeURL,
            "",
            "The callback server is running in the background for 10 minutes.",
            `Redirect URI: ${redirectURI}`,
            `Token cache: ${TOKEN_PATH}`,
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
          content: tool.schema.record(tool.schema.any()).optional().describe("Raw Nifty document content object"),
          content_text: tool.schema.string().optional().describe("Convenience plain-text content, stored as { text } when content is omitted"),
          external_id: tool.schema.string().optional().describe("External ID"),
          order: tool.schema.number().optional().describe("Document order"),
        },
        async execute(args, context) {
          const resolved = await resolveProjectSelector(
            {
              workflow_alias: args.workflow_alias,
              project_id: args.project_id,
              project_name: args.project_name,
              project_nice_id: args.project_nice_id,
            },
            context,
          )
          const content = args.content || (args.content_text ? { text: args.content_text } : undefined)

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
          content: tool.schema.record(tool.schema.any()).optional().describe("Raw Nifty document content object"),
          content_text: tool.schema.string().optional().describe("Convenience plain-text content, stored as { text } when content is omitted"),
          folder_id: tool.schema.string().optional().describe("Folder ID"),
          folder_stack: tool.schema.array(tool.schema.string()).optional().describe("Folder path stack"),
          multipage: tool.schema.boolean().optional().describe("Whether this is a multipage document"),
          order: tool.schema.number().optional().describe("Document order"),
        },
        async execute(args) {
          const content = args.content || (args.content_text ? { text: args.content_text } : undefined)
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
        args: {},
        async execute(_args, context) {
          const config = await readWorkflowConfig(context)
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
            }
          })

          return json({
            config_path: configPath(context),
            workflows: items,
          })
        },
      }),

      nifty_validate_workflows: tool({
        description: "Validates workflow aliases against real Nifty projects and statuses",
        args: {
          include_archived: tool.schema.boolean().optional().describe("Include archived projects when resolving aliases"),
        },
        async execute(args, context) {
          const result = await validateWorkflows({
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
          const config = getClientConfig()
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
            default_workflow: defaultWorkflowAlias() || null,
            checks,
          })
        },
      }),

      nifty_list_workflow_tasks: tool({
        description: "Lists tasks for a configured workflow alias and optional state name",
        args: {
          workflow_alias: tool.schema.string().optional().describe("Workflow alias from the workflow config file, defaults to NIFTY_DEFAULT_WORKFLOW"),
          state_key: tool.schema.string().optional().describe("Configured state key such as backlog or ready"),
          status_name: tool.schema.string().optional().describe("Raw status name override, for example Backlog or Ready"),
          list_key: tool.schema.string().optional().describe("Configured workflow list key"),
          list_name: tool.schema.string().optional().describe("Raw Nifty list/milestone name override"),
          milestone_id: tool.schema.string().optional().describe("Raw Nifty milestone/list ID override"),
          include_completed: tool.schema.boolean().optional().describe("Include completed tasks"),
          include_subtasks: tool.schema.boolean().optional().describe("Include subtasks in the response"),
          limit: tool.schema.number().int().min(1).max(100).optional().describe("Page size"),
          offset: tool.schema.number().int().min(0).optional().describe("Pagination offset"),
        },
        async execute(args, context) {
          const resolved = await resolveProjectSelector({ workflow_alias: args.workflow_alias }, context)
          ensureWorkflow(
            resolved.workflow,
            resolved.workflowAlias || args.workflow_alias || defaultWorkflowAlias(),
            context,
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
            workflow_alias: resolved.workflowAlias || args.workflow_alias || defaultWorkflowAlias() || null,
            project: {
              id: resolved.project.id,
              name: resolved.project.name,
              nice_id: resolved.project.nice_id,
            },
            status: status ? { id: status.id, name: status.name } : null,
            milestone: milestone ? { id: milestone.id, name: milestone.name } : null,
            tasks: filterTasksByStatus(result.tasks, status?.id).map((task) =>
              summarizeTask(task, result.statusesByID),
            ),
            has_more: result.hasMore,
          })
        },
      }),

      nifty_capture_backlog_item: tool({
        description: "Creates a new workflow task, defaulting to the backlog state",
        args: {
          workflow_alias: tool.schema.string().optional().describe("Workflow alias from the workflow config file, defaults to NIFTY_DEFAULT_WORKFLOW"),
          name: tool.schema.string().describe("Task name"),
          summary: tool.schema.string().optional().describe("Short summary of the idea"),
          problem: tool.schema.string().optional().describe("Problem the idea addresses"),
          desired_outcome: tool.schema.string().optional().describe("Desired outcome"),
          acceptance_criteria: tool.schema.array(tool.schema.string()).optional().describe("Acceptance criteria items"),
          implementation_notes: tool.schema.array(tool.schema.string()).optional().describe("Implementation notes"),
          open_questions: tool.schema.array(tool.schema.string()).optional().describe("Open questions"),
          checklist: tool.schema.array(tool.schema.string()).optional().describe("Execution checklist"),
          state_key: tool.schema.string().optional().describe("Workflow state key, defaults to backlog"),
          status_name: tool.schema.string().optional().describe("Raw status name override"),
          list_key: tool.schema.string().optional().describe("Configured workflow list key"),
          list_name: tool.schema.string().optional().describe("Raw Nifty list/milestone name override"),
          milestone_id: tool.schema.string().optional().describe("Raw Nifty milestone/list ID override"),
          assignee_ids: tool.schema.array(tool.schema.string()).optional().describe("Assignee member IDs"),
          label_ids: tool.schema.array(tool.schema.string()).optional().describe("Label IDs"),
          due_date: tool.schema.string().optional().describe("Due date, ISO format"),
          start_date: tool.schema.string().optional().describe("Start date, ISO format"),
          story_points: tool.schema.number().optional().describe("Story points"),
        },
        async execute(args, context) {
          const resolved = await resolveProjectSelector({ workflow_alias: args.workflow_alias }, context)
          ensureWorkflow(
            resolved.workflow,
            resolved.workflowAlias || args.workflow_alias || defaultWorkflowAlias(),
            context,
          )

          const status = await resolveStatusSelector(resolved.project.id, {
            workflow: resolved.workflow,
            state_key: args.state_key || "backlog",
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
            body: cleanObject({
              name: args.name,
              task_group_id: status.id,
              milestone_id: milestone?.id,
              description,
              due_date: args.due_date,
              start_date: args.start_date,
              assignees: args.assignee_ids,
              labels: args.label_ids,
              story_points: args.story_points,
            }),
          })

          return json({
            workflow_alias: resolved.workflowAlias || args.workflow_alias || defaultWorkflowAlias() || null,
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
        description: "Creates multiple standardized workflow backlog items, with dry-run support",
        args: {
          workflow_alias: tool.schema.string().optional().describe("Workflow alias from the workflow config file, defaults to NIFTY_DEFAULT_WORKFLOW"),
          state_key: tool.schema.string().optional().describe("Workflow state key, defaults to backlog"),
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
            story_points: tool.schema.number().optional(),
          })).describe("Items to create"),
        },
        async execute(args, context) {
          const resolved = await resolveProjectSelector({ workflow_alias: args.workflow_alias }, context)
          ensureWorkflow(
            resolved.workflow,
            resolved.workflowAlias || args.workflow_alias || defaultWorkflowAlias(),
            context,
          )

          const status = await resolveStatusSelector(resolved.project.id, {
            workflow: resolved.workflow,
            state_key: args.state_key || "backlog",
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
          })).map(cleanObject)

          if (args.dry_run) {
            return json({
              dry_run: true,
              workflow_alias: resolved.workflowAlias || args.workflow_alias || defaultWorkflowAlias() || null,
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
            workflow_alias: resolved.workflowAlias || args.workflow_alias || defaultWorkflowAlias() || null,
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
        async execute(args) {
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
          return json(response)
        },
      }),

      nifty_get_task: tool({
        description: "Gets a Nifty task by ID",
        args: {
          task_id: tool.schema.string().describe("Task ID"),
        },
        async execute(args) {
          const response = await niftyRequest(`/api/v1.0/tasks/${encodeURIComponent(args.task_id)}`)
          return json(response)
        },
      }),

      nifty_create_task: tool({
        description: "Creates a Nifty task",
        args: {
          name: tool.schema.string().describe("Task name"),
          task_group_id: tool.schema.string().describe("Status or task group ID"),
          description: tool.schema.string().optional().describe("Task description"),
          parent_task_id: tool.schema.string().optional().describe("Parent task ID when creating a subtask"),
          milestone_id: tool.schema.string().optional().describe("Milestone ID"),
          due_date: tool.schema.string().optional().describe("Due date, ISO format"),
          start_date: tool.schema.string().optional().describe("Start date, ISO format"),
          assignee_ids: tool.schema.array(tool.schema.string()).optional().describe("Assignee member IDs"),
          label_ids: tool.schema.array(tool.schema.string()).optional().describe("Label IDs"),
          story_points: tool.schema.number().optional().describe("Story points"),
        },
        async execute(args) {
          const response = await niftyRequest("/api/v1.0/tasks", {
            method: "POST",
            body: cleanObject({
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
            }),
          })
          return json(response)
        },
      }),

      nifty_update_task: tool({
        description: "Updates a Nifty task",
        args: {
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
          story_points: tool.schema.number().optional().describe("Story points"),
        },
        async execute(args) {
          const response = await niftyRequest(`/api/v1.0/tasks/${encodeURIComponent(args.task_id)}`, {
            method: "PUT",
            body: cleanObject({
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
            }),
          })
          return json(response)
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

      nifty_move_task_to_status: tool({
        description: "Moves a task to a named status or configured workflow state",
        args: {
          task_id: tool.schema.string().describe("Task ID"),
          workflow_alias: tool.schema.string().optional().describe("Workflow alias from the workflow config file"),
          project_id: tool.schema.string().optional().describe("Project ID when not using a workflow alias"),
          state_key: tool.schema.string().optional().describe("Configured state key such as backlog or ready"),
          status_name: tool.schema.string().optional().describe("Raw status name override"),
          comment: tool.schema.string().optional().describe("Optional note to add after the move"),
        },
        async execute(args, context) {
          const task = await niftyRequest(`/api/v1.0/tasks/${encodeURIComponent(args.task_id)}`)
          const resolved = args.workflow_alias
            ? await resolveProjectSelector({ workflow_alias: args.workflow_alias }, context)
            : { project: { id: args.project_id || getTaskProjectID(task) }, workflow: undefined }

          if (!resolved.project?.id) {
            throw new Error("Project context missing. Provide workflow_alias or project_id.")
          }

          if (args.workflow_alias) {
            ensureWorkflow(resolved.workflow, resolved.workflowAlias || args.workflow_alias, context)
          }

          const status = await resolveStatusSelector(resolved.project.id, {
            workflow: resolved.workflow,
            state_key: args.state_key,
            status_name: args.status_name,
          })

          if (!status) {
            throw new Error("Target status missing. Provide state_key or status_name.")
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
                text: args.comment,
                task_id: args.task_id,
              },
            })
          }

          return json({
            moved: true,
            task_id: args.task_id,
            target_status: { id: status.id, name: status.name },
            response,
          })
        },
      }),

      nifty_prepare_task_for_delivery: tool({
        description: "Standardizes a task description and optionally moves it to a ready state",
        args: {
          task_id: tool.schema.string().describe("Task ID"),
          workflow_alias: tool.schema.string().optional().describe("Workflow alias from the workflow config file"),
          project_id: tool.schema.string().optional().describe("Project ID when not using a workflow alias"),
          name: tool.schema.string().optional().describe("Optional updated task title"),
          summary: tool.schema.string().optional().describe("Short summary"),
          problem: tool.schema.string().optional().describe("Problem statement"),
          desired_outcome: tool.schema.string().optional().describe("Desired outcome"),
          acceptance_criteria: tool.schema.array(tool.schema.string()).optional().describe("Acceptance criteria items"),
          implementation_notes: tool.schema.array(tool.schema.string()).optional().describe("Implementation notes"),
          open_questions: tool.schema.array(tool.schema.string()).optional().describe("Open questions"),
          checklist: tool.schema.array(tool.schema.string()).optional().describe("Implementation checklist"),
          assignee_ids: tool.schema.array(tool.schema.string()).optional().describe("Assignee member IDs"),
          label_ids: tool.schema.array(tool.schema.string()).optional().describe("Label IDs"),
          story_points: tool.schema.number().optional().describe("Story points"),
          due_date: tool.schema.string().optional().describe("Due date, ISO format"),
          start_date: tool.schema.string().optional().describe("Start date, ISO format"),
          reminder: tool.schema.string().optional().describe("Reminder value"),
          state_key: tool.schema.string().optional().describe("Configured state key to move into after update"),
          status_name: tool.schema.string().optional().describe("Raw status name override"),
          list_key: tool.schema.string().optional().describe("Configured workflow list key"),
          list_name: tool.schema.string().optional().describe("Raw Nifty list/milestone name override"),
          milestone_id: tool.schema.string().optional().describe("Raw Nifty milestone/list ID override"),
          comment: tool.schema.string().optional().describe("Optional note to append as a task comment"),
        },
        async execute(args, context) {
          const task = await niftyRequest(`/api/v1.0/tasks/${encodeURIComponent(args.task_id)}`)
          const resolved = args.workflow_alias
            ? await resolveProjectSelector({ workflow_alias: args.workflow_alias }, context)
            : { project: { id: args.project_id || getTaskProjectID(task) }, workflow: undefined }

          if (!resolved.project?.id) {
            throw new Error("Project context missing. Provide workflow_alias or project_id.")
          }

          if (args.workflow_alias) {
            ensureWorkflow(resolved.workflow, resolved.workflowAlias || args.workflow_alias, context)
          }

          const description = buildTaskDescription(args)
          const targetStatus = await resolveStatusSelector(resolved.project.id, {
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

          const response = await niftyRequest(`/api/v1.0/tasks/${encodeURIComponent(args.task_id)}`, {
            method: "PUT",
            body: cleanObject({
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

          if (args.comment) {
            await niftyRequest("/api/v1.0/messages", {
              method: "POST",
              body: {
                type: "text",
                text: args.comment,
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
              text: args.text,
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
        },
        async execute(args) {
          const response = await niftyRequest(`/api/v1.0/messages/${encodeURIComponent(args.message_id)}`, {
            method: "PUT",
            body: cleanObject({
              text: args.text,
              hide_link_preview: args.hide_link_preview,
              nifty_files: args.nifty_files,
            }),
          })
          return json(response)
        },
      }),
    },
  }
}
