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

The installer does not need to be run from a specific project directory. When run from a clone, it finds files relative to the script location. When run through `curl | bash`, it downloads the plugin and example workflow config from GitHub. The project directory matters later when OpenCode looks for a project-local `nifty-workflows.json`.

By default this installs into:

```bash
~/.config/opencode
```

Override the target if needed:

```bash
OPENCODE_CONFIG_DIR=/workspace/.opencode ./scripts/install.sh
```

The installer copies `plugin/nifty.js` into `~/.config/opencode/plugins/nifty.js` and merges any missing example workflow aliases into `~/.config/opencode/nifty-workflows.json` without overwriting local edits.

By default the one-line installer downloads from `main`. To install another branch or tag, set `NIFTY_INSTALL_REF`:

```bash
curl -fsSL https://raw.githubusercontent.com/CaveIM/opencode-nifty/main/scripts/install.sh | NIFTY_INSTALL_REF=v1.0.0 bash
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

Workflow aliases connect OpenCode prompts to a specific Nifty project, status names, and list names. Prefer a project-local `nifty-workflows.json` in the repo where OpenCode is launched, because it travels with that project/container without editing the plugin kit.

From your project directory, create a local config:

```bash
cp /path/to/opencode-nifty/config/nifty-workflows.example.json ./nifty-workflows.json
```

Then edit `./nifty-workflows.json` for that project. You can also point `NIFTY_WORKFLOW_CONFIG` at any config file, or let the installer use the copy in the target OpenCode config directory.

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

## Activate In A Project

1. Install the plugin in the environment that runs OpenCode.
2. Put `nifty-workflows.json` in the project root, for example `/workspaces/gov-cms/nifty-workflows.json`.
3. Set `NIFTY_DEFAULT_WORKFLOW` to the alias you want OpenCode to use by default.
4. Start OpenCode from that project root with Nifty env vars loaded.
5. In OpenCode, run the tool `nifty_health_check`.

Example project-local config using the recommended lifecycle:

```json
{
  "workflows": {
    "gov": {
      "project": { "nice_id": "GOV" },
      "states": {
        "ideas": "Ideas",
        "shaping": "Shaping",
        "validated": "Validated",
        "ready": "Ready",
        "in_dev": "In Dev",
        "dev_review": "Dev Review",
        "ready_for_staging": "Ready for Staging",
        "in_staging": "In Staging",
        "ready_for_prod": "Ready for Prod",
        "released": "Released",
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

To have OpenCode generate that shape for a real project, run the OpenCode tool `nifty_recommended_workflow`. To compare a project against the recommended statuses/lists without writing to Nifty, run `nifty_setup_recommended_workflow` with `dry_run true`. To create missing statuses and lists, run the same tool with `dry_run false`.

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

If the browser cannot reach `127.0.0.1:8787`, forward port `8787` from the container to the host.

## Tools You’ll Use Most

- `nifty_auth_localhost_start`
- `nifty_auth_localhost_login`
- `nifty_health_check`
- `nifty_validate_workflows`
- `nifty_recommended_workflow`
- `nifty_setup_recommended_workflow`
- `nifty_find_project`
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
- `nifty_prepare_task_for_delivery`
- `nifty_move_task_to_status`
- `nifty_complete_task`
- `nifty_archive_task`
- `nifty_delete_task`
- `nifty_clone_task`
- `nifty_link_tasks`

## Example Prompts

- `run nifty_list_workflows`
- `run nifty_health_check`
- `run nifty_validate_workflows`
- `run nifty_recommended_workflow with workflow_alias gov and project_nice_id GOV`
- `run nifty_setup_recommended_workflow with workflow_alias gov and project_name "Gov CMS" and dry_run true`
- `run nifty_setup_recommended_workflow with workflow_alias gov and project_name "Gov CMS" and dry_run false`
- `run nifty_find_project with query Addons`
- `run nifty_list_workflow_tasks with state_key backlog`
- `run nifty_list_workflow_tasks with state_key backlog and list_key current`
- `run nifty_capture_backlog_item with name Add retry handling`
- `run nifty_batch_capture_backlog_items with dry_run true`
- `run nifty_create_document with name "Launch notes" and content_text "Draft notes"`
- `run nifty_list_documents`
- `run nifty_prepare_task_for_delivery with task_id <id> state_key ready`
- `run nifty_move_task_to_status with task_id <id> state_key in_progress`
- `run nifty_complete_task with task_id <id>`
- `run nifty_archive_task with task_id <id>`
- `run nifty_link_tasks with task_id <id> and task_ids ["<other-id>"]`

Automated comments created by workflow tools are prefixed with `🤖`. Direct comment tools also default to that marker, but can opt out with `bot_marker false` when the comment is intended to come from a person.

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
