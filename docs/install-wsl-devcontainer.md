# Installing Nifty MCP In WSL Or Devcontainers

This guide is for users who receive the Nifty MCP package as a handoff archive instead of cloning the private repository.

It covers installation in:

- WSL
- VS Code devcontainers
- OpenCode
- GitHub Copilot / VS Code MCP
- Codex CLI
- Manual VS Code MCP config

## Mental Model

Keep two paths separate:

```text
MCP_ROOT      = where this Nifty MCP package is extracted
PROJECT_ROOT  = the project the AI coding agent will edit
```

Example:

```text
MCP_ROOT      = ~/tools/opencode-nifty
PROJECT_ROOT  = ~/code/my-app
```

The MCP server runs from:

```text
$MCP_ROOT/mcp/mcp-server.mjs
```

The AI coding app should work inside:

```text
$PROJECT_ROOT
```

For MCP clients, `NIFTY_WORKTREE` should point at `PROJECT_ROOT`. The plugin reads `.nifty.env` from `NIFTY_WORKTREE`, the tool context directory, or the current process directory.

## Requirements

Install these inside the same environment that will run the MCP server:

- Linux shell, WSL, or devcontainer terminal
- Node.js 20 or 22
- npm
- The AI coding app or CLI you want to connect
- A stable folder where the package can stay installed

Check Node:

```bash
node --version
npm --version
```

If `node --version` is older than 20, install Node 20+ with your preferred Node version manager before continuing.

## Unpack The Handoff Archive

Put the archive somewhere reachable from WSL or the devcontainer. For best WSL performance, extract it into the Linux filesystem, not under `/mnt/c`.

Example for WSL:

```bash
mkdir -p ~/tools/opencode-nifty
tar -xzf /mnt/c/Users/YOUR_USER/Downloads/opencode-nifty-mcp.tar.gz -C ~/tools/opencode-nifty
cd ~/tools/opencode-nifty
npm ci
```

Example for a devcontainer:

```bash
mkdir -p /workspaces/tools/opencode-nifty
tar -xzf /workspaces/opencode-nifty-mcp.tar.gz -C /workspaces/tools/opencode-nifty
cd /workspaces/tools/opencode-nifty
npm ci
```

Verify the package:

```bash
test -f mcp/mcp-server.mjs
test -f plugin/nifty.js
test -f scripts/install-copilot.sh
test -f scripts/install-codex.sh
```

## Configure Nifty Credentials

Create `.nifty.env` in the project where the AI coding agent will work:

```bash
cd /path/to/your/project
cp /path/to/opencode-nifty/env/nifty.env.example .nifty.env
chmod 600 .nifty.env
```

Edit `.nifty.env` and fill the values your organization provides:

```env
NIFTY_CLIENT_ID=...
NIFTY_CLIENT_SECRET=...
NIFTY_AUTHORIZE_URL=...
NIFTY_REDIRECT_URI=http://127.0.0.1:8787/callback

# Optional
NIFTY_AUTH_PORT=8787
NIFTY_DEFAULT_WORKFLOW=
```

Do not put `NIFTY_CLIENT_SECRET`, access tokens, or refresh tokens in MCP JSON/TOML config files. Keep them in `.nifty.env` or exported environment variables only.

Do not send `.nifty.env` back to the package maintainer. It is a local secret file.

## Install For OpenCode

OpenCode uses the plugin installer, not the MCP client installers.

Run this from `MCP_ROOT`:

```bash
cd /path/to/opencode-nifty
./scripts/install.sh
```

By default it installs into:

```text
~/.config/opencode
```

To install into a custom OpenCode config directory:

```bash
OPENCODE_CONFIG_DIR=/path/to/opencode-config ./scripts/install.sh
```

Start OpenCode from the project root with env vars loaded:

```bash
cd /path/to/your/project
set -a
source ./.nifty.env
set +a
opencode
```

First use:

```text
/nifty-auth
```

or ask OpenCode to run:

```text
nifty_auth_localhost_start
```

Open the returned URL in your browser, approve Nifty access, then run:

```text
/nifty-health
```

or:

```text
nifty_health_check
```

## Install For GitHub Copilot / VS Code MCP

Use this when VS Code with GitHub Copilot Chat is the MCP client.

Run from the project root that VS Code will open:

```bash
cd /path/to/your/project

MCP_ROOT=/path/to/opencode-nifty
NIFTY_COPILOT_MCP_FILE="$PWD/.vscode/mcp.json" \
NIFTY_WORKTREE="$PWD" \
"$MCP_ROOT/scripts/install-copilot.sh"
```

This writes:

```text
.vscode/mcp.json
```

The generated config points VS Code at:

```text
$MCP_ROOT/mcp/mcp-server.mjs
```

After installing:

1. Open the project in VS Code from WSL or inside the devcontainer.
2. Reload the VS Code window.
3. Confirm Copilot MCP sees the `nifty_*` tools.
4. Run `nifty_auth_localhost_start` from Copilot chat.
5. Open the returned URL and approve Nifty access.
6. Run `nifty_health_check`.

For WSL, open VS Code from the WSL shell:

```bash
cd /path/to/your/project
code .
```

For devcontainers, run the installer inside the container so the paths in `.vscode/mcp.json` are container paths, not host paths.

