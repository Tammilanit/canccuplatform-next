/**
 * What Moments asks Screen (contracts/screen.md, For Moments): a zone's energy and its sound
 * screen, an `audio` asset the library links, the event's images for the crew spotlight's
 * photo picker, and the zones' names the pages show (#638). Through Screen's internal paths with the
 * kit's service identity; Moments never reads Screen's data.
 */
import type { ServiceIdentity } from "@canccu/kit";
import type { Energy } from "./decide.js";

export interface ZoneSoundStatus {
  energy: Energy;
  /** The zone's sound screen, or null when sound is off on the zone or it names none. */
  device: { id: string; name: string; online: boolean; audio_unlocked: boolean | null } | null;
}

export interface AudioAsset {
  id: string;
  kind: string;
  title: string;
  url: string;
  size_bytes: number | null;
  duration_seconds: number | null;
}

export interface ScreenImage {
  id: string;
  title: string;
  /** The file under `/api/screen/files/`, as the screens load it. */
  url: string;
}

export interface ScreenClient {
  /** Null when Screen does not know the zone or does not answer. */
  zoneSound(tenant: string, zone: string): Promise<ZoneSoundStatus | null>;
  /** Null when the event has no such asset. */
  asset(tenant: string, assetId: string): Promise<AudioAsset | null>;
  /** The event's images, newest first; none when Screen does not answer. */
  images(tenant: string): Promise<ScreenImage[]>;
  /** The event's zones with their names; none when Screen does not answer. */
  zones(tenant: string): Promise<{ key: string; name: string }[]>;
  /** An image's bytes for its thumbnail; null when the event has no such image. */
  image(tenant: string, assetId: string): Promise<{ type: string; body: Buffer } | null>;
}

const ENERGIES = new Set(["party", "lively", "calm", "quiet"]);

export function screenClient(
  screenUrl: string,
  service: ServiceIdentity,
  fetchFn: typeof fetch = fetch,
): ScreenClient {
  const base = screenUrl.replace(/\/+$/, "");
  const ask = async (path: string, tenant: string): Promise<Response | null> => {
    const res = await fetchFn(`${base}${path}?tenant_id=${encodeURIComponent(tenant)}`, {
      headers: service.headers("screen"),
      // A sound decides within a request or the tick: a slow Screen must not hold either.
      signal: AbortSignal.timeout(1500),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`screen answered ${String(res.status)}`);
    return res;
  };
  const get = async (path: string, tenant: string): Promise<unknown> =>
    (await ask(path, tenant))?.json() ?? null;
  return {
    async zoneSound(tenant, zone) {
      try {
        const v = (await get(
          `/internal/screen/zones/${encodeURIComponent(zone)}/sound`,
          tenant,
        )) as ZoneSoundStatus | null;
        return v !== null && ENERGIES.has(v.energy) ? v : null;
      } catch {
        return null;
      }
    },
    async asset(tenant, assetId) {
      return (await get(
        `/internal/screen/assets/${encodeURIComponent(assetId)}`,
        tenant,
      )) as AudioAsset | null;
    },
    async images(tenant) {
      try {
        const v = (await get("/internal/screen/images", tenant)) as {
          images?: ScreenImage[];
        } | null;
        return v?.images ?? [];
      } catch {
        return [];
      }
    },
    async zones(tenant) {
      try {
        const v = (await get("/internal/screen/zones", tenant)) as {
          zones?: { key: string; name: string }[];
        } | null;
        return v?.zones ?? [];
      } catch {
        return [];
      }
    },
    async image(tenant, assetId) {
      const res = await ask(`/internal/screen/images/${encodeURIComponent(assetId)}`, tenant);
      if (res === null) return null;
      return {
        type: res.headers.get("content-type") ?? "application/octet-stream",
        body: Buffer.from(await res.arrayBuffer()),
      };
    },
  };
}
