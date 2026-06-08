# Cave Meister Orchestrator

AI work orchestration for Nifty, built first as an OpenCode plugin and also exposed as a universal MCP server.

Current package: `opencode-nifty-kit` v0.0.1.

This is not just a raw Nifty API wrapper. The runtime layers are:

1. **RAG context** - bounded historical task/comment recall plus policy citations from LanceDB.
2. **Orchestrator** - deterministic policy, bootstrap, lifecycle, subtask, evidence, and automation gates.
3. **Nifty tools** - authenticated operations against Nifty projects, tasks, docs, milestones, comments, statuses, labels, and workflows.

The source of truth for the OpenCode plugin is `plugin/nifty.js`. The same `nifty_*` tools are adapted to MCP by `mcp/mcp-server.mjs`.

## What This Plugin Does

- Connects OpenCode to Nifty through OAuth or exported `NIFTY_*` credentials.
- Exposes 62 `nifty_*` tools for project, task, document, milestone, label, discussion, comment, workflow, and auth operations.
- Injects RAG context from `nifty-tasks` and `nifty-policy` LanceDB tables before tool execution when available.
- Enforces policy-as-code at the tool boundary before mutating Nifty.
- Requires full task or project context before dangerous mutations through the bootstrap gate.
- Keeps parent task cards separate from Nifty subtasks, so agents do not treat checklist rows as full task cards.
- Auto-hydrates task and project context for task/project-targeted tool calls.
- Auto-starts lifecycle work by moving tasks to In Progress and assigning the configured assignee when policy allows.
- Hard-gates Dev Review and delivery comments with RED/GREEN/sad-path evidence, architecture/regression proof, and visual proof for UI-impacting changes.
- Posts structured Cave Updater progress comments and suppresses routine lifecycle noise by default.
- Provides MCP support for Copilot, Claude Code, Cursor, Windsurf, Codex, Gemini CLI, Kimi Code CLI, and other MCP clients without duplicating business logic.

## Runtime Architecture

```text
OpenCode or MCP client
  -> nifty_* tool call
  -> policy gate
  -> bootstrap context gate
  -> subtask/entity-kind gate
  -> auto task/project hydration
  -> auto lifecycle start
  -> RAG context injection
  -> Nifty API tool execution
  -> bootstrap registration and automation progress handling
```

Important boundaries:

- RAG is context only. It is fail-soft and never becomes a write authority.
- Policy gates are deterministic and can hard-fail tool calls.
- The bootstrap gate is required before mutating a known task or project.
- MCP uses the same plugin tools, plus MCP-specific active-task persistence and optional remote policy gateway checks.

## Repo Layout

- `plugin/nifty.js` - OpenCode plugin, tool catalog, policy wrapper, lifecycle orchestration, Nifty API integration.
- `plugin/rag.mjs` - RAG query fanout, LanceDB table cache, bounded result shaping, diagnostics.
- `mcp/mcp-server.mjs` - MCP stdio server exposing every `nifty_*` tool from the plugin.
- `policy/nifty-ai-policy.json` - default deterministic AI policy and reporting standards.
- `policy/nifty-ai-policy.schema.json` - policy schema.
- `scripts/install.sh` - installs or updates the OpenCode plugin.
- `scripts/update.sh` - update wrapper around the installer.
- `scripts/index-nifty-tasks.mjs` - indexes Nifty tasks and comments into `nifty-tasks`.
- `scripts/index-policy-docs.mjs` - indexes policies, reporting rules, automation rules, ADRs, and docs into `nifty-policy`.
- `scripts/rag-webhook.mjs` - webhook server for keeping RAG indexes fresh.
- `scripts/install-*.sh` - MCP config writers for Copilot, Claude, Cursor, Windsurf, and Codex.
- `config/nifty-workflows.example.json` - example workflow alias config.
- `env/nifty.env.example` - local credential template. Do not commit real `.nifty.env` files.
- `docs/rag-architecture.md` - production RAG architecture and verification notes.
- `mcp/FULL_SPEC.md` - MCP integration specification.
- `test/*.mjs` - Node test suite for auth, policy, RAG, MCP, lifecycle, and tool behavior.

## Install From `dev-tony`

Use this while the team build lives on the `dev-tony` branch.

```bash
curl -fsSL https://raw.githubusercontent.com/CaveIM/opencode-nifty/dev-tony/scripts/install.sh | bash
```

That command is intentionally pinned to `dev-tony`: the `dev-tony` branch installer defaults to `NIFTY_INSTALL_REF=dev-tony`, so it downloads `plugin/nifty.js` from the same branch even when run through `curl | bash`.

The installer:

