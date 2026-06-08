export interface HostSkillConfigShape {
    paths?: string[];
    urls?: string[];
}
export declare function readOpencodeConfigSkills(directory: string): HostSkillConfigShape | undefined;
