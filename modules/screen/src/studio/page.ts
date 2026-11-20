/**
 * The Studio's page shell (routes.ts): the tabs and the rights each needs, the page guard, and a
 * page drawn in the organiser shell with the event, the frozen banner and the client's strings.
 */
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import { MissingRight, checkAdminAccess, eventPageCsp, newNonce } from "@canccu/kit";
import type { RightsChecker } from "@canccu/kit";
import { html, notice, raw, shellPage } from "@canccu/ui";
import type { EventInfo, Slot } from "@canccu/ui";
import { tenantOf } from "../http.js";
import { PIN_READ_RIGHTS } from "../pins/routes.js";
import { CLIENT_KEYS, translator } from "./messages.js";
import type { MessageKey, Translate } from "./messages.js";
import { frozenBanner } from "./pins-view.js";
import type { StudioDeps } from "./routes.js";
import { STATIC_TYPES } from "./static-files.js";
import { STUDIO } from "./views.js";

export const SIGN_IN = "/admin/sign-in";
export const READ = "screen.devices.read";
export const ZONES = "screen.zones.write";
export const TICKER = "screen.ticker.write";
export const CONTENT = "screen.content.read";

/**
 * A signed-out browser's way to sign in from Devices: a page, not a redirect, so its script can
 * keep the kiosk QR's pairing code, which rides in the fragment and is lost through sign-in
 * (static/studio-signin.js). Without scripts it goes on to sign in all the same.
 */
