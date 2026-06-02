# OpenCode Nifty Kit

Portable Nifty integration for OpenCode.

This repo is meant to be versioned in GitHub and pulled into local machines, devcontainers, and other isolated OpenCode environments.

## What This Is

This is an OpenCode plugin kit, not an OpenCode skill.

It gives you:

- Nifty auth helpers
- Raw Nifty API tools for projects, tasks, discussions, and comments
- Higher-level workflow tools for ideas, to-do, in-progress, and review flows
- A workflow alias config so each container or user can point OpenCode at different Nifty projects without changing plugin code

## Repo Layout

- `plugin/nifty.js`: plugin source
- `mcp/mcp-server.mjs`: universal MCP bridge — works with any MCP-capable AI coding client
- `mcp/FULL_SPEC.md`: implementation and architecture specification for MCP integration
- `mcp/mcp.example.json`: sample MCP server config
- `config/nifty-workflows.example.json`: example multi-project workflow config
- `env/nifty.env.example`: environment variable template
- `scripts/install.sh`: install or update into an OpenCode instance
- `scripts/update.sh`: wrapper around install
- `scripts/install-copilot.sh`: writes/updates `.vscode/mcp.json` for VS Code / GitHub Copilot MCP usage

## Install Into A Container Or Machine

For a full WSL/devcontainer handoff guide covering OpenCode, GitHub Copilot / VS Code MCP, Codex, and manual VS Code setup, see [`docs/install-wsl-devcontainer.md`](docs/install-wsl-devcontainer.md).

Fast install after this repo is public:

```bash
curl -fsSL https://raw.githubusercontent.com/CaveIM/opencode-nifty/main/scripts/install.sh | bash
```

Or clone this repo into the machine or devcontainer that runs OpenCode, then run the installer:

```bash
git clone git@github.com:CaveIM/opencode-nifty.git
cd opencode-nifty
./scripts/install.sh
```

If the repo is already cloned, run:

```bash
./scripts/install.sh
```

The installer does not need to be run from a specific project directory. When run from a clone, it finds files relative to the script location. When run through `curl | bash`, it downloads the plugin from GitHub. The project directory matters later when you ask OpenCode to create a project-local `nifty-workflows.json`.

By default this installs into:

```bash
~/.config/opencode
```

Override the target if needed:

```bash
OPENCODE_CONFIG_DIR=/workspace/.opencode ./scripts/install.sh
```

The installer copies `plugin/nifty.js` into `~/.config/opencode/plugins/nifty.js` and registers `./plugins/nifty.js` in your global OpenCode config. It also creates a non-overwriting `.nifty.env` template in the directory where you run the installer. It does not create a workflow config file. Create project-local workflow config only when you are ready to connect a project to Nifty.

It also adds global OpenCode guidance in `~/.config/opencode/AGENTS.md` so the model treats phrases like “Nifty health check” as OpenCode tool calls instead of shell commands. Three global slash commands are installed as shortcuts:

- `/nifty-auth`
- `/nifty-health`
- `/nifty-setup`

By default the one-line installer downloads from `main`. To install another branch or tag, set `NIFTY_INSTALL_REF`:

```bash
curl -fsSL https://raw.githubusercontent.com/CaveIM/opencode-nifty/main/scripts/install.sh | NIFTY_INSTALL_REF=v1.0.0 bash
```

## MCP Integration (Any AI Coding Client)

This repo includes a universal MCP server (`mcp/mcp-server.mjs`) that exposes all `nifty_*` tools to **any MCP-capable AI coding client** — GitHub Copilot, Claude Code, Cursor, Windsurf, OpenCode, Gemini CLI, Kimi Code CLI, Codex, and others.

