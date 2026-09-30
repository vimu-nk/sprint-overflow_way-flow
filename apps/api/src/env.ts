// Host dev: load the repo-root .env. In containers there is no file and compose env applies.
try {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
} catch {
  // no .env
}
