import type { LocalMcpConfig } from "./lsp";
import { type RuntimeExecutableResolver } from "./runtime-executable";
type AstGrepMcpConfigOptions = {
    readonly cwd?: string;
    readonly disabledTools?: readonly string[];
    readonly moduleUrl?: string;
    readonly exists?: (path: string) => boolean;
    readonly resolveExecutable?: RuntimeExecutableResolver;
};
export declare function createAstGrepMcpConfig(options?: AstGrepMcpConfigOptions): LocalMcpConfig;
export {};
