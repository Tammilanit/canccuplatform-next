// The soak's calls to screen, retried when the connection fails (#415). A busy CI runner may drop
// or stall one connection in hours of calls; that is not what the soak measures, so it is tried
// again, and when it still fails the verdict names it apart from a heap overrun.

const CONNECTION_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
]);
// Playwright's `route.fetch()` and client.mjs's timeout carry the cause only in the message.
const CONNECTION_TEXT =
  /ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|EAI_AGAIN|socket hang up|timed out|Timeout \d+ms exceeded/;

/** Whether `err` is a connection that dropped, was refused or got no answer in time. */
export function isConnectionError(err) {
  if (!(err instanceof Error)) return false;
  return CONNECTION_CODES.has(err.code) || CONNECTION_TEXT.test(err.message);
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `fn`'s answer, trying it again (up to `tries` in all, `waitMs` apart) while it fails with a
 * connection error. The last error is thrown with `tries`, how many were made.
 */
export async function retrying(
  fn,
  { tries = 3, waitMs = 1000, wait = pause, isRetryable = isConnectionError } = {},
) {
  for (let made = 1; ; made++) {
    try {
      return await fn();
    } catch (err) {
      if (made >= tries || !isRetryable(err)) {
        if (err instanceof Error) err.tries = made;
        throw err;
      }
      await wait(waitMs);
    }
  }
}

/** The verdict's line for an error that stopped the run. */
export function stopReason(err) {
  const message = err instanceof Error ? err.message : String(err);
  if (isConnectionError(err)) {
    const tries = err.tries ?? 1;
    return `a connection to screen failed after ${tries} ${tries === 1 ? "try" : "tries"} (not a heap overrun): ${message}`;
  }
  return `the run stopped: ${message}`;
}
