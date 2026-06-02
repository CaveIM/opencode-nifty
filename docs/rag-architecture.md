# RAG Architecture Specification — Nifty AI Agent Context System

> Status: **Implemented.** Phase 3 is fully operational.  
> Phases 1–3 are all complete: direct-API precision hydration (Phase 1), central policy-as-code deterministic gates (Phase 2), and LanceDB-backed RAG context injection (Phase 3).

---

## Motivation

Direct-API hydration (Phase 1) gives the agent exact task and project state for the current session. But agents lack:

- **Cross-project recall**: "How did we implement multi-tenant auth last quarter?"
- **Historical decision context**: previous ADRs, comment threads, resolved disagreements
- **Citable policy compliance**: "Which policy rule governs bulk deletes?"

RAG (Retrieval-Augmented Generation) over the Nifty corpus fills these gaps while keeping the deterministic gate layer (Phase 2) as the authoritative enforcement boundary.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                        Agent Request                               │
└──────────────────────────┬─────────────────────────────────────────┘
                           │
          ┌────────────────▼──────────────────┐
          │   Phase 2: Policy Gate (sync)      │  ← hard-fail on deny
          │   Phase 1: Context Bootstrap (sync)│  ← hard-fail if missing
          └────────────────┬──────────────────┘
                           │
          ┌────────────────▼──────────────────┐
          │   Phase 3: RAG Context Injection   │  ← best-effort, never blocks
          │   (async, timeout-bounded)          │
          └────────────────┬──────────────────┘
                           │
          ┌────────────────▼──────────────────┐
          │         Tool Execution             │
          └────────────────────────────────────┘
```

**Key invariant**: RAG failure never blocks a tool call. It augments context; it does not gate it.

---

## Corpus Sources

### Implemented Source A — Nifty Task And Comment Corpus

| Dataset | Content | Indexing |
|---------|---------|----------|
| Task cards | Names, descriptions, project IDs, timestamps | Per-task word chunking |
| Task comments | Comment text/body, task ID, project ID, timestamps | One chunk per comment, capped to 2,000 chars |

The bulk indexer fetches tasks with `include_subtasks: "true"`, then indexes the returned task records and comments. Direct task-card context remains the source of truth for current subtasks; the historical RAG corpus currently stores task/subtask records as task chunks rather than a separate `subtask` document type.

**Freshness**: Run `npm run rag:index:tasks` for a bulk sync. The optional `npm run rag:webhook` server accepts task/comment update events, debounces them, and re-runs the task indexer for the affected project when possible. It can also schedule a nightly full task re-index.

### Implemented Source B — Policy Corpus

| Dataset | Content |
|---------|---------|
| `policy/nifty-ai-policy.json` | Machine-readable rules with reasons |
| `policy/nifty-ai-policy.schema.json` | Schema definitions |
| `README.md` (policy section) | Human-readable policy overview |
| ADR documents | Architecture Decision Records, when present |

Run `npm run rag:index:policy` to populate the `nifty-policy` LanceDB table from local policy files, ADR/decision markdown, and the README. Policy freshness is commit-driven/manual today; the webhook server currently refreshes the task/comment corpus, not the policy corpus.

---

## Index Design

```
nifty-rag/
  nifty-tasks/           ← Nifty task + comment table created by scripts/index-nifty-tasks.mjs
  nifty-policy/          ← Policy/ADR/README table created by scripts/index-policy-docs.mjs

scripts/
  index-nifty-tasks.mjs  ← Bulk task/comment indexer
  index-policy-docs.mjs  ← Policy JSON + markdown indexer
  rag-webhook.mjs        ← Optional debounced task/comment re-index server