The MCP server speaks standard [MCP stdio protocol](https://modelcontextprotocol.io/). No client-specific code. Point any client at the server with:

```bash
node /path/to/opencode-plugin/mcp/mcp-server.mjs
```

### Per-client install scripts

Use the bundled scripts to generate the correct config file for your client. Each script writes `NIFTY_MCP_ROOT` into the config so `nifty_update_plugin` can keep the server binary up to date in place.

| Client | Script | Config file written |
|--------|--------|--------------------|
| VS Code / GitHub Copilot | `./scripts/install-copilot.sh` | `.vscode/mcp.json` |
| Claude Code (project) | `./scripts/install-claude.sh` | `.mcp.json` |
| Claude Desktop (global) | `./scripts/install-claude.sh --global` | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Cursor (project) | `./scripts/install-cursor.sh` | `.cursor/mcp.json` |
| Cursor (global) | `./scripts/install-cursor.sh --global` | `~/.cursor/mcp.json` |
| Windsurf | `./scripts/install-windsurf.sh` | `~/.codeium/windsurf/mcp_config.json` |
| Codex CLI (project) | `./scripts/install-codex.sh` | `.codex/config.toml` |
| Codex CLI (global) | `./scripts/install-codex.sh --global` | `~/.codex/config.toml` |

Or use npm scripts:

```bash
npm run mcp:install:claude          # project-local .mcp.json
npm run mcp:install:cursor          # project-local .cursor/mcp.json
npm run mcp:install:windsurf        # global ~/.codeium/windsurf/mcp_config.json
npm run mcp:install:codex           # project-local .codex/config.toml
npm run mcp:install:codex:global    # global ~/.codex/config.toml
```

### VS Code / GitHub Copilot

Install the MCP config into `.vscode/mcp.json`:

```bash
./scripts/install-copilot.sh
```

After installing:

1. Ensure Nifty credentials are in `.nifty.env` or exported as `NIFTY_*` env vars.
2. Restart VS Code (or reload the window).
3. Use Copilot chat and call the `nifty_*` tools directly.

Manual start:

```bash
npm run mcp:start
```

### Claude Code

```bash
./scripts/install-claude.sh          # project-local .mcp.json
./scripts/install-claude.sh --global # Claude Desktop global config
```

Manual JSON if you prefer:

```json
{
  "mcpServers": {
    "nifty": {
      "command": "node",
      "args": ["/absolute/path/to/opencode-plugin/mcp/mcp-server.mjs"],
      "env": {
        "NIFTY_WORKTREE": "/absolute/path/to/your/project",
        "NIFTY_MCP_ROOT": "/absolute/path/to/opencode-plugin"
      }
    }
  }
}
```

### Cursor

```bash
./scripts/install-cursor.sh          # project-local .cursor/mcp.json
./scripts/install-cursor.sh --global # global ~/.cursor/mcp.json
```

### Windsurf

```bash
./scripts/install-windsurf.sh        # always writes to global ~/.codeium/windsurf/mcp_config.json
```

### Codex CLI

```bash
./scripts/install-codex.sh          # project-local .codex/config.toml (trusted projects)
./scripts/install-codex.sh --global # global ~/.codex/config.toml
```

Or let Codex manage it directly:

```bash
codex mcp add nifty \
  --env NIFTY_WORKTREE=/path/to/your/project \
  --env NIFTY_MCP_ROOT=/path/to/opencode-plugin \
  -- node /path/to/opencode-plugin/mcp/mcp-server.mjs
```

Manual TOML if you prefer to edit `~/.codex/config.toml` directly:

```toml
[mcp_servers.nifty]
command = "node"
args = ["/absolute/path/to/opencode-plugin/mcp/mcp-server.mjs"]

[mcp_servers.nifty.env]
NIFTY_WORKTREE = "/absolute/path/to/your/project"
NIFTY_MCP_ROOT = "/absolute/path/to/opencode-plugin"
```

### Gemini CLI

Add to `~/.gemini/settings.json` under `mcpServers`:

```json
{
  "mcpServers": {
    "nifty": {
      "command": "node",
      "args": ["/absolute/path/to/opencode-plugin/mcp/mcp-server.mjs"],
      "env": {
        "NIFTY_WORKTREE": "/absolute/path/to/your/project",
        "NIFTY_MCP_ROOT": "/absolute/path/to/opencode-plugin"
      }
    }
  }
}
```

### Kimi Code CLI / Codex and others

Any client that supports MCP stdio servers uses the same config shape. Point `command` at `node` and `args` at the server file. Always include `NIFTY_MCP_ROOT` so the self-update tool works.

Reference specification:

```text
mcp/FULL_SPEC.md
```

### MCP server environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NIFTY_MCP_ROOT` | — | Absolute path to this repo. Required for `nifty_update_plugin` to update the MCP server binary. Set automatically by all install scripts. |
| `NIFTY_MCP_DEBUG` | unset | Set to any value to emit JSON-structured debug logs on stderr (safe for MCP clients that read stdout only). |
| `NIFTY_MCP_PLUGIN_CACHE_TTL_MS` | `300000` | How often the plugin and policy are refreshed from disk (milliseconds). Decrease for faster policy iteration; increase for performance. |
| `NIFTY_MCP_ACTIVE_TASK_ID` | unset | Optional hard override for the task card watched at MCP startup. |
| `NIFTY_MCP_ACTIVE_TASK_STATE_PATH` | `~/.local/state/nifty/mcp-active-task.json` | Durable active-task store keyed by MCP session and worktree, used so reloads resume the same task card. |
| `NIFTY_MCP_PROGRESS_POLL_ENABLED` | `true` | Enables autonomous MCP-side git polling after a task id is observed, so Copilot/Codex/Cursor/Windsurf sessions can update task cards even though host edit/test tools are invisible to MCP. |
| `NIFTY_MCP_PROGRESS_POLL_INTERVAL_MS` | `5000` | Poll interval for worktree change detection. |
| `NIFTY_MCP_PROGRESS_IDLE_TTL_MS` | `1800000` | Stops the observer after this many milliseconds without Nifty tool activity for the task. |
| `NIFTY_MCP_PROGRESS_TEST_COMMAND` | unset | Optional verification command to run after changed-worktree batches; successful runs are posted as autonomous progress comments. |
| `NIFTY_MCP_PROGRESS_TEST_TIMEOUT_MS` | `300000` | Timeout for the optional verification command. |

The MCP observer is fully autonomous once a task id is known from a `nifty_*` call such as `nifty_get_task_full_context`, `nifty_update_task`, or `nifty_create_comment`. It persists that active task per MCP session and worktree, resumes it on MCP server restart, snapshots the git worktree, dedupes repeated signatures, and posts a McBotFace task comment for each new meaningful dirty-worktree batch. It also detects a push when the local branch goes from ahead-of-upstream to no longer ahead. If another task card is opened in the same session/worktree, that newer card becomes active and the previous observer is stopped.

### RAG webhook server (keep index fresh)

The RAG index is kept current by a lightweight webhook server. Start it alongside your development session:

```bash
npm run rag:webhook
```

Point your Nifty workspace webhook at `http://<your-host>:7779/webhook`. The server re-indexes on `task.updated` and `comment.created` events (debounced 30 s) and runs a full nightly sync.

Pre-populate the index:

```bash
npm run rag:index:policy   # indexes policy docs and ADRs
npm run rag:index:tasks    # indexes Nifty task history
```

## Configure Credentials

The installer creates `.nifty.env` in the directory where it runs. If you cloned the kit and want to create one manually, copy the env template:

```bash
cp env/nifty.env.example .nifty.env
```

The template includes the shared Nifty app client ID, authorize URL, and localhost callback URL. Fill in:

- `NIFTY_CLIENT_SECRET`

Optional but recommended:

- `NIFTY_AUTH_PORT` if the localhost callback should use a port other than `8787`
- `NIFTY_DEFAULT_WORKFLOW`

Load that env file before starting OpenCode in the container.

Example:

```bash
set -a
source ./.nifty.env
set +a
opencode
```

## Automatic Lifecycle Policy (Hard Gate)

The plugin now enforces an automatic lifecycle policy for task work in OpenCode plugin mode and across any MCP-connected AI coding client.

Default behavior:

1. When task work starts through task-oriented tools (for example `nifty_get_task`, `nifty_update_task`, `nifty_prepare_task_for_delivery`, `nifty_create_comment` with `task_id`), the plugin auto-moves the task to In Progress.
2. If the task has no assignee, it auto-assigns by policy:
- `NIFTY_AUTOPOLICY_DEFAULT_ASSIGNEE_IDS` when configured.
- otherwise the authenticated Nifty user when `NIFTY_AUTOPOLICY_ASSIGN_SELF=true`.
3. Moving a task to Dev Review is hard-gated by delivery evidence.

Automatic full-context behavior:

1. For task/project-targeted tools, the plugin auto-hydrates full context into agent metadata (task details, comments, subtasks, statuses, milestones, and project summaries).
2. Context hydration works in OpenCode plugin mode and any MCP client.
3. Context hydration is best-effort and non-blocking, while delivery gates remain hard-fail.

Delivery gate requirements for Dev Review:

- `delivery_evidence.red_proof`
- `delivery_evidence.green_proof`
- `delivery_evidence.sad_path_proof`

Visual proof requirement:

- If changed files indicate visual impact (CSS/UI/frontend/view/assets), `delivery_evidence.visual_proof` is required.
- Visual proof URLs are attached to the task comment as external files.
- If the change is non-visual, visual proof is not required.

Policy environment variables:

- `NIFTY_AUTOPOLICY_ENABLED` (default `true`)
- `NIFTY_AUTOPOLICY_ASSIGN_SELF` (default `true`)
- `NIFTY_AUTOPOLICY_DEFAULT_ASSIGNEE_IDS` (comma-separated member IDs)
- `NIFTY_AUTOPOLICY_IN_PROGRESS_STATE` (default `in_progress`)
- `NIFTY_AUTOPOLICY_DEV_REVIEW_STATE` (default `dev_review`)
- `NIFTY_AUTOPOLICY_ENFORCE_DELIVERY_GATE` (default `true`)
- `NIFTY_AUTOCONTEXT_ENABLED` (default `true`)
- `NIFTY_AUTOCONTEXT_COMMENT_LIMIT` (default `200`)
- `NIFTY_AUTOCONTEXT_TASK_LIMIT` (default `200`)

## Configure Workflows

Workflow aliases connect OpenCode prompts to a specific Nifty project, status names, list names, and custom field mappings. The plugin only reads `nifty-workflows.json` from the repo/directory where OpenCode is launched.

The installer does not create this file. From the project root, ask OpenCode to run `nifty_setup_recommended_workflow` with `write_config true` when you are ready to create or merge `./nifty-workflows.json` for that project.

Do not edit `config/nifty-workflows.example.json` for container-specific workflow aliases. Keep local/container-specific aliases in `./nifty-workflows.json`. The repo ignores `./nifty-workflows.json` so pulls can update cleanly.

Workflow config location:

```text
./nifty-workflows.json
```

The plugin does not read workflow config from `.nifty.env`, `NIFTY_WORKFLOW_CONFIG`, or `~/.config/opencode`.

If you need a non-default file for a specific operation, pass `config_path` explicitly to the workflow tool. The plugin never uses a custom path unless you provide it on that tool call.

Example config:

```json
{
  "workflows": {
    "addons": {
      "project": { "name": "Addons" },
      "states": {
        "backlog": "Backlog",
        "todo": "To Do",
        "in_progress": "In Progress",
        "review": "Review"
      },
      "lists": {
        "current": "Current"
      },
      "custom_fields": {
        "area_of_concern": {
          "id": "VYobLAtiyl",
          "name": "SBM area of concern",
          "type": "select",
          "values": {
            "tenant_auth": "Tenant / Auth",
            "deployment": "Deployment"
          }
        }
      }
    }
  }
}
```

Nifty lists are represented by the API as milestones with `is_list=true`. Add optional `lists` aliases when a project needs another planning level beyond status.

Custom fields are mapped from stable workflow keys to Nifty field IDs. Task output is enriched with a `custom_fields` object when mapped fields are present. Use `nifty_update_task_custom_fields` for custom-field-only updates with entries such as `{ "key": "area_of_concern", "value_key": "deployment" }`; it writes each field through Nifty's per-field task endpoint. Task list tools can filter with `custom_field_key` plus `custom_field_value`.

## Activate In A Project

1. Install the plugin in the environment that runs OpenCode.
2. Start OpenCode from the project root with Nifty env vars loaded.
3. Ask OpenCode to find the Nifty project and run `nifty_setup_recommended_workflow` with `write_config true`.
4. Set `NIFTY_DEFAULT_WORKFLOW` to the alias you want OpenCode to use by default.
5. Restart OpenCode from that project root, then run `/nifty-health` or the `nifty_health_check` tool.

Example project-local config using the recommended lifecycle:

```json
{
  "workflows": {
    "gov": {
      "project": { "nice_id": "GOV" },
      "states": {
        "ideas": "Ideas",
        "shaping": "Shaping",
        "shaped": "Shaped",
        "planned": "Planned",
        "not_now": "Not Now",
        "todo": "To Do",
        "in_progress": "In Progress",
        "dev_review": "Dev Review",
        "ready_for_staging": "Ready for Staging",
        "in_staging": "In Staging",
        "ready_for_prod": "Ready for Prod",
        "released": "Released in Prod",
        "done": "Done",
        "blocked": "Blocked"
      },
      "lists": {
        "ui": "UI",
        "api": "API",
        "infrastructure": "Infrastructure",
        "auth": "Auth",
        "billing": "Billing",
        "content": "Content",
        "docs": "Docs",
        "data": "Data/Migrations",
        "devops": "DevOps"
      }
    }
  }
}
```

To have OpenCode generate that shape for a real project, run the OpenCode tool `nifty_recommended_workflow`. To compare a project against the recommended statuses/lists without writing to Nifty, run `nifty_setup_recommended_workflow` with `dry_run true`. To create or merge `./nifty-workflows.json`, add `write_config true`. To create missing statuses and lists in Nifty, run the same tool with `dry_run false`.

These are OpenCode tools, not shell commands. Ask OpenCode to run `nifty_health_check`; do not type `nifty_health_check` in the terminal.

## Typical Multi-Project Pattern

1. Keep this repo in GitHub.
2. Clone it into each devcontainer.
3. Run `./scripts/install.sh`.
4. Load `.nifty.env` before launching OpenCode.
5. Set `NIFTY_DEFAULT_WORKFLOW` per container when one container is focused on one Nifty project.
6. Use `workflow_alias` explicitly when one container needs to operate across multiple projects.

## First-Time Auth

In containerized OpenCode sessions, use the non-blocking auth helper:

```text
run nifty_auth_localhost_start
```

It starts the callback server in the background and immediately returns the browser URL.

If the browser cannot reach `127.0.0.1:8787`, forward port `8787` from the container to the host. If `.nifty.env` sets `NIFTY_AUTH_PORT`, forward that port instead.

## Tools You’ll Use Most

- `nifty_auth_localhost_start`
- `nifty_auth_localhost_login`
- `nifty_update_plugin`
- `nifty_health_check`
- `nifty_validate_workflows`
- `nifty_recommended_workflow`
- `nifty_setup_recommended_workflow`
- `nifty_shape_task`
- `nifty_find_project`
- `nifty_get_project_full_context`
- `nifty_delete_status`
- `nifty_list_milestones`
- `nifty_create_milestone`
- `nifty_update_milestone_tasks`
- `nifty_list_labels`
- `nifty_list_documents`
- `nifty_create_document`
- `nifty_update_document`
- `nifty_delete_document`
- `nifty_list_workflows`
- `nifty_list_workflow_tasks`
- `nifty_capture_backlog_item`
- `nifty_batch_capture_backlog_items`
- `nifty_get_task_full_context`
- `nifty_create_subtask`
- `nifty_prepare_task_for_delivery`
- `nifty_move_task_to_status`
- `nifty_complete_task`
- `nifty_archive_task`
- `nifty_delete_task`
- `nifty_clone_task`
- `nifty_link_tasks`

`nifty_move_task_to_status` and `nifty_prepare_task_for_delivery` accept `delivery_evidence` for Dev Review transitions. Example shape:

```json
{
  "delivery_evidence": {
    "red_proof": "npm test -- test/lifecycle-policy.test.mjs",
    "green_proof": "npm test",
    "sad_path_proof": "verified invalid input returns expected error",
    "visual_proof": ["https://example.com/screenshot.png"],
    "changed_files": ["frontend/src/app/page.tsx"],
    "notes": "All required checks passed"
  }
}
```

Use `nifty_create_subtask` when the requested work is an execution step under an existing parent task. Use `nifty_create_task` or workflow task tools for independent backlog or workflow items.

Use `nifty_shape_task` to turn a short feature idea or existing rough task into a dev-ready task. Call it with the current answers, ask exactly the returned `next_question`, and repeat one question at a time until `ready: true`. Finalizing can update an existing task or create a new one. Proposed subtasks are only created when `create_subtasks` is true and the exact `subtask_confirmation` phrase is provided.

Before creating or preparing shaped tasks, answer open questions with the user. The plugin blocks unresolved `open_questions` instead of writing them into Nifty task descriptions.

Bulk task deletion requires an explicit confirmation phrase such as `delete 3 tasks`. Ask the user before providing that phrase.

Use `nifty_update_plugin` to update the installed plugin from GitHub. If it reports `updated: false`, there is no newer plugin available. If it reports `updated: true`, restart OpenCode so the new plugin version is loaded.

For deep task/project understanding by coding agents, use:

- `nifty_get_task_full_context` to load full task details, description, comments, subtasks, project status map, and milestone context.
- `nifty_get_project_full_context` to load full project context, workflow mapping, status distribution, and document/task snapshots.

## Example Prompts

- `run nifty_list_workflows`
- `/nifty-auth`
- `/nifty-update`
- `run nifty_health_check`
- `/nifty-health`
- `/nifty-setup`
- `run nifty_validate_workflows`
- `run nifty_recommended_workflow with workflow_alias gov and project_nice_id GOV`
- `run nifty_setup_recommended_workflow with workflow_alias gov and project_name "Gov CMS" and dry_run true`
- `run nifty_setup_recommended_workflow with workflow_alias gov and project_name "Gov CMS" and dry_run true and write_config true`
- `run nifty_setup_recommended_workflow with workflow_alias gov and project_name "Gov CMS" and dry_run false`
- `run nifty_find_project with query Addons`
- `run nifty_list_workflow_tasks with state_key backlog`
- `run nifty_list_workflow_tasks with state_key backlog and list_key current`
- `run nifty_capture_backlog_item with name Add retry handling`
- `run nifty_batch_capture_backlog_items with dry_run true`
- `run nifty_create_document with name "Launch notes" and content_text "Draft notes"`
- `run nifty_list_documents`
- `run nifty_prepare_task_for_delivery with task_id <id> state_key todo`
- `run nifty_move_task_to_status with task_id <id> state_key in_progress`
- `run nifty_complete_task with task_id <id>`
- `run nifty_archive_task with task_id <id>`
- `run nifty_link_tasks with task_id <id> and task_ids ["<other-id>"]`

Automated comments created by workflow tools are prefixed with `🤖 McBotFace`. Direct comment tools also default to that marker, but can opt out with `bot_marker false` when the comment is intended to come from a person.

If `NIFTY_DEFAULT_WORKFLOW` is not set, provide `workflow_alias` explicitly.

## Updating Existing Installs

Run:

```bash
git pull
./scripts/update.sh
```

The installer copies the latest plugin into the target OpenCode config and updates OpenCode guidance/commands. It does not create or modify workflow config files.

## Validation

Before opening a pull request or after changing the plugin, run:

```bash
npm run lint
npm run format:check
npm test
```
