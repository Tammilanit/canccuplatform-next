// Types for screen-pages.mjs, which runs as plain JavaScript in the screenshot run.
export interface ScreenPage<P> {
  page: P;
  close: () => Promise<void>;
}
export function screenPages<P>(deps: {
  browser: { newContext: (options: object) => Promise<unknown> };
  cookieOn: (cookie: string) => object;
  fail: (message: string) => void;
}): {
  open: (size: [number, number], cookie?: string | null) => Promise<ScreenPage<P>>;
  attempt: (name: string, run: () => Promise<unknown>) => Promise<void>;
};
/** The part of a Playwright route handStates uses. */
interface StateRoute {
  fetch(): Promise<{ json(): Promise<unknown> }>;
  fulfill(options: { response?: unknown; json: unknown }): Promise<unknown>;
  abort(): Promise<unknown>;
}
export function handStates<S>(
  page: { route(url: string, handler: (route: StateRoute) => Promise<void>): Promise<unknown> },
  close: () => Promise<void>,
  change: (state: S) => S,
): Promise<{ unhanded: Promise<never>; close: () => Promise<void> }>;