- installs `plugin/nifty.js` to `~/.config/opencode/plugins/nifty.js` by default,
- registers `./plugins/nifty.js` in `~/.config/opencode/opencode.json` or `opencode.jsonc`,
- ensures `@opencode-ai/plugin` is installed in the OpenCode config directory,
- writes OpenCode guidance into `~/.config/opencode/AGENTS.md`,
- installs slash commands `/nifty-auth`, `/nifty-health`, `/nifty-update`, and `/nifty-setup`,
- creates a non-overwriting `.nifty.env` template in the directory where you run the installer.

If you need a project-local OpenCode config, keep the same one-liner and set `OPENCODE_CONFIG_DIR`:

```bash
curl -fsSL https://raw.githubusercontent.com/CaveIM/opencode-nifty/dev-tony/scripts/install.sh | OPENCODE_CONFIG_DIR=/workspace/.opencode bash
```

Restart OpenCode after installing so it loads the plugin.

Clone-based install from `dev-tony`:

```bash
git clone --branch dev-tony --single-branch git@github.com:CaveIM/opencode-nifty.git
cd opencode-nifty
./scripts/install.sh
```

Update an existing clone and reinstall:

```bash
git checkout dev-tony
git pull --ff-only origin dev-tony
./scripts/update.sh
```

Install into a project-local OpenCode config instead of the global one:

```bash
OPENCODE_CONFIG_DIR=/workspace/.opencode ./scripts/install.sh
```

## Requirements

- Node.js 20 or newer.
- OpenCode with plugin support.
- `npm` for installing `@opencode-ai/plugin` in the target OpenCode config directory.
- Nifty OAuth app credentials or an access token.
- Optional: `@lancedb/lancedb` for RAG. It is listed as an optional dependency.

## Configure Credentials

The installer creates `.nifty.env` if one does not exist. You can also create it manually:

```bash
cp env/nifty.env.example .nifty.env
```

Fill in at least:

- `NIFTY_CLIENT_SECRET`

Then load credentials before starting OpenCode:

```bash
set -a
source ./.nifty.env
set +a
opencode
```

Common credential variables:

- `NIFTY_CLIENT_ID`
- `NIFTY_CLIENT_SECRET`
- `NIFTY_AUTHORIZE_URL`
- `NIFTY_REDIRECT_URI`
- `NIFTY_ACCESS_TOKEN` for direct token override
- `NIFTY_TOKEN_PATH` for cached OAuth token location
- `NIFTY_AUTH_PORT` for the localhost OAuth callback port

Do not commit `.nifty.env`.

## First-Time Auth In OpenCode

After installing and restarting OpenCode, run the slash command:

```text
/nifty-auth
```

In a devcontainer or remote environment, the plugin uses `nifty_auth_localhost_start`, which starts the callback server in the background and returns the browser URL. Forward the configured auth port, usually `8787`, if your browser cannot reach the callback server.

For direct local auth, the tool `nifty_auth_localhost_login` can complete the browser callback inline.

## Configure Workflows

Workflow aliases connect natural prompts to a Nifty project, statuses, lists, and custom fields. The plugin reads workflow config from the OpenCode launch directory:

```text
./nifty-workflows.json
```

The installer does not create this file automatically. From the project root, ask OpenCode to run:

```text
run nifty_setup_recommended_workflow with write_config true
```

Use `dry_run true` before creating or changing Nifty statuses/lists. Use `dry_run false` only when you want the plugin to create missing Nifty workflow objects.

Example shape:

```json
{
  "workflows": {
    "gov": {
      "project": { "nice_id": "GOV" },
      "states": {
        "ideas": "Ideas",
        "todo": "To Do",
        "in_progress": "In Progress",
        "dev_review": "Dev Review",
        "done": "Done",
        "blocked": "Blocked"
      },
      "lists": {
        "api": "API",
        "ui": "UI",
        "docs": "Docs"
      }
    }
  }
}
```

Set `NIFTY_DEFAULT_WORKFLOW=gov` when one project should be the default.

## RAG Context Layer

RAG is enabled by default through `NIFTY_RAG_ENABLED=true`. It searches two LanceDB tables:

- `nifty-tasks` - Nifty tasks and comments.
- `nifty-policy` - policy JSON, reporting standards, automation rules, ADRs, and docs.

Build or refresh the indexes:

```bash
npm run rag:index:policy
npm run rag:index:tasks
```

Keep task/comment history fresh with the webhook server:

```bash
npm run rag:webhook
```

RAG behavior from code:

- builds bounded query fanout from tool name, ids, semantic args, file paths, and nested delivery evidence,
- skips secret-like keys such as tokens, passwords, cookies, and authorization headers,
- opens tables through a TTL cache,
- dedupes and bounds result text,
- returns empty context on missing LanceDB, missing tables, search errors, or timeouts,
- never blocks tool execution unless health is explicitly configured to require RAG readiness.

