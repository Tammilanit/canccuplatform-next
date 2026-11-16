/**
 * What Moments asks Screen about sound (contracts/screen.md, For Moments): a zone's energy and its
 * sound screen, and an `audio` asset the library links. Through Screen's internal paths with the
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

export interface ScreenClient {
  /** Null when Screen does not know the zone or does not answer. */
  zoneSound(tenant: string, zone: string): Promise<ZoneSoundStatus | null>;
  /** Null when the event has no such asset. */
  asset(tenant: string, assetId: string): Promise<AudioAsset | null>;
}

const ENERGIES = new Set(["party", "lively", "calm", "quiet"]);

export function screenClient(
  screenUrl: string,
  service: ServiceIdentity,
  fetchFn: typeof fetch = fetch,
): ScreenClient {
  const base = screenUrl.replace(/\/+$/, "");
  const get = async (path: string, tenant: string): Promise<unknown> => {
    const res = await fetchFn(`${base}${path}?tenant_id=${encodeURIComponent(tenant)}`, {
      headers: service.headers("screen"),
      // A sound decides within a request or the tick: a slow Screen must not hold either.
      signal: AbortSignal.timeout(1500),
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`screen answered ${String(res.status)}`);
    return res.json();
  };
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
  };
}
