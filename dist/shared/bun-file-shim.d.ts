export interface BunFileLike {
    text(): Promise<string>;
    arrayBuffer(): Promise<ArrayBuffer>;
    exists(): Promise<boolean>;
    delete(): Promise<void>;
}
export declare function bunFile(path: string): BunFileLike;
export declare function bunWrite(path: string, data: string | ArrayBuffer | Uint8Array): Promise<number>;
