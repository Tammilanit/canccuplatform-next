/**
 * `GET`, `PUT /api/screen/pin` (contracts/screen.md, Pins and Timed pins and freeze): the values
 * with an optional `until`, the freeze form that pins what is in effect in one step, and
 * `freeze: false`, which puts `restores` back now. Each change is audited, announced as
 * `screen.pin.changed` and sent to the event's screens as a `reload`.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { KitError } from "@canccu/kit";
import type { Bus, PublicEvent, RightsChecker } from "@canccu/kit";
import type { Audit } from "../audit.js";
import type { Sources } from "../compose/sources.js";
import type { Db } from "../db.js";
import { assertWritable, body, invalidRequest, needs, needsAny, tenantOf } from "../http.js";
import type { Kv } from "../kv.js";
import type { Fanout } from "../push/store.js";
import { onlyKeys } from "../zone-input.js";
import type { BundleStore } from "./bundles.js";
import { announcePin, changePin, lockPin, readPin } from "./store.js";
import type { PinReason, PinRow, PinValues } from "./store.js";

/** Who may read the pin: every Studio page can then say that screens are frozen. */
export const PIN_READ_RIGHTS = [
  "screen.devices.read",
  "screen.content.read",
  "screen.bundle.write",
];
const PIN_WRITE_RIGHT = "screen.bundle.write";
const DAYS_14_MS = 14 * 24 * 3600_000;
/** The contract's read-only fields, ignored when a client sends a read pin back. */
const READ_ONLY = ["available", "in_effect", "restores", "changed_by", "changed_at"];

export interface PinDeps {
  db: Db;
  bus: Bus;
  kv: Kv;
  fanout: Pick<Fanout, "publish">;
  rights: RightsChecker;
  audit: Audit;
  sources: Pick<Sources, "theme" | "themeRevision">;
  bundles: BundleStore;
  publicEvent?: ((host: string | undefined) => Promise<PublicEvent | null>) | undefined;
  now?: () => number;
}

const themingDown = (): KitError =>
  new KitError("Theming did not answer, so what screens draw cannot be frozen. Try again.", {
    status: 503,
    code: "theming_unavailable",
  });

/** The values screens draw now: a null resolved to the platform's bundle or the current revision. */
export async function inEffect(
  deps: Pick<PinDeps, "sources" | "bundles">,
  tenantId: string,
  pin: PinValues,
): Promise<{ bundle_version: string; theme_revision: number }> {
  const theme =
    pin.theme_revision ?? (await deps.sources.theme(tenantId).catch(() => null))?.revision ?? 0;
  return { bundle_version: pin.bundle_version ?? deps.bundles.current, theme_revision: theme };
}

export async function pinView(
  deps: Pick<PinDeps, "sources" | "bundles">,
  tenantId: string,
  pin: PinRow,
): Promise<Record<string, unknown>> {
  return {
    bundle_version: pin.bundle_version,
    theme_revision: pin.theme_revision,
    until: pin.until?.toISOString() ?? null,
    available: await deps.bundles.available(),
    in_effect: await inEffect(deps, tenantId, pin),
    restores: pin.restores,
    changed_by: pin.changed_by,
    changed_at: pin.changed_at?.toISOString() ?? null,
  };
}

/** `until`: in the future, and no later than the event's end or 14 days ahead, whichever is later. */
async function untilInput(
  deps: PinDeps,
  request: FastifyRequest,
  value: unknown,
  nowMs: number,
): Promise<Date | null> {
  if (value === null || value === undefined) return null;
  const ms = typeof value === "string" ? Date.parse(value) : NaN;
  if (Number.isNaN(ms)) throw invalidRequest("`until` must be a date and time, or null.");
  if (ms <= nowMs) throw invalidRequest("`until` must be in the future.");
  const event = await deps.publicEvent?.(request.headers.host).catch(() => null);
  const ends = event?.ends_at ? Date.parse(event.ends_at) : NaN;
  const cap = Math.max(nowMs + DAYS_14_MS, Number.isNaN(ends) ? 0 : ends);
  if (ms > cap) {
    throw invalidRequest(
      "`until` may be no later than the event's end or 14 days ahead, whichever is later.",
    );
  }
  return new Date(ms);
}

