// Types for client.mjs, which runs as plain JavaScript inside the stack's containers: the part the
// unit tests use.
export const SCREEN: { host: string; port: number };
export function event(host: string): {
  host: string;
  revoke: (id: string) => Promise<unknown>;
};