Important RAG variables:

- `NIFTY_RAG_ENABLED` default `true`
- `NIFTY_RAG_REQUIRED` default `false`
- `NIFTY_RAG_INDEX_PATH` default `~/.config/opencode/nifty-rag`
- `NIFTY_RAG_TASK_LIMIT` default `5`
- `NIFTY_RAG_POLICY_LIMIT` default `3`
- `NIFTY_RAG_TIMEOUT_MS` default `2000`
- `NIFTY_RAG_QUERY_FANOUT` default `4`
- `NIFTY_RAG_MAX_QUERY_CHARS` default `700`
- `NIFTY_RAG_MAX_RESULT_TEXT_CHARS` default `1200`
- `NIFTY_RAG_CACHE_TTL_MS` default `300000`

Run `nifty_health_check` to inspect RAG readiness, table availability, cache state, and runtime limits.

## Orchestrator And Policy Layer

Every `nifty_*` tool is wrapped by `withLifecyclePolicy()` in `plugin/nifty.js`.

The wrapper enforces this order before the underlying Nifty tool runs:

1. Central policy gate.
2. Bootstrap context gate for mutating task/project operations.
3. Subtask/entity-kind gate.
4. Best-effort task/project context hydration.
5. Best-effort lifecycle auto-start.
6. Best-effort RAG context injection.

The default policy lives at `policy/nifty-ai-policy.json`. It includes:

- structured reporting requirements,
- RED/GREEN TDD proof requirements,
- regression and architecture proof requirements,
- visual proof requirements for UI-impacting work,
- bulk-delete and workflow-object deletion controls,
- progress comment milestones,
- task context loss handling.

Important policy and automation variables:

- `NIFTY_POLICY_PATH`
- `NIFTY_POLICY_REQUIRED`
- `NIFTY_BOOTSTRAP_REQUIRED` default `true`
- `NIFTY_AUTOPOLICY_ENABLED` default `true`
- `NIFTY_AUTOPOLICY_ASSIGN_SELF` default `true`
- `NIFTY_AUTOPOLICY_DEFAULT_ASSIGNEE_IDS`
- `NIFTY_AUTOPOLICY_IN_PROGRESS_STATE` default `in_progress`
- `NIFTY_AUTOPOLICY_DEV_REVIEW_STATE` default `dev_review`
- `NIFTY_AUTOPOLICY_ENFORCE_DELIVERY_GATE` default `true`
- `NIFTY_AUTOCONTEXT_ENABLED` default `true`
- `NIFTY_AUTOCONTEXT_COMMENT_LIMIT` default `200`
- `NIFTY_AUTOCONTEXT_TASK_LIMIT` default `200`
- `NIFTY_AUTOMATION_ACTIVE_TASK_ID`

## Parent Task Cards And Subtasks

The plugin treats these as different entities:

- Parent task cards are valid targets for status changes, Dev Review, delivery comments, labels, documents, archive/delete, and full lifecycle handling.
- Nifty subtasks are checklist execution rows under a parent card.

Task-card-only tools hard-deny when the target resolves to a subtask. Use:

- `nifty_complete_child_task` for the production child-task completion workflow,
- `nifty_complete_task` for low-level explicit subtask check/uncheck,
- `nifty_create_subtask` only with a parent task-card id.

## MCP Mode

The MCP server exposes the same plugin tools to any MCP-capable AI client:

```bash
npm run mcp:start
```

Per-client config helpers:

```bash
npm run mcp:install:claude
npm run mcp:install:cursor
npm run mcp:install:windsurf
npm run mcp:install:codex
npm run mcp:install:codex:global
./scripts/install-copilot.sh
```

Manual MCP command:

```bash
node /absolute/path/to/opencode-nifty/mcp/mcp-server.mjs
```

Set these in MCP env:

- `NIFTY_WORKTREE` - project worktree used for local workflow config and progress detection.
- `NIFTY_MCP_ROOT` - absolute path to this repo, used by self-update.
- `NIFTY_MCP_DEBUG` - emits structured debug logs to stderr.

MCP-specific orchestration:

- `NIFTY_POLICY_GATEWAY_MODE=shadow|enforce`
- `NIFTY_POLICY_GATEWAY_URL`
- `NIFTY_POLICY_GATEWAY_TOKEN`
- `NIFTY_POLICY_GATEWAY_TIMEOUT_MS` default `10000`
- `NIFTY_MCP_ACTIVE_TASK_ID`
- `NIFTY_MCP_ACTIVE_TASK_STATE_PATH` default `~/.local/state/nifty/mcp-active-task.json`
- `NIFTY_MCP_PROGRESS_POLL_ENABLED` default `true`
- `NIFTY_MCP_PROGRESS_POLL_INTERVAL_MS` default `5000`
- `NIFTY_MCP_PROGRESS_IDLE_TTL_MS` default `1800000`
- `NIFTY_MCP_PROGRESS_TEST_COMMAND`
- `NIFTY_MCP_PROGRESS_TEST_TIMEOUT_MS` default `300000`

