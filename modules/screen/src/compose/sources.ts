/**
 * What the composed state reads from other modules, on the screens' behalf and never with a
 * device's request (contracts/screen.md, Reading other modules as a module). The theme, now and
 * next and the venue info come from module reads that answer what a guest sees, whatever the
 * info-page mode: screen's container is no venue address, so the guest read is refused in
 * `venue_only` and `sign_in`. The event's name is still read as a guest, with the event's hostname.
 * Either way a screen shows exactly what the hub shows and nothing crew-only: one source, two surfaces.
 */
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { ServiceIdentity } from "@canccu/kit";
import { laterOf } from "./widgets.js";
import type { AgendaItem, AgendaNow, CheckinCode, VenueInfo } from "./widgets.js";

export interface ThemeNow {
  revision: number;
  /** Complete, defaults filled in; only `motion` is read here (the display). */
  tokens?: { motion?: unknown };
  tokens_css_url: string;
  css_url: string | null;
  logo_url: string | null;
  layouts: unknown[];
  templates: unknown[];
  /** Each embed's name and its frame in the sandbox; absent from an older theming. */
  embeds?: { name: string; frame_url: string }[];
}

export interface EventPublic {
  name: string;
}

/** Every read answers `null` when its module is down or refuses, so a screen never goes blank. */
export interface Sources {
  agendaNow(tenantId: string, zoneKey: string): Promise<AgendaNow | null>;
  /** The event's whole run of show, read each time: the Studio's "what plays at…" (#267). */
  agendaItems(tenantId: string): Promise<AgendaItem[] | null>;
  venueInfo(tenantId: string): Promise<VenueInfo | null>;
  theme(tenantId: string): Promise<ThemeNow | null>;
  /** One revision of the event's theme, for a pin (contracts/screen.md, Pins). */
  themeRevision(tenantId: string, revision: number): Promise<ThemeNow | null>;
  event(host: string): Promise<EventPublic | null>;
  checkinCode(tenantId: string, purpose: string): Promise<CheckinCode | null>;
}

export interface SourceUrls {
  agenda: string;
  tenants: string;
  theming: string;
  notify: string;
}

const READ_TIMEOUT_MS = 1500;
/** Events whose whole agenda is kept; past it the oldest read goes first. */
const MAX_AGENDAS = 256;
const MAX_BODY_BYTES = 1024 * 1024;
const WARN_EVERY_MS = 60_000;

export interface SourceLog {
  warn(obj: object, msg: string): void;
}

/**
 * GET with a `Host` of our choosing (or the URL's own, for a module read). The global `fetch`
 * (undici) treats `Host` as a forbidden header and sends the URL's own authority, which no module
 * resolves to an event; node:http keeps it.
 */
