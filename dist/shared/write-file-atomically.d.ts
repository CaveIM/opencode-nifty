import { type fsyncSync as FsyncSync } from "node:fs";
export declare function writeFileAtomically(filePath: string, content: string, deps?: {
    fsyncSync?: typeof FsyncSync;
}): void;
