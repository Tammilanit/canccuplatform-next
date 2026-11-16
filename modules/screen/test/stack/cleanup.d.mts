// Types for cleanup.mjs, which runs as plain JavaScript inside the stack's containers.
export function cleanUp(steps: (() => unknown)[], threw?: boolean): Promise<void>;
