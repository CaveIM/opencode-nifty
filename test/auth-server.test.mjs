import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, test } from "node:test"

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

function context(overrides = {}) {
  return {
    abort: new AbortController().signal,
    directory: undefined,
    worktree: undefined,
    metadata() {},
    ask() {
      throw new Error("ask not supported in tests")
    },
    ...overrides,
  }
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      server.close(() => resolve(address.port))
    })
  })
}

test("nifty_auth_localhost_start writes logs and starts a reachable callback server", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nifty-auth-server-"))
  const port = await getFreePort()
  const logPath = join(dir, "auth-server.log")

  process.env.NIFTY_AUTH_LOG_PATH = logPath
  process.env.NIFTY_TOKEN_PATH = join(dir, "auth-token.json")
  process.env.NIFTY_NODE_BINARY = process.execPath
  process.env.NIFTY_AUTHORIZE_URL = "https://nifty.pm/authorize?response_type=code&client_id=test-client"
  process.env.NIFTY_CLIENT_ID = "test-client"
  process.env.NIFTY_CLIENT_SECRET = "test-secret"

  const { NiftyPlugin } = await import(`../plugin/nifty.js?auth-server-test=${port}`)
  const plugin = await NiftyPlugin()
  const output = await plugin.tool.nifty_auth_localhost_start.execute({ host: "127.0.0.1", port }, context())

  assert.match(output, /The callback server is running in the background for 10 minutes\./)
  assert.match(output, new RegExp(`Redirect URI: http://127\\.0\\.0\\.1:${port}/callback`))
  assert.match(output, new RegExp(`Auth server log: ${logPath.replaceAll("\\", "\\\\")}`))

  const missingCodeResponse = await fetch(`http://127.0.0.1:${port}/callback`)
  assert.equal(missingCodeResponse.status, 400)

  const shutdownResponse = await fetch(`http://127.0.0.1:${port}/callback?error=access_denied`)
  assert.equal(shutdownResponse.status, 400)

  const log = await readFile(logPath, "utf8")
  assert.match(log, new RegExp(`starting auth server .* on 127\\.0\\.0\\.1:${port}`))
  assert.match(log, new RegExp(`listening on 127\\.0\\.0\\.1:${port}`))
})

test("nifty_auth_localhost_start uses NIFTY_AUTH_PORT from project env file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nifty-auth-env-port-"))
  const port = await getFreePort()
  const logPath = join(dir, "auth-server.log")

  await writeFile(
    join(dir, ".nifty.env"),
    [
      `NIFTY_AUTH_PORT=${port}`,
      "NIFTY_AUTHORIZE_URL=https://nifty.pm/authorize?response_type=code&client_id=file-client",
      "NIFTY_CLIENT_ID=file-client",
      "NIFTY_CLIENT_SECRET=file-secret",
      "",
    ].join("\n"),
    "utf8",
  )
  process.env.NIFTY_AUTH_LOG_PATH = logPath
  process.env.NIFTY_TOKEN_PATH = join(dir, "auth-token.json")
  process.env.NIFTY_NODE_BINARY = process.execPath
  process.env.NIFTY_AUTHORIZE_URL = "https://nifty.pm/authorize?response_type=code&client_id=old-client"
  process.env.NIFTY_CLIENT_ID = "old-client"
  process.env.NIFTY_CLIENT_SECRET = "old-secret"

  const { NiftyPlugin } = await import(`../plugin/nifty.js?auth-env-port-test=${port}`)
  const plugin = await NiftyPlugin()
  const output = await plugin.tool.nifty_auth_localhost_start.execute(
    { host: "127.0.0.1" },
    context({ directory: dir }),
  )

  assert.match(output, new RegExp(`Redirect URI: http://127\\.0\\.0\\.1:${port}/callback`))
  assert.match(output, /client_id=file-client/)
  assert.doesNotMatch(output, /client_id=old-client/)

  const shutdownResponse = await fetch(`http://127.0.0.1:${port}/callback?error=access_denied`)
  assert.equal(shutdownResponse.status, 400)
})

test("nifty_auth_localhost_start explicit port overrides project env file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nifty-auth-explicit-port-"))
  const envPort = await getFreePort()
  const port = await getFreePort()
  const logPath = join(dir, "auth-server.log")

  await writeFile(join(dir, ".nifty.env"), `NIFTY_AUTH_PORT=${envPort}\n`, "utf8")
  process.env.NIFTY_AUTH_LOG_PATH = logPath
  process.env.NIFTY_TOKEN_PATH = join(dir, "auth-token.json")
  process.env.NIFTY_NODE_BINARY = process.execPath
  process.env.NIFTY_AUTHORIZE_URL = "https://nifty.pm/authorize?response_type=code&client_id=test-client"
  process.env.NIFTY_CLIENT_ID = "test-client"
  process.env.NIFTY_CLIENT_SECRET = "test-secret"

  const { NiftyPlugin } = await import(`../plugin/nifty.js?auth-explicit-port-test=${port}`)
  const plugin = await NiftyPlugin()
  const output = await plugin.tool.nifty_auth_localhost_start.execute(
    { host: "127.0.0.1", port },
    context({ directory: dir }),
  )

  assert.match(output, new RegExp(`Redirect URI: http://127\\.0\\.0\\.1:${port}/callback`))

  const shutdownResponse = await fetch(`http://127.0.0.1:${port}/callback?error=access_denied`)
  assert.equal(shutdownResponse.status, 400)
})

test("writeTokenCache restricts token cache permissions or fails closed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "nifty-token-perms-"))
  const tokenPath = join(dir, "nested", "auth-token.json")
  process.env.NIFTY_TOKEN_PATH = tokenPath

  const { NiftyPlugin } = await import(`../plugin/nifty.js?token-perms-test=${Date.now()}`)
  try {
    await NiftyPlugin.__test.writeTokenCache({ access_token: "test-token", refresh_token: "refresh" })
  } catch (error) {
    assert.match(error.message, /Unable to secure Nifty token cache permissions/i)
    return
  }

  const parentMode = (await stat(join(dir, "nested"))).mode & 0o777
  const fileMode = (await stat(tokenPath)).mode & 0o777
  assert.equal(parentMode, 0o700)
  assert.equal(fileMode, 0o600)
})

test("resolveAuthNodeBinary rejects unsafe NIFTY_NODE_BINARY overrides by default", async () => {
  process.env.NIFTY_NODE_BINARY = "/bin/sh"

  const { NiftyPlugin } = await import(`../plugin/nifty.js?node-binary-test=${Date.now()}`)
  assert.throws(
    () => NiftyPlugin.__test.resolveAuthNodeBinary({}),
    /NIFTY_NODE_BINARY.*disabled|unsafe/i,
  )
})
