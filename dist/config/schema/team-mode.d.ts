import { z } from "zod";
/** Team Mode config - see .omo/plans/team-mode.md (D-01/D-25). */
export declare const TeamModeConfigSchema: z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    tmux_visualization: z.ZodDefault<z.ZodBoolean>;
    max_parallel_members: z.ZodDefault<z.ZodNumber>;
    max_members: z.ZodDefault<z.ZodNumber>;
    max_messages_per_run: z.ZodDefault<z.ZodNumber>;
    max_wall_clock_minutes: z.ZodDefault<z.ZodNumber>;
    max_member_turns: z.ZodDefault<z.ZodNumber>;
    base_dir: z.ZodOptional<z.ZodString>;
    message_payload_max_bytes: z.ZodDefault<z.ZodNumber>;
    recipient_unread_max_bytes: z.ZodDefault<z.ZodNumber>;
    mailbox_poll_interval_ms: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export type TeamModeConfig = z.infer<typeof TeamModeConfigSchema>;
