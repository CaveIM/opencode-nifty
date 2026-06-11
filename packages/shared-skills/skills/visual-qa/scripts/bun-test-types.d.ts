declare module "bun:test" {
  export const describe: (name: string, fn: () => void) => void
  export const test: (name: string, fn: () => void | Promise<void>) => void
  export const expect: (value: unknown, message?: string) => {
    toContain(expected: string): void
    toBe(expected: unknown): void
    toThrow(expected?: unknown): void
  }
}

declare module "node:fs" {
  export const existsSync: (path: string) => boolean
  export const readFileSync: (path: string, encoding: "utf8") => string
}

declare module "node:path" {
  export const dirname: (path: string) => string
  export const join: (...paths: string[]) => string
}

interface ImportMeta {
  readonly dir: string
}
