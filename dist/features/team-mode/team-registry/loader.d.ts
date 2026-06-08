import type { TeamModeConfig } from "../../../config/schema/team-mode";
import type { NormalizeTeamSpecInputOptions } from "./team-spec-input-normalizer";
import type { TeamSpec } from "../types";
export { TeamSpecValidationError } from "./validator";
export { normalizeTeamSpecInput } from "./team-spec-input-normalizer";
export declare function loadTeamSpec(teamName: string, config: TeamModeConfig, projectRoot: string, options?: NormalizeTeamSpecInputOptions): Promise<TeamSpec>;
export declare function loadAllTeamSpecs(config: TeamModeConfig, projectRoot: string): Promise<Array<{
    name: string;
    scope: "project" | "user";
    spec?: TeamSpec;
    error?: Error;
}>>;
