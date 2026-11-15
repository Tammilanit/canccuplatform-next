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
