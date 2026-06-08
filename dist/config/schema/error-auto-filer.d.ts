import { z } from "zod";
export declare const ErrorAutoFilerConfigSchema: z.ZodOptional<z.ZodObject<{
    file_bugs: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>>;
export type ErrorAutoFilerConfig = z.infer<typeof ErrorAutoFilerConfigSchema>;
