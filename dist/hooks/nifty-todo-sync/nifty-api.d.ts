export type NiftyCommentRequest = {
    readonly taskId: string;
    readonly text: string;
    readonly botMarker?: boolean;
};
export type NiftyCommentResult = {
    readonly ok: boolean;
    readonly status: number;
    readonly body: unknown;
};
export type NiftyAccessToken = {
    readonly accessToken: string;
    readonly source: "cache" | "env";
};
export declare function getNiftyTokenCachePath(): string;
export declare function readCachedAccessToken(cachePath?: string): string | undefined;
export declare function resolveAccessToken(cachePath?: string): NiftyAccessToken | undefined;
export type NiftyRefreshResult = {
    readonly ok: boolean;
    readonly accessToken?: string;
    readonly httpStatus: number;
    readonly error?: string;
};
export declare function refreshAccessToken(deps?: {
    fetchImpl?: typeof fetch;
    clientId?: string;
    clientSecret?: string;
    cachePath?: string;
}): Promise<NiftyRefreshResult>;
export type NiftyTaskLookup = {
    readonly id: string;
    readonly nice_id: string;
};
export type NiftyTaskResolveResult = {
    readonly taskId: string;
    readonly resolvedFrom: "raw" | "nice_id";
};
export declare function looksLikeRawTaskId(value: string): boolean;
export declare function resolveTaskId(candidate: string, deps?: {
    fetchImpl?: typeof fetch;
    accessToken?: string;
    cachePath?: string;
}): Promise<NiftyTaskResolveResult>;
export declare function postTaskComment(request: NiftyCommentRequest, deps?: {
    fetchImpl?: typeof fetch;
    accessToken?: string;
    cachePath?: string;
    refreshDeps?: {
        fetchImpl?: typeof fetch;
        clientId?: string;
        clientSecret?: string;
        cachePath?: string;
    };
}): Promise<NiftyCommentResult>;
