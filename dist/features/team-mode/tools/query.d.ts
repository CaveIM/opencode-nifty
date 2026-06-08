import { type ToolDefinition } from "@opencode-ai/plugin/tool";
import type { TeamModeConfig } from "../../../config/schema/team-mode";
import type { OpencodeClient } from "../../../tools/delegate-task/types";
import { loadTeamSpec } from "../team-registry/loader";
import { aggregateStatus } from "../team-runtime/status";
import { discoverTeamSpecs } from "../team-registry/paths";
import { listActiveTeams } from "../team-state-store/store";
type QueryToolDeps = {
    aggregateStatus: typeof aggregateStatus;
    discoverTeamSpecs: typeof discoverTeamSpecs;
    loadTeamSpec: typeof loadTeamSpec;
    listActiveTeams: typeof listActiveTeams;
};
export declare function createTeamStatusTool(config: TeamModeConfig, client: OpencodeClient, backgroundManager?: Parameters<typeof aggregateStatus>[2], deps?: QueryToolDeps): ToolDefinition;
export declare function createTeamListTool(config: TeamModeConfig, client: OpencodeClient, deps?: QueryToolDeps): ToolDefinition;
export {};
