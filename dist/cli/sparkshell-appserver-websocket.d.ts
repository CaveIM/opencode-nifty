import { type Socket } from "node:net";
export declare function connectUnixWebSocket(socketPath: string): Promise<Socket>;
export declare function writeWebSocketText(socket: Socket, payload: string): void;
export declare function readWebSocketText(socket: Socket): Promise<string>;
