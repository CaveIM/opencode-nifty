export declare const PLUGIN_NAME = "oh-my-openagent";
export declare const LEGACY_PLUGIN_NAME = "oh-my-opencode";
export declare const PUBLISHED_PACKAGE_NAME = "cave-meister";
export declare const ACCEPTED_PACKAGE_NAMES: readonly ["cave-meister", "oh-my-openagent", "oh-my-opencode"];
export declare const CAVE_MEISTER_CONFIG_BASENAME = "cave-meister";
export declare const CONFIG_BASENAME = "oh-my-openagent";
export declare const LEGACY_CONFIG_BASENAME = "oh-my-opencode";
/**
 * Config basename resolution order: `cave-meister` (new canonical) → `oh-my-openagent`
 * (intermediate, used in 4.x) → `oh-my-opencode` (legacy, used pre-4.x).
 * The first existing file wins. The chain applies to both
 * `~/.config/opencode/` and project-local `.opencode/`.
 */
export declare const CONFIG_BASENAME_CHAIN: readonly ["cave-meister", "oh-my-openagent"];
export declare const LOG_FILENAME = "oh-my-opencode.log";
export declare const CACHE_DIR_NAME = "oh-my-opencode";
