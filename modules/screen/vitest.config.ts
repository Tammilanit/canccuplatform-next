import { defineConfig } from "vitest/config";

// The Postgres tests share one database and reset its tables per file: run files one at a time.
export default defineConfig({ test: { include: ["test/**/*.test.ts"], fileParallelism: false } });