function getJson(
  url: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  const target = new URL(url);
  const send = target.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = send(
      target,
      { headers: { ...headers, accept: "application/json" }, timeout: READ_TIMEOUT_MS },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) req.destroy(new Error("body too large"));
          else chunks.push(chunk);
        });
        res.on("end", () => {
          try {
            const text = Buffer.concat(chunks).toString("utf8");
            resolve({ status: res.statusCode ?? 0, body: text === "" ? null : JSON.parse(text) });
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        });
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

export function httpSources(urls: SourceUrls, service: ServiceIdentity, log?: SourceLog): Sources {
  // One warning per path a minute: a module that is down for a day must not fill the log.
  const lastWarned = new Map<string, number>();
  const warn = (path: string, detail: object): void => {
    const now = Date.now();
    if (log === undefined || now - (lastWarned.get(path) ?? 0) < WARN_EVERY_MS) return;
    lastWarned.set(path, now);
    log.warn({ path, ...detail }, "composed state source unavailable; its widgets show empty");
  };
  const read = async (
    base: string,
    path: string,
    headers: Record<string, string>,
  ): Promise<unknown> => {
    const route = path.split("?")[0] ?? path;
    try {
      const { status, body } = await getJson(`${base.replace(/\/+$/, "")}${path}`, headers);
      if (status >= 200 && status < 300) return body;
      warn(route, { status });
      return null;
    } catch (err) {
      warn(route, { err: err instanceof Error ? err.message : String(err) });
      return null;
    }
  };
  // The whole agenda, per event, for `agenda_now`'s `later`: read again only when now and next
  // say the agenda moved (contracts/screen.md, Reading other modules as a module), so the 10 s zone
  // refresh of every zone costs one small read, not the event's whole agenda. Keyed by the version,
  // a container never serves an older agenda than the now and next it read. The promise is kept, so
  // the zones of one event rebuilt together share one read.
  const readItems = async (tenantId: string): Promise<AgendaItem[] | null> => {
    const body = await read(
      urls.agenda,
      `/internal/agenda/items?tenant_id=${encodeURIComponent(tenantId)}`,
      service.headers("agenda"),
    );
    const list = (body as { items?: unknown } | null)?.items;
    if (!Array.isArray(list)) return null;
    // A promise that rejected here would stay kept and break every zone of the event until the
    // agenda moves, so entries that are not items are skipped, never read.
    return list
      .filter((i): i is AgendaItem => typeof i === "object" && i !== null && !Array.isArray(i))
      .map((i) => ({ ...i, location: i.location ?? null }));
  };
  const agendas = new Map<string, { version: number; items: Promise<AgendaItem[] | null> }>();
  const allItems = (tenantId: string, version: number): Promise<AgendaItem[] | null> => {
    const kept = agendas.get(tenantId);
    if (kept !== undefined && kept.version === version) return kept.items;
    const items = readItems(tenantId).then((list) => {
      // A failed read is tried again at the next build rather than kept.
      if (list === null && agendas.get(tenantId)?.items === items) agendas.delete(tenantId);
      return list;
    });
    agendas.delete(tenantId);
    if (agendas.size >= MAX_AGENDAS) agendas.delete(agendas.keys().next().value as string);
    agendas.set(tenantId, { version, items });
    return items;
  };
  return {
    agendaItems: readItems,
    agendaNow: async (tenantId, zoneKey) => {
      const query = `tenant_id=${encodeURIComponent(tenantId)}&zone=${encodeURIComponent(zoneKey)}`;
      const body = (await read(
        urls.agenda,
        `/internal/agenda/now?${query}`,
        service.headers("agenda"),
      )) as { agenda_version?: unknown; current?: AgendaItem[]; next?: AgendaItem[] } | null;
      if (body === null || !Array.isArray(body.current) || !Array.isArray(body.next)) return null;
      const now = { current: body.current, next: body.next };
      if (body.next.length === 0 || typeof body.agenda_version !== "number") return now;
      // Without the whole agenda the rail still shows now and next, only nothing after them.
      const all = await allItems(tenantId, body.agenda_version);
      return { ...now, later: all === null ? [] : laterOf(all, body.next, zoneKey) };
    },
    venueInfo: async (tenantId) => {
      const body = (await read(
        urls.tenants,
        `/internal/tenants/venue-info?tenant_id=${encodeURIComponent(tenantId)}`,
        service.headers("tenants"),
      )) as VenueInfo | null;
      return body === null || !Array.isArray(body.wifi) ? null : body;
    },
    theme: async (tenantId) => {
      const body = (await read(
        urls.theming,
        `/internal/theming/current?tenant_id=${encodeURIComponent(tenantId)}`,
        service.headers("theming"),
      )) as ThemeNow | null;
      return body === null || typeof body.revision !== "number" ? null : body;
    },
    themeRevision: async (tenantId, revision) => {
      const body = (await read(
        urls.theming,
        `/internal/theming/revisions/${revision}?tenant_id=${encodeURIComponent(tenantId)}`,
        service.headers("theming"),
      )) as ThemeNow | null;
      return body === null || body.revision !== revision ? null : body;
    },
    checkinCode: async (tenantId, purpose) => {
      const query = `tenant_id=${encodeURIComponent(tenantId)}&purpose=${encodeURIComponent(purpose)}`;
      const body = (await read(
        urls.notify,
        `/internal/notify/check-in/code?${query}`,
        service.headers("notify"),
      )) as CheckinCode | null;
      const fields = ["purpose", "code", "url", "valid_until", "rotates_at"] as const;
      return body === null || fields.some((f) => typeof body[f] !== "string") ? null : body;
    },
    event: async (host) => {
      const body = (await read(urls.tenants, "/api/tenants/current", {
        host,
      })) as EventPublic | null;
      return body === null || typeof body.name !== "string" ? null : body;
    },
  };
}

/** Nothing reachable: what tests and a stack without the other modules get. */
export const noSources: Sources = {
  agendaNow: () => Promise.resolve(null),
  agendaItems: () => Promise.resolve(null),
  venueInfo: () => Promise.resolve(null),
  theme: () => Promise.resolve(null),
  themeRevision: () => Promise.resolve(null),
  event: () => Promise.resolve(null),
  checkinCode: () => Promise.resolve(null),
};
