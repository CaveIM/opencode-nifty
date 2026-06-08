/**
 * Model version migration map: old full model strings → new full model strings.
 * Used to auto-upgrade hardcoded model versions in user configs when the plugin
 * bumps to newer model versions.
 *
 * Keys are full "provider/model" strings. Only openai and anthropic entries needed.
 *
 * Only include genuinely retired/superseded models here. Do NOT add mappings
 * for current, user-selectable variants like `gpt-5.5`, the canonical
 * codex powerhouse referenced in docs/guide/agent-model-matching.md. The
 * same rule applies to top-level primary models like `openai/gpt-5.4`
 * while they remain user-selectable:
 * config migrations must not silently rewrite an explicit user choice to a
 * newer default. Auto-rewriting current models broke configs in practice
 * (#3777, #4527).
 */
export declare const MODEL_VERSION_MAP: Record<string, string>;
export declare function migrateModelVersions(configs: Record<string, unknown>, appliedMigrations?: Set<string>): {
    migrated: Record<string, unknown>;
    changed: boolean;
    newMigrations: string[];
};
