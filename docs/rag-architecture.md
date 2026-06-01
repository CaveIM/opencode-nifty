# RAG Architecture Specification — Nifty AI Agent Context System

> Status: **Designed, not yet implemented.** This document specifies Phase 3 of the agent context system.  
> Phases 1–2 are complete: direct-API precision hydration (Phase 1) and central policy-as-code deterministic gates (Phase 2).

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

### Source A — Nifty Historical Data

| Dataset | Content | Indexing |
|---------|---------|----------|
| Task history | Names, descriptions, comments, status transitions | Per-task chunking |
| Milestone notes | Title + description | One chunk per milestone |
| Doc pages | Full Nifty docs (markdown) | Sliding window 512 tokens, 128 overlap |
| Workflow decisions | Status audit trail + comments tagged as decisions | Decision extraction pass |

**Freshness**: Re-index on Nifty webhook `task.updated`, `comment.created`, and `doc.updated`. Full re-sync nightly.

### Source B — Policy Corpus

| Dataset | Content |
|---------|---------|
| `policy/nifty-ai-policy.json` | Machine-readable rules with reasons |
| `policy/nifty-ai-policy.schema.json` | Schema definitions |
| `README.md` (policy section) | Human-readable policy overview |
| ADR documents (future) | Architecture Decision Records |

**Freshness**: Re-index on every commit that modifies `policy/` or `docs/adr/`.

---

## Index Design

```
nifty-rag/
  indexes/
    nifty-tasks/         ← Nifty task + comment corpus
    nifty-policy/        ← Policy documents corpus
  scripts/
    index-nifty-tasks.mjs        ← Bulk indexer using Nifty API pagination
    index-policy-docs.mjs        ← Policy + ADR document indexer
    incremental-update.mjs       ← Webhook-driven incremental update
  config/
    chunking.json                ← Chunk sizes, overlap, metadata fields
    embedding-model.json         ← Model selection and config
```

**Embedding model**: `text-embedding-3-small` (OpenAI) or `bge-small-en-v1.5` (local).  
**Vector store**: `lancedb` (embedded, file-based, no external service required for local dev).  
**Distance**: cosine similarity.

---

## Query Flow

```js
async function ragContextForTool(toolName, args, policy, options = {}) {
  const query = buildRagQuery(toolName, args)
  const [taskResults, policyResults] = await Promise.allSettled([
    searchIndex("nifty-tasks", query, { limit: 5, timeout: 2000 }),
    searchIndex("nifty-policy", query, { limit: 3, timeout: 2000 }),
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
  "source": "nifty-tasks" | "nifty-policy",
  "doc_id": "eves6NhQAe",
  "doc_type": "task" | "comment" | "milestone" | "doc" | "policy_rule" | "adr",
  "project_id": "eIWcpeW8aBsdI2L",
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
// nifty.js — Phase 3 integration (to be implemented)
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
| `NIFTY_RAG_EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model identifier |
| `NIFTY_RAG_REINDEX_WEBHOOK_SECRET` | *(none)* | HMAC secret for webhook-triggered re-index |

---

## Implementation Checklist (Phase 3)

- [ ] `scripts/index-nifty-tasks.mjs` — bulk indexer via `/api/v1.0/tasks` + `/api/v1.0/messages` pagination
- [ ] `scripts/index-policy-docs.mjs` — policy JSON + markdown chunker
- [ ] `scripts/incremental-update.mjs` — webhook receiver for `task.updated`, `comment.created`
- [ ] `plugin/rag.mjs` — `searchIndex`, `ragContextForTool`, `buildRagQuery` (extracted module)
- [ ] `maybeInjectRagContext` call in `withLifecyclePolicy` wrapper
- [ ] Tests: RAG failure never blocks tool execution; results are injected into context metadata
- [ ] `NIFTY_RAG_ENABLED` env var in `env/nifty.env.example`
- [ ] README section: RAG context injection

**Prerequisites**: Phase 2 deterministic gates fully stable (done). Nifty webhook endpoint reachable.

---

## Design Decisions

**Why best-effort, not hard-fail?**  
RAG is probabilistic recall. A failed or empty RAG result does not indicate a policy violation — it indicates the index is warm-up, stale, or the query has no historical match. Hard-failing would break agent runs during index bootstrapping and transient network issues.

**Why separate indexes?**  
Task corpus and policy corpus have different freshness requirements, different chunk strategies, and different relevance ranking. Mixing them degrades recall for policy queries (short, precise) with task noise.

**Why LanceDB?**  
Zero external service dependency. Embedded, file-based, works in dev and CI without infrastructure. Upgrade path to managed vector store (Pinecone, Weaviate) is a one-line config change.
