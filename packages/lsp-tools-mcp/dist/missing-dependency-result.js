import { handleMissingDependencyError } from "./lsp/utils.js";
export function missingDependencyResult(error, details) {
    const message = handleMissingDependencyError(error);
    if (!message)
        return null;
    return {
        content: [{ type: "text", text: message }],
        details: {
            ...details,
            error: message,
            errorKind: "missing_dependency",
        },
    };
}
