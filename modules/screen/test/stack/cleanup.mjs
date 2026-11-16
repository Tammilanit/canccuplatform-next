// The stack tests' cleanup in their `finally` (#583): a device left paired plays on as a screen, so
// one failed step must not skip the ones after it, nor hide the error that ended the run.

const messageOf = (err) => String(err?.message ?? err).split("\n")[0];

/**
 * Runs every step in order, also after one fails, then throws one error naming each failure. When
 * the run it cleans up after has already thrown (`threw`), it logs them instead: thrown from a
 * `finally`, they would replace that run's own error.
 */
export async function cleanUp(steps, threw = false) {
  const errors = [];
  for (const step of steps) {
    try {
      await step();
    } catch (err) {
      errors.push(err);
    }
  }
  if (errors.length === 0) return;
  const failed = new AggregateError(errors, `cleanup failed: ${errors.map(messageOf).join("; ")}`);
  if (threw) console.error(failed.message);
  else throw failed;
}
