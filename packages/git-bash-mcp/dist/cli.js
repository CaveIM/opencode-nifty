#!/usr/bin/env node

// src/cli.ts
import { argv, stderr } from "node:process";

// src/git-bash-resolver.ts
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
var GIT_BASH_ENV_KEY = "CAVE_MEISTER_CODEX_GIT_BASH_PATH";
var PROGRAM_FILES_GIT_BASH = "C:\\Program Files\\Git\\bin\\bash.exe";
var PROGRAM_FILES_X86_GIT_BASH = "C:\\Program Files (x86)\\Git\\bin\\bash.exe";
function resolveGitBash(input) {
  if (input.platform !== "win32")
    return { found: true, path: null, source: "not-required" };
  const checkedPaths = [];
  const envPath = nonEmptyEnvValue(input.env, GIT_BASH_ENV_KEY);
  if (envPath !== undefined) {
    checkedPaths.push(envPath);
    if (isBashExePath(envPath) && input.exists(envPath))
      return { found: true, path: envPath, source: "env" };
    return missingGitBash(checkedPaths);
  }
  for (const candidate of [
    { path: PROGRAM_FILES_GIT_BASH, source: "program-files" },
    { path: PROGRAM_FILES_X86_GIT_BASH, source: "program-files-x86" }
  ]) {
    checkedPaths.push(candidate.path);
    if (input.exists(candidate.path))
      return { found: true, path: candidate.path, source: candidate.source };
  }
  for (const pathCandidate of input.where("bash")) {
    const candidate = pathCandidate.trim();
    if (candidate.length === 0)
      continue;
    checkedPaths.push(candidate);
    if (isBashExePath(candidate) && input.exists(candidate))
      return { found: true, path: candidate, source: "path" };
  }
  return missingGitBash(checkedPaths);
}
function resolveGitBashForCurrentProcess(input = {}) {
  return resolveGitBash({
    platform: input.platform ?? process.platform,
    env: input.env ?? process.env,
    exists: existsSync,
    where: whereCommand
  });
}
function missingGitBash(checkedPaths) {
  return {
    found: false,
    checkedPaths,
    installHint: [
      "Git Bash is required before the git_bash MCP can run commands on native Windows.",
      "Install it with: winget install --id Git.Git -e --source winget",
      `For a custom install, set ${GIT_BASH_ENV_KEY}=C:\\path\\to\\bash.exe`
    ].join(`
`)
  };
}
function nonEmptyEnvValue(env, key) {
  const value = env[key];
  if (value === undefined)
    return;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
function isBashExePath(path) {
  return path.toLowerCase().endsWith("bash.exe");
}
function whereCommand(command) {
  try {
    return execFileSync("where", [command], { encoding: "utf8" }).split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  } catch (error) {
    if (error instanceof Error)
      return [];
    throw error;
  }
}

// src/runner.ts
import { spawn } from "node:child_process";
async function runGitBashCommand(input) {
  return await new Promise((resolve, reject) => {
    const child = spawn(input.bashPath, ["-lc", input.command], {
      cwd: input.cwd,
      env: input.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, input.timeoutMs);
    timeout.unref();
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({ exitCode, stdout, stderr, timedOut });
    });
  });
}

