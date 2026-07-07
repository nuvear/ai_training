// In the app, importing `server-only` guarantees a module never reaches a client
// bundle. Under Vitest (plain Node) that guard is irrelevant, so we alias the
// package to this empty module — see vitest.config.ts.
export {};