## Manual VS Code MCP Config

If you do not want to use the script, create `.vscode/mcp.json` in `PROJECT_ROOT`:

```json
{
  "servers": {
    "nifty": {
      "command": "node",
      "args": ["/absolute/path/to/opencode-nifty/mcp/mcp-server.mjs"],
      "env": {
        "NIFTY_WORKTREE": "/absolute/path/to/your/project",
        "NIFTY_MCP_ROOT": "/absolute/path/to/opencode-nifty"
      }
    }
  }
}
```

Use Linux/container paths when VS Code is attached to WSL or a devcontainer.

## Install For Codex CLI

Project-local install from `PROJECT_ROOT`:

```bash
cd /path/to/your/project

MCP_ROOT=/path/to/opencode-nifty
NIFTY_WORKTREE="$PWD" \
"$MCP_ROOT/scripts/install-codex.sh"
```

This writes:

```text
.codex/config.toml
```

Global install:

```bash
cd /path/to/your/project

MCP_ROOT=/path/to/opencode-nifty
NIFTY_WORKTREE="$PWD" \
"$MCP_ROOT/scripts/install-codex.sh" --global
```

This writes:

```text
~/.codex/config.toml
```

You can also let Codex manage the MCP entry:

```bash
codex mcp add nifty \
  --env NIFTY_WORKTREE=/absolute/path/to/your/project \
  --env NIFTY_MCP_ROOT=/absolute/path/to/opencode-nifty \
  -- node /absolute/path/to/opencode-nifty/mcp/mcp-server.mjs
```

Manual TOML:

```toml
[mcp_servers.nifty]
command = "node"
args = ["/absolute/path/to/opencode-nifty/mcp/mcp-server.mjs"]

[mcp_servers.nifty.env]
NIFTY_WORKTREE = "/absolute/path/to/your/project"
NIFTY_MCP_ROOT = "/absolute/path/to/opencode-nifty"
```

First use in Codex:

```text
nifty_auth_localhost_start
nifty_health_check
```

## Devcontainer Notes

Run all install commands inside the devcontainer when the MCP server will run inside the devcontainer.

Recommended layout:

```text
/workspaces/tools/opencode-nifty   # MCP_ROOT
/workspaces/my-app                 # PROJECT_ROOT
```

If the auth callback URL cannot reach the container, forward port `8787` from the devcontainer to the host. If your `.nifty.env` uses another `NIFTY_AUTH_PORT`, forward that port instead.

For VS Code devcontainers:

1. Open the project in the devcontainer.
2. In the devcontainer terminal, run the Copilot install command from `PROJECT_ROOT`.
3. Reload the VS Code window.
4. Run `nifty_auth_localhost_start` through Copilot.

## WSL Notes

Keep `MCP_ROOT` and `PROJECT_ROOT` in the WSL filesystem when possible:

```text
~/tools/opencode-nifty
~/code/my-app
```

Avoid long-running MCP server paths under `/mnt/c` unless you need Windows-side file access. WSL filesystem paths are usually faster and less error-prone for Node and npm.

If your browser runs on Windows, copy the URL returned by `nifty_auth_localhost_start` into the Windows browser. WSL localhost forwarding usually makes `http://127.0.0.1:8787/callback` reachable. If it is not reachable, forward the port or use VS Code's Ports panel.

## Verify The Install

From the AI coding app, first call a read-only tool that does not need Nifty auth:

```text
nifty_recommended_workflow
```

Then authenticate:

```text
nifty_auth_localhost_start
```

After browser approval, run:

```text
nifty_health_check
```

Expected result:

- MCP server starts without crashing.
- The client lists `nifty_*` tools.
- Auth returns a browser URL.
- `nifty_health_check` reports token/config status.

## Common Problems

### `node: command not found`

Install Node.js 20 or 22 in the same WSL distro or devcontainer that runs the MCP server.

### `Nifty MCP server file not found`

The installer cannot find:

```text
$MCP_ROOT/mcp/mcp-server.mjs
```

Use a full extracted package, and call the script from the package you extracted.

### Copilot or Codex edits the wrong project

Set `NIFTY_WORKTREE` to the project root when installing the MCP client config:

```bash
NIFTY_WORKTREE="$PWD" /path/to/opencode-nifty/scripts/install-copilot.sh
```

### Auth URL opens but callback fails

Forward port `8787` from the devcontainer/WSL environment to the host browser. If `.nifty.env` sets `NIFTY_AUTH_PORT`, forward that port.

### `nifty_health_check` says credentials are missing

Check that `.nifty.env` exists in `PROJECT_ROOT` and contains the required Nifty values. Also confirm the MCP config has:

```text
NIFTY_WORKTREE=/absolute/path/to/your/project
```

### VS Code does not show the MCP tools

Reload the VS Code window. Confirm `.vscode/mcp.json` uses paths that exist inside the active WSL/devcontainer environment.

## Repackaging For Handoff

If you are the maintainer and want to create a clean archive from a committed tree:

```bash
cd /path/to/opencode-nifty
git archive --format=tar.gz --output=/tmp/opencode-nifty-mcp.tar.gz HEAD
```

Do not include these in a handoff package:

```text
.git/
node_modules/
.nifty.env
local token cache files
```
