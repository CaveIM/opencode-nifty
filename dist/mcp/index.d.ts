import { type LocalMcpConfig } from "./lsp";
import type { RuntimeExecutableResolver } from "./runtime-executable";
import type { OhMyOpenCodeConfig } from "../config/schema";
export { McpNameSchema, type McpName } from "./types";
type RemoteMcpConfig = {
    type: "remote";
    url: string;
    enabled: boolean;
    headers?: Record<string, string>;
    oauth?: false;
};
type BuiltinMcpConfig = RemoteMcpConfig | LocalMcpConfig;
type BuiltinMcpOptions = {
    readonly cwd?: string;
    readonly resolveExecutable?: RuntimeExecutableResolver;
};
export declare function createBuiltinMcps(disabledMcps?: string[], config?: OhMyOpenCodeConfig, options?: BuiltinMcpOptions): Record<string, BuiltinMcpConfig>;
