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
      }
    }
  }
}
```

## Typical Multi-Project Pattern

1. Keep this repo in GitHub.
2. Clone it into each devcontainer.
3. Run `./scripts/install.sh`.
4. Load `.nifty.env` before launching OpenCode.
5. Set `NIFTY_DEFAULT_WORKFLOW` per container when one container is focused on one Nifty project.
6. Use `workflow_alias` explicitly when one container needs to operate across multiple projects.

## Tools You’ll Use Most

- `nifty_auth_localhost_login`
- `nifty_list_workflows`
- `nifty_list_workflow_tasks`
- `nifty_capture_backlog_item`
- `nifty_prepare_task_for_delivery`
- `nifty_move_task_to_status`

## Example Prompts

- `run nifty_list_workflows`
- `run nifty_list_workflow_tasks with state_key backlog`
- `run nifty_capture_backlog_item with name Add retry handling`
- `run nifty_prepare_task_for_delivery with task_id <id> state_key ready`
- `run nifty_move_task_to_status with task_id <id> state_key in_progress`

If `NIFTY_DEFAULT_WORKFLOW` is not set, provide `workflow_alias` explicitly.