export function signInStep(request: FastifyRequest, reply: FastifyReply, t: Translate) {
  const next = `${SIGN_IN}?next=${encodeURIComponent(request.url)}`;
  const doc = html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${t("signin.go")}</title>
        <noscript><meta http-equiv="refresh" content="0;url=${next}" /></noscript>
      </head>
      <body>
        <a href="${next}" data-sign-in>${t("signin.go")}</a>
        <script src="${STUDIO}static/studio-signin.js"></script>
      </body>
    </html>`;
  return reply
    .type("text/html; charset=utf-8")
    .header(
      "content-security-policy",
      eventPageCsp(newNonce(), request.hostname, { page: "admin" }),
    )
    .header("cache-control", "no-store")
    .header("x-content-type-options", "nosniff")
    .send(doc.toString());
}

/** The tabs, each shown only to holders of one of its rights (Live and Devices share one). */
export const TABS: [path: string, label: MessageKey, rights: readonly string[]][] = [
  ["live", "tab.live", [READ]],
  ["devices", "tab.devices", [READ]],
  ["zones", "tab.zones", [ZONES]],
  // Studio → Moments and Scenes are the moments module's own pages (contracts/moments.md, Pages).
  ["/moments/", "tab.moments", ["moments.read"]],
  ["/moments/scenes", "tab.scenes", ["moments.read"]],
  ["schedule", "tab.schedule", [CONTENT]],
  ["content", "tab.content", [CONTENT]],
  ["ticker", "tab.ticker", [TICKER]],
  ["pins", "tab.pins", PIN_READ_RIGHTS],
];
/** A tab's link: the Studio's own pages by name, another module's by its path. */
export const tabHref = (path: string): string => (path.startsWith("/") ? path : STUDIO + path);
export const ANY_TAB = [...new Set(TABS.flatMap(([, , rights]) => rights))];
/**
 * The rights to change something in the Studio. An archived event changes nothing (sheets 2 and
 * 8), so its pages are drawn without them: every action is absent, as for a reader.
 */
export const CHANGE_RIGHTS = new Set([
  "screen.bundle.write",
  "screen.content.write",
  "screen.devices.pair",
  "screen.devices.write",
  "screen.push.write",
  "screen.ticker.write",
  "screen.zones.write",
]);
export const archived = (request: FastifyRequest): boolean =>
  tenantOf(request).status === "archived";
export const holds = (rights: ReadonlySet<string>, any: readonly string[]) =>
  any.some((r) => rights.has(r));

/** Sign-in first (so a signed-out browser is sent to sign in), then the address rule, then a right. */
export function pageNeeds(
  rights: RightsChecker,
  any: readonly string[],
): preHandlerAsyncHookHandler {
  return async (request) => {
    const session = await rights.session(request.headers.cookie);
    request.session = session;
    checkAdminAccess(tenantOf(request), request.ip);
    if (!holds(session.rights, any)) {
      throw new MissingRight(`needs one of the rights ${any.join(", ")}`);
    }
  };
}

export async function eventOf(request: FastifyRequest, deps: StudioDeps): Promise<EventInfo> {
  const ctx = tenantOf(request);
  const e = await deps
    .publicEvent?.(request.headers.host, request.headers.cookie)
    .catch(() => null);
  return {
    name: e?.name,
    status: ctx.status,
    timeZone: ctx.time_zone,
    startsAt: e?.starts_at,
    endsAt: e?.ends_at,
    venue: ctx.venue?.name,
  };
}

export async function translate(deps: StudioDeps): Promise<Translate> {
  // An admin that cannot answer leaves the page in English rather than failing it.
  const language = await deps.adminSettings.ensure().then(
    () => deps.adminSettings.get("language", "en"),
    () => "en",
  );
  return translator(String(language));
}

/** The client's strings as a JSON block; `<` escaped so no text can close the element. */
function clientText(t: Translate): Slot {
  const text = Object.fromEntries(CLIENT_KEYS.map((k) => [k, t(k)]));
  return raw(
    `<script type="application/json" id="canccu-studio-text">${JSON.stringify(text).replace(/</g, "\\u003c")}</script>`,
  );
}

export interface PageOptions {
  title: string;
  tab?: string;
  body: Slot;
  actions?: Slot;
  description?: string;
  crumb?: { href: string; label: string };
  status?: number;
  plain?: boolean;
  /** A page's own stylesheet and script, each if it has one (`<name>.css`, `<name>.js`, using studio.js's helpers). */
  own?: string;
  /** The page's own script is a module, which may import its neighbours in static/. */
  module?: boolean;
  /** Whether the page's own script loads: by default when it has one; the schedule's is writers'. */
  script?: boolean;
  /** Rules made of numbers only (the schedule's block places), under the page's nonce. */
  style?: string;
  /** A collection, a board or a master–detail editor (amendment 3): up to 120rem of content;
   * other pages keep the 64rem default. */
  wide?: boolean;
}

export async function studioPage(
  request: FastifyRequest,
  reply: FastifyReply,
  deps: StudioDeps,
  t: Translate,
  o: PageOptions,
): Promise<FastifyReply> {
  const nonce = newNonce();
  const rights = request.session?.rights ?? new Set<string>();
  // While frozen, every page says so to whoever may read the pin (an error page reads nothing).
  const banner =
    o.plain || !holds(rights, PIN_READ_RIGHTS)
      ? ""
      : await frozenBanner(deps, tenantOf(request), t);
  const doc = shellPage({
    title: o.title,
    nonce,
    surface: "admin",
    cssHref: `${STUDIO}static/ui.css`,
    head: html`<link
        rel="stylesheet"
        href="${STUDIO}static/studio.css"
      />${o.own === undefined || !Object.hasOwn(STATIC_TYPES, `${o.own}.css`) ? "" : html`<link rel="stylesheet" href="${STUDIO}static/${o.own}.css" />`}${
        o.style === undefined
          ? ""
          : html`<style nonce="${nonce}">
              ${raw(o.style)}
            </style>`
      }`,
    event: await eventOf(request, deps),
    session: request.session ?? undefined,
    current: "screen",
    plain: o.plain ?? false,
    ...(o.description === undefined ? {} : { description: o.description }),
    ...(o.crumb === undefined ? {} : { crumb: o.crumb }),
    ...(o.actions === undefined ? {} : { actions: o.actions }),
    ...(o.wide === true ? { width: "wide" as const } : {}),
    ...(o.tab === undefined
      ? {}
      : {
          tabs: TABS.filter(([, , any]) => holds(rights, any)).map(([path, label]) => ({
            href: tabHref(path),
            label: t(label),
            current: path === o.tab,
          })),
        }),
    body: html`${banner}${o.plain || !archived(request) ? "" : notice({ kind: "info", title: t("studio.archived") })}
      <p class="canccu-studio-notice" role="status" hidden></p>
      ${o.body}${clientText(t)}
      <script src="${STUDIO}static/studio.js" defer></script>
      ${
        o.own === undefined || !(o.script ?? Object.hasOwn(STATIC_TYPES, `${o.own}.js`))
          ? ""
          : o.module === true
            ? html`<script type="module" src="${STUDIO}static/${o.own}.js"></script>`
            : html`<script src="${STUDIO}static/${o.own}.js" defer></script>`
      }`,
  });
  // Admin pages frame surface pages (the virtual screen) and are never framed themselves.
  return reply
    .type("text/html; charset=utf-8")
    .header("content-security-policy", eventPageCsp(nonce, request.hostname, { page: "admin" }))
    .header("cache-control", "no-store")
    .header("x-content-type-options", "nosniff")
    .status(o.status ?? 200)
    .send(doc.toString());
}
