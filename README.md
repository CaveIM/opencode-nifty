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

## Configure Credentials

The installer creates `.nifty.env` in the directory where it runs. If you cloned the kit and want to create one manually, copy the env template:

```bash
cp env/nifty.env.example .nifty.env
```

The template includes the shared Nifty app client ID, authorize URL, and localhost callback URL. Fill in:

- `NIFTY_CLIENT_SECRET`

Optional but recommended:

- `NIFTY_DEFAULT_WORKFLOW`

Load that env file before starting OpenCode in the container.

Example:

```bash
set -a
source ./.nifty.env
set +a
opencode
```

## Configure Workflows

Workflow aliases connect OpenCode prompts to a specific Nifty project, status names, and list names. The plugin only reads `nifty-workflows.json` from the repo/directory where OpenCode is launched.

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
      }
    }
  }
}
```

Nifty lists are represented by the API as milestones with `is_list=true`. Add optional `lists` aliases when a project needs another planning level beyond status.

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

If the browser cannot reach `127.0.0.1:8787`, forward port `8787` from the container to the host.

## Tools You’ll Use Most

- `nifty_auth_localhost_start`
- `nifty_auth_localhost_login`
- `nifty_update_plugin`
- `nifty_health_check`
- `nifty_validate_workflows`
- `nifty_recommended_workflow`
- `nifty_setup_recommended_workflow`
- `nifty_find_project`
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
- `nifty_create_subtask`
- `nifty_prepare_task_for_delivery`
- `nifty_move_task_to_status`
- `nifty_complete_task`
- `nifty_archive_task`
- `nifty_delete_task`
- `nifty_clone_task`
- `nifty_link_tasks`

Use `nifty_create_subtask` when the requested work is an execution step under an existing parent task. Use `nifty_create_task` or workflow task tools for independent backlog or workflow items.

Before creating or preparing shaped tasks, answer open questions with the user. The plugin blocks unresolved `open_questions` instead of writing them into Nifty task descriptions.

Bulk task deletion requires an explicit confirmation phrase such as `delete 3 tasks`. Ask the user before providing that phrase.

Use `nifty_update_plugin` to update the installed plugin from GitHub. If it reports `updated: false`, there is no newer plugin available. If it reports `updated: true`, restart OpenCode so the new plugin version is loaded.

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

Automated comments created by workflow tools are prefixed with `🤖`. Direct comment tools also default to that marker, but can opt out with `bot_marker false` when the comment is intended to come from a person.

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
