/**
 * `GET /theming/logo` (contracts/theming.md, Reading the current theme): the one address the
 * organiser shell's header and the sign-in and check-in posters name (packages/ui), so every
 * module's page shows the event's logo without reading the theme. Without a logo it answers the
 * event's initials, drawn as the shell's avatar draws them (docs/design/mockups.html, sheet 1,
 * "Logo and name"); only theming knows whether there is a logo, so the page never has to.
 */
import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { TenantResolver } from "@canccu/kit";
import { initials } from "@canccu/ui";
import type { Db } from "./db.js";
import type { ProfileSource } from "./profile.js";
import { currentTheme } from "./theme.js";
import { adminTokens, platformTokens } from "./tokens.js";

export interface LogoDeps {
  db: Db;
  profile: ProfileSource;
  /** Names the event (with the request's Cookie while it is draft); no answer leaves "?". */
  tenants?: Pick<TenantResolver, "event">;
}

const SVG_POLICY = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

const xml = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * A square of the primary-to-accent gradient with the initials in the text colour for primary,
 * from the admin tokens: the platform's colours when the theme fails the contrast rules, as on
 * the organiser pages it sits in. The colours are `#rrggbb` tokens, checked when stored.
 */
export function initialsSvg(text: string, colors: Record<string, string>): string {
  const [primary, accent, ink] = [colors.primary, colors.accent, colors.primary_text];
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" width="80" height="80">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    `<stop offset="0" stop-color="${xml(primary ?? "")}"/>` +
    `<stop offset="1" stop-color="${xml(accent ?? "")}"/></linearGradient></defs>` +
    '<rect width="80" height="80" rx="23" fill="url(#g)"/>' +
    `<text x="40" y="41" fill="${xml(ink ?? "")}" font-family="system-ui, sans-serif"` +
    ' font-size="30" font-weight="700" text-anchor="middle" dominant-baseline="central">' +
    `${xml(text)}</text></svg>`
  );
}

/**
 * The name the logo may show, or null for none. A draft event shows guests nothing
 * (contracts/tenants.md, Lifecycle): tenants alone decides, from the request's own Cookie, who
 * learns its name, and every other answer hides the event behind a plain "?".
 */
async function visibleName(
  deps: LogoDeps,
  request: FastifyRequest,
): Promise<{ name: string } | null> {
  const host = request.headers.host;
  if (request.tenant?.status !== "draft") {
    const event = await deps.tenants?.event(host).catch(() => null);
    return { name: event?.name ?? "" };
  }
  const cookie = request.headers.cookie;
  if (cookie === undefined || deps.tenants === undefined) return null;
  const event = await deps.tenants.event(host, cookie).catch(() => null);
  return typeof event?.name === "string" && event.name !== "" ? { name: event.name } : null;
}

export function logoRoutes(app: FastifyInstance, deps: LogoDeps): void {
  app.get("/theming/logo", async (request, reply) => {
    // Short-lived: a newly published logo shows on the next page. A draft's answer depends on
    // the session, so no shared cache may hand it to the next visitor.
    const draft = request.tenant?.status === "draft";
    void reply.header("cache-control", draft ? "private, no-cache" : "no-cache");
    const named = await visibleName(deps, request);
    let svg: string;
    if (named === null) {
      svg = initialsSvg("?", adminTokens(platformTokens()).colors);
    } else {
      const theme = await currentTheme(deps.db, deps.profile);
      if (theme.logo_url !== undefined) return reply.redirect(theme.logo_url, 302);
      svg = initialsSvg(initials(named.name), adminTokens(theme.tokens).colors);
    }
    const etag = `"${createHash("sha256").update(svg).digest("hex").slice(0, 32)}"`;
    void reply.header("etag", etag);
    if (request.headers["if-none-match"] === etag) return reply.code(304).send();
    return reply
      .header("content-type", "image/svg+xml")
      .header("x-content-type-options", "nosniff")
      .header("cross-origin-resource-policy", "same-origin")
      .header("content-security-policy", SVG_POLICY)
      .send(svg);
  });
}
