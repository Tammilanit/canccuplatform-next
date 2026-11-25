/** Types for studio-devices.js, which the page loads as it is; only the tests read these. */

export interface ApiAnswer {
  status: number;
  ok: boolean;
  data: { id?: string; error?: { code?: string; message?: string } } | null;
}

export function pairErrorKey(r: ApiAnswer): string | null;

export function cleanCode(value: unknown): string;

export function pairing(
  doc: unknown,
  win: unknown,
  helpers: {
    api: (method: string, url: string, body?: unknown) => Promise<ApiAnswer>;
    failure: (r: ApiAnswer) => string;
    reloadWith: (message: string, next?: string) => void;
    say: (key: string, values?: Record<string, unknown>) => string;
  },
): void;
