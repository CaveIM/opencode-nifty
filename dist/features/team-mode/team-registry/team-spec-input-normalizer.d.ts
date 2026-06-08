import type { CallerTeamLead } from "../resolve-caller-team-lead";
export type NormalizeTeamSpecInputOptions = {
    callerTeamLead?: CallerTeamLead;
    defaultCategoryName?: string;
};
export declare function normalizeTeamSpecInput(raw: unknown, options?: NormalizeTeamSpecInputOptions): unknown;
