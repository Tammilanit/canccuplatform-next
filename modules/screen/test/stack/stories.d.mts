// Types for stories.mjs, which runs as plain JavaScript in the screenshot run.
export function storiesOff(demo: {
  call(
    method: string,
    path: string,
    o?: { body?: unknown },
  ): Promise<{ status: number; body: unknown }>;
}): Promise<() => Promise<void>>;
