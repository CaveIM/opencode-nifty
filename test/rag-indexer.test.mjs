import assert from "node:assert/strict"
import { test } from "node:test"
import { clearChunkScope, chunkTaskIDs } from "../scripts/index-nifty-tasks.mjs"

test("RAG task indexer clears only updated task chunks for incremental runs", async () => {
  const deleted = []
  const table = {
    async delete(expression) {
      deleted.push(expression)
    },
  }
  const chunks = [
    { doc_type: "task", doc_id: "task-1", project_id: "project-1" },
    { doc_type: "comment", doc_id: "comment-1", task_id: "task-1", project_id: "project-1" },
    { doc_type: "comment", doc_id: "comment-2", task_id: "task-2", project_id: "project-1" },
  ]

  assert.deepEqual(chunkTaskIDs(chunks), ["task-1", "task-2"])

  await clearChunkScope(table, chunks)

  assert.deepEqual(deleted, [
    "doc_type = 'task' AND doc_id = 'task-1'",
    "doc_type = 'comment' AND task_id = 'task-1'",
    "doc_type = 'task' AND doc_id = 'task-2'",
    "doc_type = 'comment' AND task_id = 'task-2'",
  ])
})
