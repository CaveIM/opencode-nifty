type SkillFileReader = (path: string, encoding: "utf8") => string;
export declare function createSharedSkillTemplateLoader(readFile?: SkillFileReader, baseDir?: string): (skillName: string) => string;
export declare function loadSharedSkillTemplate(skillName: string): string;
export {};