// src/mcp.ts
var DEFAULT_TIMEOUT_MS = 120000;
var MAX_TIMEOUT_MS = 30 * 60000;
var EXEC_COMMAND_TIMEOUT_ENV_KEYS = [
  "CAVE_MEISTER_CODEX_GIT_BASH_TIMEOUT_MS",
  "CAVE_MEISTER_CODEX_EXEC_COMMAND_TIMEOUT_MS",
  "CODEX_EXEC_COMMAND_TIMEOUT_MS",
  "EXEC_COMMAND_TIMEOUT_MS"
];
async function handleGitBashMcpRequest(input, options = {}) {
  if (!isRecord(input))
    return errorResponse(null, -32600, "Invalid Request");
  const id = jsonRpcId(input.id);
  const method = typeof input.method === "string" ? input.method : null;
  if (method === "initialize") {
    const protocolVersion = protocolVersionFromInput(input) ?? "2024-11-05";
    return successResponse(id, {
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "git_bash", version: "0.1.0" },
      protocolVersion
    });
  }
  if (method === "tools/list")
    return successResponse(id, { tools: toolsForOptions(options) });
  if (method === "tools/call") {
    const params = isRecord(input.params) ? input.params : {};
    const name = typeof params.name === "string" ? params.name : "";
    const args = isRecord(params.arguments) ? params.arguments : {};
    return await callTool(id, name, args, options);
  }
  if (method === "notifications/initialized")
    return;
  return errorResponse(id, -32601, "Method not found");
}
async function runMcpStdioServer(input, output, options = {}) {
  if (!canRunGitBash(options))
    return;
  let buffer = "";
  for await (const chunk of input) {
    buffer += String(chunk);
    while (true) {
      const lineEnd = buffer.indexOf(`
`);
      if (lineEnd === -1)
        break;
      const line = buffer.slice(0, lineEnd).trim();
      buffer = buffer.slice(lineEnd + 1);
      if (line.length === 0)
        continue;
      const response = await handleGitBashMcpRequest(parseJsonRpcLine(line), options);
      if (response !== undefined)
        output.write(`${JSON.stringify(response)}
`);
    }
  }
}
async function callTool(id, name, args, options) {
  if (name === "which_bash")
    return toolResponse(id, whichBashPayload(resolve(options)));
  if (name === "diagnose")
    return toolResponse(id, diagnosePayload(resolve(options), platformFromOptions(options)));
  if (name === "run")
    return await runToolResponse(id, args, options);
  return toolResponse(id, `Unknown git_bash tool: ${name}`, true);
}
async function runToolResponse(id, args, options) {
  const platform = platformFromOptions(options);
  if (platform !== "win32")
    return toolResponse(id, "git_bash run is only available on native Windows.", true);
  const command = typeof args.command === "string" ? args.command.trim() : "";
  if (command.length === 0)
    return toolResponse(id, "run.command must be a non-empty string.", true);
  const cwd = parseWorkdir(args);
  if (cwd === null)
    return toolResponse(id, "run.workdir must be a non-empty string when provided.", true);
  const timeoutMs = parseTimeoutMs(args.timeout ?? args.timeout_ms, options);
  if (timeoutMs === null)
    return toolResponse(id, `run.timeout must be an integer between 1 and ${MAX_TIMEOUT_MS}.`, true);
  const resolution = resolve(options);
  if (!resolution.found || resolution.path === null)
    return toolResponse(id, whichBashPayload(resolution), true);
  try {
    const run = options.runGitBash ?? runGitBashCommand;
    const result = await run({ bashPath: resolution.path, command, cwd, timeoutMs, env: options.env ?? process.env });
    return toolResponse(id, runPayload(result));
  } catch (error) {
    return toolResponse(id, error instanceof Error ? error.message : String(error), true);
  }
}
function toolsForOptions(options) {
  const sharedTools = [
    {
      name: "which_bash",
      description: "Resolve the Git Bash bash.exe path used by the git_bash MCP.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false }
    },
    {
      name: "diagnose",
      description: "Report whether Git Bash command execution is available on this host.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false }
    }
  ];
  if (!canRunGitBash(options))
    return sharedTools;
  return [
    {
      name: "run",
      description: "Run a shell command through Git Bash on native Windows. Prefer this git_bash run tool for bash/shell commands on Windows before built-in exec_command or Bash; use exec_command only when git_bash is unavailable or for non-shell operations.",
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string", description: "The command to execute." },
          timeout: {
            type: "integer",
            minimum: 1,
            maximum: MAX_TIMEOUT_MS,
            description: `Optional timeout in milliseconds. If omitted, uses the inherited exec_command timeout when configured; otherwise ${defaultTimeoutMs(options)}ms.`
          },
          workdir: {
            type: "string",
            description: "The working directory to run the command in. Defaults to the current directory. Use this instead of 'cd' commands."
          },
          description: {
            type: "string",
            description: "Clear, concise description of what this command does in 5-10 words."
          }
        },
        required: ["command"],
        additionalProperties: false
      }
    },
    ...sharedTools
  ];
}
function canRunGitBash(options) {
  if (platformFromOptions(options) !== "win32")
    return false;
  const resolution = resolve(options);
  return resolution.found && resolution.path !== null;
}
function resolve(options) {
  if (options.exists === undefined && options.where === undefined) {
    return resolveGitBashForCurrentProcess({
      platform: options.platform,
      env: options.env
    });
  }
  return resolveGitBash({
    platform: platformFromOptions(options),
    env: options.env ?? process.env,
    exists: options.exists ?? (() => false),
    where: options.where ?? (() => [])
  });
}
function platformFromOptions(options) {
  return options.platform ?? process.platform;
}
function whichBashPayload(resolution) {
  return JSON.stringify(resolution, null, 2);
}
function diagnosePayload(resolution, platform) {
  const enabled = platform === "win32" && resolution.found && resolution.path !== null;
  const payload = {
    platform,
    enabled,
    status: platform === "win32" ? enabled ? "ready" : "missing-git-bash" : "disabled: git_bash command execution is only exposed on native Windows",
    resolution
  };
  return JSON.stringify(payload, null, 2);
}
function runPayload(result) {
  return JSON.stringify(result, null, 2);
}
function toolResponse(id, text, isError = false) {
  return successResponse(id, { content: [{ type: "text", text }], isError });
}
function successResponse(id, result) {
  return { jsonrpc: "2.0", id, result };
}
function errorResponse(id, code, message, data) {
  return { jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } };
}
function parseWorkdir(args) {
  const value = args.workdir ?? args.cwd;
  if (value === undefined)
    return;
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
function parseTimeoutMs(value, options) {
  if (value === undefined)
    return defaultTimeoutMs(options);
  return normalizeTimeoutMs(value);
}
function defaultTimeoutMs(options) {
  const configured = normalizeTimeoutMs(options.defaultTimeoutMs);
  if (configured !== null)
    return configured;
  const env = options.env ?? process.env;
  for (const key of EXEC_COMMAND_TIMEOUT_ENV_KEYS) {
    const timeoutMs = normalizeTimeoutMs(env[key]);
    if (timeoutMs !== null)
      return timeoutMs;
  }
  return DEFAULT_TIMEOUT_MS;
}
function normalizeTimeoutMs(value) {
  const parsed = typeof value === "string" && value.trim().length > 0 ? Number(value) : value;
  if (!Number.isInteger(parsed))
    return null;
  const timeoutMs = Number(parsed);
  if (timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS)
    return null;
  return timeoutMs;
}
function protocolVersionFromInput(input) {
  if (!isRecord(input.params))
    return null;
  return typeof input.params.protocolVersion === "string" ? input.params.protocolVersion : null;
}
function parseJsonRpcLine(line) {
  try {
    const parsed = JSON.parse(line);
    return parsed;
  } catch (error) {
    return { jsonrpc: "2.0", id: null, method: null, parseError: error instanceof Error ? error.message : String(error) };
  }
}
function jsonRpcId(value) {
  return typeof value === "string" || typeof value === "number" || value === null ? value : null;
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/cli.ts
async function main() {
  const [command = "mcp"] = argv.slice(2);
  if (command === "mcp") {
    await runMcpStdioServer(process.stdin, process.stdout);
    return;
  }
  stderr.write(`Usage: omo-git-bash [mcp]
`);
  process.exitCode = 2;
}
main().catch((error) => {
  stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}
`);
  process.exitCode = 1;
});
