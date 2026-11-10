/**
 * What the composed state reads from other modules, on the screens' behalf and never with a
 * device's request (contracts/screen.md, Reading other modules as a module). The reads go to each
 * module's own public path with the event's hostname, as a guest would read it, so a screen shows
 * exactly what the hub shows and nothing crew-only: one source, two surfaces.
 */
import type { AgendaItem, AgendaNow, VenueInfo } from "./widgets.js";

export interface ThemeNow {
  revision: number;
  tokens_css_url: string;
  css_url: string | null;
  logo_url: string | null;
  layouts: unknown[];
  templates: unknown[];
}

export interface EventPublic {
  name: string;
}

/** Every read answers `null` when its module is down or refuses, so a screen never goes blank. */
export interface Sources {
  agendaNow(host: string, zoneKey: string): Promise<AgendaNow | null>;
  venueInfo(host: string): Promise<VenueInfo | null>;
  theme(host: string): Promise<ThemeNow | null>;
  event(host: string): Promise<EventPublic | null>;
}

export interface SourceUrls {
  agenda: string;
  tenants: string;
  theming: string;
}

const READ_TIMEOUT_MS = 1500;

export function httpSources(urls: SourceUrls, fetchFn: typeof fetch = fetch): Sources {
  const read = async (base: string, path: string, host: string): Promise<unknown> => {
    try {
      const response = await fetchFn(`${base.replace(/\/+$/, "")}${path}`, {
        headers: { host, accept: "application/json" },
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
      });
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  };
  return {
    agendaNow: async (host, zoneKey) => {
      const body = (await read(
        urls.agenda,
        `/api/agenda/now?zone=${encodeURIComponent(zoneKey)}`,
        host,
      )) as { current?: AgendaItem[]; next?: AgendaItem[] } | null;
      if (body === null || !Array.isArray(body.current) || !Array.isArray(body.next)) return null;
      return { current: body.current, next: body.next };
    },
    venueInfo: async (host) => {
      const body = (await read(
        urls.tenants,
        "/api/tenants/current/venue-info",
        host,
      )) as VenueInfo | null;
      return body === null || !Array.isArray(body.wifi) ? null : body;
    },
    theme: async (host) => {
      const body = (await read(urls.theming, "/api/theming/current", host)) as ThemeNow | null;
      return body === null || typeof body.revision !== "number" ? null : body;
    },
    event: async (host) => {
      const body = (await read(urls.tenants, "/api/tenants/current", host)) as EventPublic | null;
      return body === null || typeof body.name !== "string" ? null : body;
    },
  };
}

/** Nothing reachable: what tests and a stack without the other modules get. */
export const noSources: Sources = {
  agendaNow: () => Promise.resolve(null),
  venueInfo: () => Promise.resolve(null),
  theme: () => Promise.resolve(null),
  event: () => Promise.resolve(null),
};
