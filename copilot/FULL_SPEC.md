# GitHub Copilot Integration Specification

## 1. Objective

Provide full GitHub Copilot compatibility for this repository's Nifty plugin by exposing every `nifty_*` tool through a Model Context Protocol (MCP) stdio server, with no feature reduction and no duplicate business logic.

Additionally enforce automatic task lifecycle policy behavior shared with OpenCode:

- auto move to In Progress when task work begins,
- auto assignee policy,
- hard Dev Review delivery gate with TDD + sad-path proof,
- hard visual-proof requirement only for visual-impacting changes.

Additionally provide automatic context hydration so coding agents get full task and project context without manual prompting.

## 2. Scope

Included:

- Full export of all OpenCode Nifty tools (`NiftyPlugin().tool`) through MCP.
- Runtime argument validation using the existing Zod schemas from each tool.
- JSON Schema generation for all tool inputs for MCP discovery.
- Copilot-compatible execution context adapter (`directory`, `worktree`, `metadata`, `abort`).
- Installation script to register the MCP server in `.vscode/mcp.json`.
- Documentation and configuration example for repeatable setup.
- Automatic metadata hydration with full task/project context for task/project-targeted tool calls.

Out of scope:

- Rewriting existing `plugin/nifty.js` business logic.
- Altering Nifty API behavior.

## 3. Architecture

### 3.1 Components

1. `plugin/nifty.js`
- Source of truth for all Nifty tool implementations.

2. `copilot/mcp-server.mjs`
- MCP transport and tool adapter layer.
- Converts OpenCode tools to MCP tools without re-implementing logic.

3. `scripts/install-copilot.sh`
- Writes or updates `.vscode/mcp.json` with an MCP server entry.

4. `copilot/mcp.example.json`
- Reference config for manual setup.

### 3.2 Data Flow

1. Copilot calls MCP `tools/list`.
2. MCP server loads `NiftyPlugin()` and enumerates every `nifty_*` tool.
3. Input schemas are generated from tool Zod args.
4. Copilot calls MCP `tools/call`.
5. MCP server validates input using tool Zod schema.
6. MCP server invokes original tool `execute(args, context)`.
7. Tool output is normalized to text and returned to Copilot.

## 4. Interface Contract

### 4.1 Tool discovery

- `buildMcpToolCatalog(tools)` returns an entry for every loaded tool:
- `name`
- `description`
- `inputSchema`

### 4.2 Input validation

- `runNiftyTool()` validates `rawArgs` with `z.object(definition.args)`.
- Invalid arguments return a descriptive validation error with field paths.

### 4.3 Execution context

- `createCopilotExecutionContext()` provides:
- `abort`: MCP cancellation signal.
- `directory`: workspace directory (`NIFTY_WORKTREE` or process cwd).
- `worktree`: same default as `directory`.
- `metadata(key, value?)`: get/set metadata values.
- `ask()`: explicitly disabled in Copilot bridge.

## 5. Security and Config

1. Credentials remain in `.nifty.env` or exported env vars.
2. MCP install script sets `NIFTY_WORKTREE` so project-local config resolution works.
3. No secrets are written by the MCP server itself.
4. Existing OAuth/token behavior in `plugin/nifty.js` remains the source of truth.

## 6. Operational Requirements

1. Node.js 20+.
2. Installed dependencies:
- `@opencode-ai/plugin`
- `@modelcontextprotocol/sdk`
- `zod`
3. Start command:
- `node copilot/mcp-server.mjs`

## 7. Installation Contract

Preferred installation:

```bash
./scripts/install-copilot.sh
```

Result:

- Writes `.vscode/mcp.json`
- Registers MCP server name `nifty` (configurable)
- Points to `copilot/mcp-server.mjs`
- Sets `NIFTY_WORKTREE`

## 8. Testing Contract

`test/copilot-mcp.test.mjs` verifies:

1. Full tool loading from `NiftyPlugin`.
2. JSON schema generation for tool args.
3. One-to-one MCP catalog mapping for all tools.
4. Runtime execution through Copilot context.

## 9. Failure Handling

1. Unknown tool name: hard error.
2. Non-executable tool definition: hard error.
3. Invalid args: explicit field-level validation error.
4. Startup failure: stderr message and non-zero exit.
5. Dev Review transition without required delivery evidence: hard error.
6. Visual-impacting change without screenshot/video proof in `delivery_evidence.visual_proof`: hard error.

## 10. Backward Compatibility

- OpenCode plugin behavior and APIs are unchanged.
- Copilot integration is additive and can be removed independently.
