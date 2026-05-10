# OpenCode Nifty Kit

Portable Nifty integration for OpenCode.

This repo is meant to be versioned in GitHub and pulled into local machines, devcontainers, and other isolated OpenCode environments.

## What This Is

This is an OpenCode plugin kit, not an OpenCode skill.

It gives you:

- Nifty auth helpers
- Raw Nifty API tools for projects, tasks, discussions, and comments
- Higher-level workflow tools for backlog, ready, in-progress, and review flows
- A workflow alias config so each container or user can point OpenCode at different Nifty projects without changing plugin code

## Repo Layout

- `plugin/nifty.js`: plugin source
- `config/nifty-workflows.example.json`: example multi-project workflow config
- `env/nifty.env.example`: environment variable template
- `scripts/install.sh`: install or update into an OpenCode instance
- `scripts/update.sh`: wrapper around install

## Install Into A Container Or Machine

Clone this repo, then run:

```bash
./scripts/install.sh
```

By default this installs into:

```bash
~/.config/opencode
```

Override the target if needed:

```bash
OPENCODE_CONFIG_DIR=/workspace/.opencode ./scripts/install.sh
```

## Configure Credentials

Copy the env template:

```bash
cp env/nifty.env.example .nifty.env
```

Fill in:

- `NIFTY_CLIENT_ID`
- `NIFTY_CLIENT_SECRET`
- `NIFTY_AUTHORIZE_URL`

Optional but recommended:

- `NIFTY_DEFAULT_WORKFLOW`
- `NIFTY_WORKFLOW_CONFIG`

Load that env file before starting OpenCode in the container.

Example:

```bash
set -a
source ./.nifty.env
set +a
opencode
```

## Configure Workflows

Copy the example workflow config:

```bash
cp config/nifty-workflows.example.json ./nifty-workflows.json
```

Then point `NIFTY_WORKFLOW_CONFIG` at it, or let install place the example into the target OpenCode config directory.

Do not edit `config/nifty-workflows.example.json` for container-specific workflow aliases. Keep local/container-specific aliases in `./nifty-workflows.json` or in the installed OpenCode config file. The repo ignores `./nifty-workflows.json` so pulls can update cleanly.

Workflow config lookup order:

1. `NIFTY_WORKFLOW_CONFIG`
2. `nifty-workflows.json` in the active OpenCode project directory/worktree
3. `nifty-workflows.json` in the shell working directory
4. `~/.config/opencode/nifty-workflows.json`

Example config:

```json
{
  "workflows": {
    "addons": {
      "project": { "name": "Addons" },
      "states": {
        "backlog": "Backlog",
        "ready": "To Do",
        "in_progress": "In Progress",
        "review": "Review"
      },
      "lists": {
        "current": "Current"
      }
    }
  }
}
```

Nifty lists are represented by the API as milestones with `is_list=true`. Add optional `lists` aliases when a project needs another planning level beyond status.

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

If the browser cannot reach `127.0.0.1:8787`, forward port `8787` from the container to the host.

## Tools You’ll Use Most

- `nifty_auth_localhost_start`
- `nifty_auth_localhost_login`
- `nifty_health_check`
- `nifty_validate_workflows`
- `nifty_find_project`
- `nifty_list_milestones`
- `nifty_create_milestone`
- `nifty_update_milestone_tasks`
- `nifty_list_labels`
- `nifty_list_workflows`
- `nifty_list_workflow_tasks`
- `nifty_capture_backlog_item`
- `nifty_batch_capture_backlog_items`
- `nifty_prepare_task_for_delivery`
- `nifty_move_task_to_status`

## Example Prompts

- `run nifty_list_workflows`
- `run nifty_health_check`
- `run nifty_validate_workflows`
- `run nifty_find_project with query Addons`
- `run nifty_list_workflow_tasks with state_key backlog`
- `run nifty_list_workflow_tasks with state_key backlog and list_key current`
- `run nifty_capture_backlog_item with name Add retry handling`
- `run nifty_batch_capture_backlog_items with dry_run true`
- `run nifty_prepare_task_for_delivery with task_id <id> state_key ready`
- `run nifty_move_task_to_status with task_id <id> state_key in_progress`

If `NIFTY_DEFAULT_WORKFLOW` is not set, provide `workflow_alias` explicitly.

## Updating Existing Installs

Run:

```bash
git pull
./scripts/update.sh
```

The installer copies the latest plugin into the target OpenCode config and merges any missing example workflow aliases into the existing workflow config without overwriting local edits.

## Validation

Before opening a pull request or after changing the plugin, run:

```bash
npm run lint
npm run format:check
npm test
```
