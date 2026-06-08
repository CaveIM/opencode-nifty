export declare function log(message: string, data?: unknown): void;
export declare function getLogFilePath(): string;
export declare function flushLogs(): void;
interface LoggerTestOverrides {
    filePath?: string;
    maxSizeBytes?: number;
    maxBackups?: number;
}
/** @internal test-only seam */
export declare function _setLoggerForTesting(overrides: LoggerTestOverrides): void;
/** @internal test-only seam */
export declare function _resetLoggerForTesting(): void;
/** @internal test-only seam: synchronously flush the buffer */
export declare function _flushForTesting(): void;
export {};
