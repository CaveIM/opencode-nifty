export type BugFinderOptions = {
    directory?: string;
    json?: boolean;
    failOn?: BugFinderFailOn;
    includeP2?: boolean;
};
export type BugFinderFailOn = "none" | "warning" | "error";
export type BugFinderDeps = {
    stdout: {
        write(text: string): void;
    };
    runCommand?: BugFinderRunCommand;
};
export type BugFinderSeverity = "info" | "warning" | "error";
export type BugFinderTier = "P0" | "P1" | "P2";
export type BugFinderCheckStatus = "passed" | "failed" | "skipped";
export type BugFinderEvidenceKind = "file" | "command" | "inventory" | "text";
export type BugFinderEvidence = {
    kind: BugFinderEvidenceKind;
    path?: string;
    command?: string;
    excerpt?: string;
    status?: BugFinderCheckStatus;
};
export type BugFinderFinding = {
    id: string;
    severity: BugFinderSeverity;
    title: string;
    description: string;
    surface: string;
    checkId: string;
    evidence: BugFinderEvidence[];
};
export type BugFinderCheck = {
    id: string;
    tier: BugFinderTier;
    status: BugFinderCheckStatus;
    summary: string;
    evidence: BugFinderEvidence[];
    durationMs: number;
};
export type BugFinderSkippedSurface = {
    id: string;
    tier: BugFinderTier;
    surface: string;
    reason: string;
    requiresOptIn: boolean;
    optInFlag?: string;
};
export type BugFinderSourceAuthority = "official" | "curated-secondary" | "validated-example" | "discovery";
export type BugFinderKnowledgeSource = {
    id: string;
    title: string;
    url: string;
    authority: BugFinderSourceAuthority;
    purpose: string;
    validation: string;
};
export type BugFinderCommandSpec = {
    id: string;
    command: string;
    args: string[];
    cwd: string;
    timeoutMs?: number;
};
export type BugFinderCommandResult = {
    exitCode: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
};
export type BugFinderRunCommand = (spec: BugFinderCommandSpec) => Promise<BugFinderCommandResult>;
export type BugFinderProbeCategory = "happy" | "edge" | "regression" | "error" | "adversarial";
export type BugFinderProbe = {
    id: string;
    category: BugFinderProbeCategory;
    severity: BugFinderSeverity;
    description: string;
    evidence: string[];
};
export type BugFinderSkippedLiveSurface = {
    surface: "opencode" | "codex" | "team-mode";
    reason: string;
};
export type BugFinderRealWorldQaGap = {
    id: string;
    severity: BugFinderSeverity;
    description: string;
    evidence: string[];
    recommendedProbe: string;
};
export type BugFinderPackageScript = {
    name: string;
    command: string;
};
export type BugFinderPackageSurface = {
    path: string;
    scripts: BugFinderPackageScript[];
};
export type BugFinderDocSurface = {
    path: string;
    present: boolean;
};
export type BugFinderSourceSurface = {
    id: string;
    path: string;
    present: boolean;
};
export type BugFinderInventory = {
    files: string[];
    processes: string[];
    features: string[];
    workflows: string[];
    testSurfaces: string[];
    packages: BugFinderPackageSurface[];
    docs: BugFinderDocSurface[];
    sourceSurfaces: BugFinderSourceSurface[];
    realWorldQaGaps: BugFinderRealWorldQaGap[];
};
export type BugFinderSummary = {
    errors: number;
    warnings: number;
    infos: number;
    probes: number;
    gaps: number;
    findings: number;
    checks: number;
    failedChecks: number;
    skippedLiveSurfaces: number;
    skippedSurfaces: number;
};
export type BugFinderReport = {
    schemaVersion: 1;
    adapter: "opencode";
    target: {
        directory: string;
    };
    inventory: BugFinderInventory;
    probes: BugFinderProbe[];
    findings: BugFinderFinding[];
    checks: BugFinderCheck[];
    knowledgeSources: BugFinderKnowledgeSource[];
    skippedLiveSurfaces: BugFinderSkippedLiveSurface[];
    skippedSurfaces: BugFinderSkippedSurface[];
    summary: BugFinderSummary;
};
