import assert from "node:assert/strict"
import { test } from "node:test"
import { fetchJsonWithRetry } from "../scripts/lib/rag-http.mjs"

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body
    },
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body)
    },
  }
}

test("RAG HTTP: retries transient 5xx responses and returns JSON", async () => {
  let attempts = 0
  const data = await fetchJsonWithRetry("https://example.test/tasks", {
    retryDelayMs: 1,
    fetchFn: async () => {
      attempts++
      return attempts < 3 ? response(503, { error: "busy" }) : response(200, { ok: true })
    },
  })

  assert.equal(attempts, 3)
  assert.deepEqual(data, { ok: true })
})

test("RAG HTTP: does not retry permanent 4xx responses", async () => {
  let attempts = 0
  await assert.rejects(
    fetchJsonWithRetry("https://example.test/tasks", {
      retryDelayMs: 1,
      fetchFn: async () => {
        attempts++
        return response(403, { error: "forbidden" })
      },
    }),
    /Nifty API 403/,
  )

  assert.equal(attempts, 1)
})

test("RAG HTTP: times out hung requests and retries network failures", async () => {
  let attempts = 0
  const data = await fetchJsonWithRetry("https://example.test/tasks", {
    timeoutMs: 10,
    retries: 2,
    retryDelayMs: 1,
    fetchFn: async (_url, options) => {
      attempts++
      if (attempts === 1) {
        await new Promise((resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true })
          setTimeout(resolve, 100)
        })
      }
      return response(200, { recovered: true })
    },
  })

  assert.equal(attempts, 2)
  assert.deepEqual(data, { recovered: true })
})
