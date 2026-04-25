// Env vars are set by contract-global-setup.ts in the main process before
// workers fork — they are inherited. This file is a no-op placeholder that
// ensures setupFiles runs before any test module imports config/index.ts.
// (No additional action needed: process.env is already populated.)
