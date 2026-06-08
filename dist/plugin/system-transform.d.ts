import type { DefaultModeConfig } from "../config/schema/default-mode";
export declare function createSystemTransformHandler(defaultMode?: DefaultModeConfig, getUltraworkMessage?: (agentName?: string, modelID?: string) => string, env?: Readonly<Record<string, string | undefined>>): (input: {
    sessionID?: string;
    model: {
        id: string;
        providerID: string;
        [key: string]: unknown;
    };
}, output: {
    system: string[];
}) => Promise<void>;
