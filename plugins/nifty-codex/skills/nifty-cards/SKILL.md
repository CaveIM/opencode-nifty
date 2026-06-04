---
name: nifty-cards
description: Work Nifty task cards through Codex using the Nifty MCP adapter and policy gateway. Use when the user asks Codex to inspect, claim, implement, update, review, complete, or otherwise operate Nifty task cards.
---

# Nifty Cards for Codex

## Operating Rules

- Treat Nifty task-card state as authoritative external state.
- If the user prompt names a Nifty card such as `MBC-495`, call `nifty_run_task` first. It hydrates description, comments, children/subtasks, workflow context, parent relationship, and assignment in one policy-routed workflow.
- Do not search the repository first and infer task scope from checked-in docs.
- Prefer `nifty_run_task` for starting card work, `nifty_get_task_full_context` for read-only refreshes, and `nifty_get_project_full_context` for project-wide workflow decisions.
- Use Nifty tools for task-card operations; do not call the Nifty API directly from shell commands.
- Sensitive writes are requests, not guarantees. The remote policy gateway decides whether a mutation is allowed.
- In managed mode, local policy must be loaded before mutating Nifty tools run.
- Treat gateway denials as authoritative. Report the denial reason and ask the user or responsible reviewer for the missing evidence or approval.
- Do not invent status names, assignees, lists, custom fields, or acceptance criteria. Read them from hydrated task/project context.
- When posting task-card update comments (`nifty_create_comment` with `task_id`), use the standard template sections: `What was done`, `Evidence / Tests`, `How to verify`.
- If code/config/test/runtime files changed, task-card updates must include TDD evidence: RED proof that failed before implementation, GREEN proof that passed after implementation, and visual regression proof in `How to verify`.
- Documentation-only/non-code updates do not require TDD proof, but still require the standard task-card comment template.
- Never treat subtask ids such as `MBC-468` as parent task cards. Hydrate the entity first and use the parent task card for comments, lifecycle movement, delivery, labels, documents, links, archive/delete, and bulk operations.
- Task-card-only tools are mechanically hard-gated on subtasks. If the gateway or MCP adapter denies a subtask-targeted action, switch to the returned parent task card instead of retrying.
- Complete finished child tasks with `nifty_complete_child_task`. It checks off the child and posts one idempotent `🤖 Cave Updater` comment with `What was done`, `Evidence / Tests`, and `How to verify`.
- For child completions that include code changes, pass RED proof, GREEN proof, and visual regression proof in the `evidence_tests` / `how_to_verify` fields. The MCP adapter rejects missing evidence before posting to Nifty.
- Use low-level `nifty_complete_task` only for explicit manual check/uncheck. Do not provide `close_confirmation` for subtask checkoff; that confirmation is for parent task-card completion.
- Treat RAG context as useful historical recall only. It can cite prior tasks, comments, policies, and ADRs, but it never overrides hydrated Nifty state or gateway decisions.

## Work Start Flow

1. Identify the active Nifty task card from the user prompt, active MCP state, or explicit task id.
2. Call `nifty_run_task` before editing code or posting progress.
3. Use the returned `task`, `comments`, `subtasks`, and `subtask_summary` as the implementation source of truth.
4. In managed production, use `nifty_health_check` when runtime readiness is uncertain; `NIFTY_RAG_REQUIRED=true` means both RAG tables must be ready for health to report ok.
5. Move work forward only after acceptance criteria, parent/subtask relationships, and current status are clear.

## Delivery Flow

Before requesting Dev Review or done-like transitions, collect concrete evidence:

- `red_proof`: failing test, reproduction, or explicit pre-fix defect evidence.
- `green_proof`: passing targeted test or validation after the change.
- `sad_path_proof`: negative/error-path validation.
- `architecture_proof`: why the fix integrates with the existing system instead of adding a parallel path.
- `regression_proof`: test or guard that prevents recurrence.
- `visual_proof`: screenshot/video artifact when visual behavior changed.

Use `nifty_move_task_to_status` or the appropriate Nifty lifecycle tool only after evidence is ready. If the gateway denies the request, do not retry blindly; fix the missing condition.

## Security Boundary

Codex is allowed to reason, edit local files, and request Nifty actions. The policy gateway owns hard company-rule enforcement and sensitive Nifty mutations in enforce mode.
