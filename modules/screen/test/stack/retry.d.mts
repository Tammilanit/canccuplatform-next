// Types for retry.mjs, which runs as plain JavaScript inside the stack's containers.
export function isConnectionError(err: unknown): boolean;
export function retrying<T>(
  fn: () => Promise<T>,
  options?: {
    tries?: number;
    waitMs?: number;
    wait?: (ms: number) => Promise<void>;
    isRetryable?: (err: unknown) => boolean;
  },
): Promise<T>;
export function stopReason(err: unknown): string;
