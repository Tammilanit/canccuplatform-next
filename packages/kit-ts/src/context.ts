/** Correlation id carried through a request or event handler. */
import { AsyncLocalStorage } from "node:async_hooks";
import { v7 } from "uuid";

export const CORRELATION_HEADER = "x-correlation-id";

const storage = new AsyncLocalStorage<string>();

export function getCorrelationId(): string | undefined {
  return storage.getStore();
}

/** A new UUID v7. */
export function newId(): string {
  return v7();
}

/** Run `fn` with a correlation id (a new one when none is given). */
export function withCorrelation<T>(id: string | undefined, fn: (id: string) => T): T {
  const value = id ?? newId();
  return storage.run(value, () => fn(value));
}
