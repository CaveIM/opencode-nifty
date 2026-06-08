export type PathClassification = "icloud" | "onedrive" | "desktop-sync" | "network-drive" | "unknown";
export declare function classifyPathEnvironment(absolutePath: string): PathClassification;
export declare function describePathClassification(pathClassification: PathClassification): string;
