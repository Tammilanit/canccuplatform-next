/**
 * `GET /theming/logo` (contracts/theming.md, Reading the current theme): the one address the
 * organiser shell's header and the sign-in and check-in posters name (packages/ui), so every
 * module's page shows the event's logo without reading the theme. Without a logo it answers the
 * event's initials, drawn as the shell's avatar draws them (docs/design/mockups.html, sheet 1,
 * "Logo and name"); only theming knows whether there is a logo, so the page never has to.
 */
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { TenantResolver } from "@canccu/kit";
import type { Db } from "./db.js";
import type { ProfileSource } from "./profile.js";
import { currentTheme } from "./theme.js";
import { adminTokens } from "./tokens.js";

export interface LogoDeps {
  db: Db;
  profile: ProfileSource;
  /** Names the event; a tenants module that does not answer leaves "?". */
  tenants?: Pick<TenantResolver, "event">;
}

const SVG_POLICY = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

/** The first letter of each of the first two words, as the shell's avatar takes them. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (
    words
      .slice(0, 2)
      .map((w) => (w[0] ?? "").toUpperCase())
      .join("") || "?"
  );
}

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

export function logoRoutes(app: FastifyInstance, deps: LogoDeps): void {
  app.get("/theming/logo", async (request, reply) => {
    const theme = await currentTheme(deps.db, deps.profile);
    // Short-lived: a newly published logo shows on the next page.
    void reply.header("cache-control", "no-cache");
    if (theme.logo_url !== undefined) return reply.redirect(theme.logo_url, 302);
    const event = await deps.tenants?.event(request.headers.host).catch(() => null);
    const svg = initialsSvg(initials(event?.name ?? ""), adminTokens(theme.tokens).colors);
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
