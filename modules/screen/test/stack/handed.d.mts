// Types for handed.mjs, which runs as plain JavaScript inside the stack's containers.
interface Region {
  id: string;
  role?: string | null;
  order: number[];
  claim: { template: string } | null;
  idle_view?: { widget: string; view: Record<string, unknown> } | null;
  widgets: { widget: string; view: { empty?: boolean } }[];
}
export function withShowcase<S extends { regions: Region[] }>(s: S): S;
export function withHeroShowcase<S extends { regions: Region[] }>(s: S): S;
export function withSmallShowcase<S extends { regions: Region[] }>(s: S): S;
export function withPhoto<S extends { regions: Region[] }>(s: S, featured?: boolean): S;
export function withComingHours<
  S extends {
    tenant: { time_zone: string };
    zone?: { key: string };
    regions: (Region & { area?: { columns: number } })[];
  },
>(s: S): S;
