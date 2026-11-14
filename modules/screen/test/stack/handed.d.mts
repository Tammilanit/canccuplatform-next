// Types for handed.mjs, which runs as plain JavaScript inside the stack's containers.
interface Region {
  id: string;
  order: number[];
  claim: { template: string } | null;
  widgets: { widget: string }[];
}
export function withSmallShowcase<S extends { regions: Region[] }>(s: S): S;
