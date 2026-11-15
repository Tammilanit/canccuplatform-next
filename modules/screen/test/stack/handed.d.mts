// Types for handed.mjs, which runs as plain JavaScript inside the stack's containers.
interface Region {
  id: string;
  role?: string | null;
  order: number[];
  claim: { template: string } | null;
  widgets: { widget: string; view: { empty?: boolean } }[];
}
export function withShowcase<S extends { regions: Region[] }>(s: S): S;
export function withHeroShowcase<S extends { regions: Region[] }>(s: S): S;
export function withSmallShowcase<S extends { regions: Region[] }>(s: S): S;
