export function envInt(name, fallback, env = process.env) {
  const value = Number.parseInt(env[name] ?? "", 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function retryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

function retryDelay(attempt, retryDelayMs) {
  return retryDelayMs * Math.max(1, 2 ** (attempt - 1))
}

async function responseText(response) {
  try {
    return await response.text()
  } catch {
    return ""
  }
}

function timeoutSignal(timeoutMs) {
  const controller = new AbortController()
  const timeoutID = setTimeout(() => {
    controller.abort(new Error(`Request timed out after ${timeoutMs}ms`))
  }, timeoutMs)
  return { controller, timeoutID }
}

export async function fetchJsonWithRetry(url, {
  headers = {},
  timeoutMs = envInt("NIFTY_RAG_API_TIMEOUT_MS", 15_000),
  retries = envInt("NIFTY_RAG_API_RETRIES", 2),
  retryDelayMs = envInt("NIFTY_RAG_API_RETRY_DELAY_MS", 250),
  fetchFn = fetch,
} = {}) {
  let lastError = null
  const maxAttempts = Math.max(1, retries + 1)

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { controller, timeoutID } = timeoutSignal(timeoutMs)
    try {
      const response = await fetchFn(url, {
        method: "GET",
        headers,
        signal: controller.signal,
      })
      clearTimeout(timeoutID)

      if (!response.ok) {
        const body = await responseText(response)
        const error = new Error(`Nifty API ${response.status} ${new URL(url).pathname}: ${body.slice(0, 200)}`)
        error.retryable = retryableStatus(response.status)
        if (!retryableStatus(response.status) || attempt >= maxAttempts) throw error
        lastError = error
        await sleep(retryDelay(attempt, retryDelayMs))
        continue
      }

      return await response.json()
    } catch (error) {
      clearTimeout(timeoutID)
      lastError = error
      if (error?.retryable === false) break
      if (attempt >= maxAttempts) break
      await sleep(retryDelay(attempt, retryDelayMs))
    }
  }

  throw lastError ?? new Error(`Failed to fetch ${url}`)
}
