import { Readable } from "node:stream";
export type ProcessReadableStream = ReadableStream<Uint8Array> | Readable | null | undefined;
export declare function readProcessStream(stream: ProcessReadableStream): Promise<string>;
