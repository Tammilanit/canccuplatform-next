import ffprobe from "@ffprobe-installer/ffprobe";
import { defineConfig } from "vitest/config";

// The Postgres tests share one database and reset its tables per file: run files one at a time.
// The media tests run the real ffprobe: the image's own when CANCCU_FFPROBE names it, otherwise
// the dev dependency's build, so they never skip on a machine without ffmpeg.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    fileParallelism: false,
    env: { CANCCU_FFPROBE: process.env.CANCCU_FFPROBE ?? ffprobe.path },
  },
});