async function valuesInput(
  deps: PinDeps,
  tenantId: string,
  input: Record<string, unknown>,
): Promise<PinValues> {
  if (!("bundle_version" in input) || !("theme_revision" in input)) {
    throw invalidRequest("`bundle_version` and `theme_revision` are required (null follows).");
  }
  const bundle = input.bundle_version;
  if (
    bundle !== null &&
    (typeof bundle !== "string" || !(await deps.bundles.available()).includes(bundle))
  ) {
    throw invalidRequest("`bundle_version` must be one of `available`, or null.");
  }
  const theme = input.theme_revision;
  if (theme !== null) {
    if (typeof theme !== "number" || !Number.isInteger(theme) || theme < 1) {
      throw invalidRequest("`theme_revision` must be a revision number, or null.");
    }
    if ((await deps.sources.themeRevision(tenantId, theme)) === null) {
      if ((await deps.sources.theme(tenantId)) === null) throw themingDown();
      throw invalidRequest(`The event's theme has no revision ${theme}.`);
    }
  }
  return { bundle_version: bundle, theme_revision: theme };
}

type Form =
  | { kind: "values"; values: PinValues; until: Date | null }
  | { kind: "freeze"; until: Date; current: number | null }
  | { kind: "unfreeze" };

async function formOf(deps: PinDeps, request: FastifyRequest, nowMs: number): Promise<Form> {
  const input = body(request);
  const tenantId = tenantOf(request).tenant_id;
  if (!("freeze" in input)) {
    onlyKeys(input, ["bundle_version", "theme_revision", "until", ...READ_ONLY], "pin");
    const values = await valuesInput(deps, tenantId, input);
    return { kind: "values", values, until: await untilInput(deps, request, input.until, nowMs) };
  }
  if (input.freeze === false) {
    onlyKeys(input, ["freeze"], "pin");
    return { kind: "unfreeze" };
  }
  if (input.freeze !== true) throw invalidRequest("`freeze` must be true or false.");
  onlyKeys(input, ["freeze", "until"], "pin");
  const until = await untilInput(deps, request, input.until, nowMs);
  if (until === null) throw invalidRequest("A freeze needs `until`.");
  // Read before the transaction, never inside it; used only when no revision is pinned already.
  const current = (await deps.sources.theme(tenantId).catch(() => null))?.revision ?? null;
  return { kind: "freeze", until, current };
}

/** The pin `form` makes of `before`, or null for a change that changes nothing. */
function nextPin(
  form: Form,
  before: PinRow,
  current: string,
): { next: PinRow; reason: PinReason } | null {
  const keeps = (until: Date | null): PinValues | null =>
    until === null
      ? null
      : (before.restores ?? {
          bundle_version: before.bundle_version,
          theme_revision: before.theme_revision,
        });
  if (form.kind === "unfreeze") {
    if (before.until === null || before.restores === null) return null;
    return {
      next: { ...before, ...before.restores, until: null, restores: null },
      reason: "cleared",
    };
  }
  if (form.kind === "freeze") {
    let theme = before.theme_revision;
    if (theme === null) {
      if (form.current === null) throw themingDown();
      // Revision 0 is no revision: only the bundle is held.
      theme = form.current === 0 ? null : form.current;
    }
    const values = { bundle_version: before.bundle_version ?? current, theme_revision: theme };
    return {
      next: { ...before, ...values, until: form.until, restores: keeps(form.until) },
      reason: "set",
    };
  }
  const none = form.values.bundle_version === null && form.values.theme_revision === null;
  return {
    next: { ...before, ...form.values, until: form.until, restores: keeps(form.until) },
    reason: none && form.until === null ? "cleared" : "set",
  };
}

export function pinRoutes(app: FastifyInstance, deps: PinDeps): void {
  const now = deps.now ?? Date.now;

  app.get(
    "/api/screen/pin",
    { preHandler: needsAny(deps.rights, PIN_READ_RIGHTS) },
    async (request) => {
      const tenantId = tenantOf(request).tenant_id;
      return pinView(deps, tenantId, await deps.db.tenant(readPin));
    },
  );

  app.put(
    "/api/screen/pin",
    { preHandler: needs(deps.rights, PIN_WRITE_RIGHT) },
    async (request) => {
      const ctx = tenantOf(request);
      assertWritable(ctx);
      const nowMs = now();
      const form = await formOf(deps, request, nowMs);
      const { pin, change } = await deps.db.tenant(async (c) => {
        const before = await lockPin(c);
        const step = nextPin(form, before, deps.bundles.current);
        if (step === null) return { pin: before, change: null };
        const next: PinRow = {
          ...step.next,
          changed_by: request.session?.userId ?? null,
          changed_by_name: request.session?.userName ?? null,
          changed_at: new Date(nowMs),
        };
        return { pin: next, change: await changePin(deps, c, before, next, step.reason) };
      });
      if (change !== null) await announcePin(deps, change, nowMs);
      return pinView(deps, ctx.tenant_id, pin);
    },
  );
}
