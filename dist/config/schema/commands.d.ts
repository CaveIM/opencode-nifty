import { z } from "zod";
export declare const BuiltinCommandNameSchema: z.ZodEnum<{
    "remove-ai-slops": "remove-ai-slops";
    "ralph-loop": "ralph-loop";
    "ulw-loop": "ulw-loop";
    "cancel-ralph": "cancel-ralph";
    refactor: "refactor";
    "start-work": "start-work";
    "stop-continuation": "stop-continuation";
    hyperplan: "hyperplan";
}>;
export type BuiltinCommandName = z.infer<typeof BuiltinCommandNameSchema>;
