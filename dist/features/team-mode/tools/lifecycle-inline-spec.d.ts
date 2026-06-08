import { z } from "zod";
import type { AgentOverrides, CategoriesConfig } from "../../../config/schema";
import { normalizeTeamSpecInput } from "../team-registry/loader";
import { type TeamSpec } from "../types";
export declare const TEAM_CREATE_USAGE = "team_create requires exactly one of teamName or inline_spec. Use team_create({ teamName: \"existing-team\" }) or team_create({ inline_spec: { name: \"team-name\", members: [{ name: \"worker\", category: \"quick\", prompt: \"Do the assigned work.\" }] } }).";
export declare const TeamCreateArgsSchema: z.ZodObject<{
    teamName: z.ZodOptional<z.ZodString>;
    inline_spec: z.ZodOptional<z.ZodUnknown>;
    leadSessionId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type TeamCreateArgs = z.infer<typeof TeamCreateArgsSchema>;
export type TeamCreateExecutorConfig = {
    userCategories?: CategoriesConfig;
    sisyphusJuniorModel?: string;
    agentOverrides?: AgentOverrides;
};
export declare function resolveDefaultInlineCategory(userCategories?: CategoriesConfig): string | undefined;
export declare function parseTeamCreateArgs(rawArgs: unknown): TeamCreateArgs;
export declare function parseInlineTeamSpec(rawSpec: unknown, options?: Parameters<typeof normalizeTeamSpecInput>[1]): TeamSpec;
