// What a package's Vitest global setup hands to its test files, read there with `inject`
declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string
  }
}

export {}