```

**Search mode**: LanceDB full-text search over the `text` column.  
**Vector store**: `lancedb` (embedded, file-based, no external service required for local dev).  
**Optional dependency**: if `@lancedb/lancedb` is unavailable, RAG silently returns empty context.

---

## Query Flow

```js
async function ragContextForTool(toolName, args, policy, options = {}) {
  const query = buildRagQuery(toolName, args)
  const indexPath = options.indexPath ?? resolveIndexPath()
  const [taskResults, policyResults] = await Promise.allSettled([
    withTimeout(openIndex(indexPath, "nifty-tasks").then((table) => searchIndex(table, query, { limit: 5 })), 2000),
    withTimeout(openIndex(indexPath, "nifty-policy").then((table) => searchIndex(table, query, { limit: 3 })), 2000),
  ])
  return {
    historical_context: taskResults.status === "fulfilled" ? taskResults.value : [],
    policy_citations: policyResults.status === "fulfilled" ? policyResults.value : [],
  }
}
```

- Both searches run in parallel.
- Both are wrapped in `Promise.allSettled` — individual failures produce empty arrays, not exceptions.
- Timeout cap: 2 seconds per search. Exceeded → empty array, not a block.

---

## Metadata Schema (per chunk)

```json
{
  "doc_id": "eves6NhQAe",
  "doc_type": "task" | "comment" | "policy_rule" | "adr",
  "project_id": "eIWcpeW8aBsdI2L",
  "task_id": "eves6NhQAe",
  "chunk_index": 0,
  "chunk_total": 3,
  "created_at": "2026-06-01T00:00:00Z",
  "updated_at": "2026-06-01T00:00:00Z",
  "text": "..."
}
```

---

## Integration with Plugin

```js
// nifty.js — Phase 3 integration
async function maybeInjectRagContext(toolName, args, context, policyState) {
  if (!envBoolean("NIFTY_RAG_ENABLED", false, context)) return
  try {
    const rag = await ragContextForTool(toolName, args)
    if (rag.historical_context.length || rag.policy_citations.length) {
      safeContextMetadata(context, { title: "Nifty RAG context", rag_context: rag, tool: toolName })
    }
  } catch {
    // RAG is best-effort. Failure is silent and never blocks execution.
  }
}
```

Call site: after Phase 1 (context hydration), before tool execution.

---

## Environment Variables (Phase 3)

| Variable | Default | Description |
|----------|---------|-------------|
| `NIFTY_RAG_ENABLED` | `false` | Enable RAG context injection |
| `NIFTY_RAG_INDEX_PATH` | `~/.config/opencode/nifty-rag` | Path to LanceDB index |
| `NIFTY_RAG_TASK_LIMIT` | `5` | Max task corpus results per query |
| `NIFTY_RAG_POLICY_LIMIT` | `3` | Max policy corpus results per query |
| `NIFTY_RAG_TIMEOUT_MS` | `2000` | Per-search timeout in milliseconds |
| `NIFTY_RAG_WEBHOOK_PORT` | `7779` | HTTP port for the optional re-index webhook server |
| `NIFTY_RAG_REINDEX_WEBHOOK_SECRET` | *(none)* | Optional HMAC secret for webhook signature validation |
| `NIFTY_RAG_DEBOUNCE_MS` | `30000` | Debounce window for webhook-triggered task re-indexes |
| `NIFTY_RAG_REINDEX_CRON` | `true` | Set to `false` to disable nightly task re-index scheduling |

---

## Implementation Checklist (Phase 3)

- [x] `scripts/index-nifty-tasks.mjs` — bulk task/comment indexer using Nifty API pagination
- [x] `scripts/index-policy-docs.mjs` — policy JSON + markdown chunker
- [x] `scripts/rag-webhook.mjs` — debounced webhook server for task/comment re-indexing
- [x] `plugin/rag.mjs` — `searchIndex`, `ragContextForTool`, `buildRagQuery` module
- [x] `maybeInjectRagContext` call in the lifecycle wrapper before tool execution
- [x] Tests: RAG failure never blocks tool execution; results are injected into context metadata
- [x] `NIFTY_RAG_ENABLED` feature flag
- [ ] Dedicated first-class subtask chunks, if historical subtask recall must be independent from task chunks
- [ ] Policy-corpus webhook refresh, if policy/ADR changes must update LanceDB automatically
- [ ] README section: RAG context injection

**Prerequisites**: Phase 2 deterministic gates fully stable (done). Webhook reachability is required only when running the optional re-index webhook server.

---

## Design Decisions

**Why best-effort, not hard-fail?**  
RAG is probabilistic recall. A failed or empty RAG result does not indicate a policy violation — it indicates the index is warm-up, stale, or the query has no historical match. Hard-failing would break agent runs during index bootstrapping and transient network issues.

**Why separate indexes?**  
Task corpus and policy corpus have different freshness requirements, different chunk strategies, and different relevance ranking. Mixing them degrades recall for policy queries (short, precise) with task noise.

**Why LanceDB?**  
Zero external service dependency. Embedded, file-based, works in dev and CI without infrastructure. The current implementation uses LanceDB full-text search; moving to a managed vector store would require a search adapter rather than only a config change.