Dirty-worktree batches are observed but do not create comments by themselves. The MCP observer posts a Cave Updater progress comment only when `NIFTY_MCP_PROGRESS_TEST_COMMAND` succeeds or when repository sync transitions from ahead-of-upstream to no longer ahead.

## Tool Catalog

The current plugin defines these tools:

### Auth And Health

- `nifty_auth_help`
- `nifty_auth_exchange_code`
- `nifty_auth_localhost_login`
- `nifty_auth_localhost_start`
- `nifty_me`
- `nifty_health_check`
- `nifty_update_plugin`

### Projects, Workflows, And Members

- `nifty_list_projects`
- `nifty_find_project`
- `nifty_get_project_full_context`
- `nifty_list_members`
- `nifty_list_workflows`
- `nifty_validate_workflows`
- `nifty_recommended_workflow`
- `nifty_setup_recommended_workflow`

### Statuses, Milestones, Labels, Documents

- `nifty_list_statuses`
- `nifty_delete_status`
- `nifty_list_milestones`
- `nifty_get_milestone`
- `nifty_create_milestone`
- `nifty_update_milestone`
- `nifty_update_milestone_tasks`
- `nifty_list_labels`
- `nifty_create_label`
- `nifty_update_label`
- `nifty_list_documents`
- `nifty_get_document`
- `nifty_create_document`
- `nifty_update_document`
- `nifty_delete_document`
- `nifty_move_document`
- `nifty_update_document_labels`

### Tasks And Lifecycle

- `nifty_shape_task`
- `nifty_list_workflow_tasks`
- `nifty_capture_backlog_item`
- `nifty_batch_capture_backlog_items`
- `nifty_list_tasks`
- `nifty_get_task`
- `nifty_get_task_full_context`
- `nifty_run_task`
- `nifty_complete_child_task`
- `nifty_create_task`
- `nifty_create_subtask`
- `nifty_update_task`
- `nifty_update_task_custom_fields`
- `nifty_update_task_assignees`
- `nifty_delete_task`
- `nifty_delete_tasks`
- `nifty_complete_task`
- `nifty_archive_task`
- `nifty_clone_task`
- `nifty_link_tasks`
- `nifty_update_task_labels`
- `nifty_attach_task_document`
- `nifty_move_tasks`
- `nifty_move_task_to_status`
- `nifty_prepare_task_for_delivery`

### Discussions And Comments

- `nifty_list_discussions`
- `nifty_get_discussion`
- `nifty_list_messages`
- `nifty_create_comment`
- `nifty_update_comment`

## Typical OpenCode Workflow

1. Install from `dev-tony` and restart OpenCode.
2. Load `.nifty.env` or export credentials.
3. Run `/nifty-auth`.
4. Run `/nifty-health` or ask OpenCode to call `nifty_health_check`.
5. Generate or validate `./nifty-workflows.json` with `nifty_setup_recommended_workflow`.
6. Index RAG policy and tasks if the team wants historical context.
7. Start work with `nifty_run_task` or `nifty_get_task_full_context` for a task card.
8. Let the orchestrator enforce context, lifecycle, evidence, and delivery gates.

Example prompts inside OpenCode:

- `run nifty_health_check`
- `run nifty_find_project with query Addons`
- `run nifty_setup_recommended_workflow with workflow_alias gov and project_nice_id GOV and dry_run true`
- `run nifty_get_task_full_context with task_id MBC-462`
- `run nifty_run_task with task_id MBC-462`
- `run nifty_prepare_task_for_delivery with task_id MBC-462 and state_key dev_review`

These are OpenCode tool requests, not terminal commands.

## Validation

Before changing the plugin or opening a PR, run:

```bash
npm run lint
npm run format:check
npm test
```

RAG-specific verification:

```bash
npx -y node@20 --test test/rag.test.mjs test/rag-http.test.mjs
```

## Security Notes

- Do not commit `.nifty.env`, access tokens, client secrets, or policy gateway tokens.
- RAG skips secret-like keys during query construction and is not a policy authority.
- Mutating tools are guarded by deterministic local policy and optional MCP remote policy gateway checks.
- Routine lifecycle noise is suppressed by default; delivery comments must use structured evidence.

## More Detail

- RAG architecture: `docs/rag-architecture.md`
- MCP integration: `mcp/FULL_SPEC.md`
- Default policy: `policy/nifty-ai-policy.json`
- Example workflow config: `config/nifty-workflows.example.json`
