/**
 * Admin → Integrations (`/pizza/integrations`, mockup 20; `admin.integrations.write`): the AI
 * reader's provider key, set, replaced and revoked. The key goes in once and is never shown again:
 * the page has only its last four characters, who set it and when, its last use and the month's
 * reads. Served by pizza, the reader's only user, in the organiser shell's Admin group. Below the
 * key, the month's read log (#789 item 12): each read, its outcome and cost, and the month's total
 * against the account's limit, warned of from 80 %, so nobody waits for the provider's Console.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { KitError } from "@canccu/kit";
import { html, notice } from "@canccu/ui";
import type { Html } from "@canccu/ui";
import type { AppDeps } from "../http.js";
import { INTEGRATIONS_WRITE } from "../policy.js";
import { PROVIDER } from "../reader.js";
import { PREFIX, back, formKey, formText, must, organiserPage, pageCtx, viaApi } from "./kit.js";
import type { PageCtx } from "./kit.js";
import { flash } from "./order-view.js";
import type { MessageKey } from "./messages.js";

interface KeyStatus {
  provider: string;
  model: string;
  set: boolean;
  last4: string | null;
  set_by: { name: string | null } | null;
  set_at: string | null;
  last_used_at: string | null;
  rejected: boolean;
  reads_this_month: number;
}

const date = (c: PageCtx, iso: string | null) =>
  iso === null
    ? ""
    : new Intl.DateTimeFormat(c.lang === "fi" ? "fi-FI" : "en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: c.zone,
      }).format(new Date(iso));

interface ReadLog {
  reads: {
    at: string;
    kind: string;
    pages: number;
    outcome: string;
    reason: string | null;
    input_tokens: number | null;
    output_tokens: number | null;
    cost_micro_usd: number;
  }[];
  totals: { reads: number; cost_micro_usd: number; limit_micro_usd: number | null };
}

/** The share of the limit from which the page warns (D23). */
const WARN_AT = 0.8;

/** Dollars from micro-dollars: a cent's fraction shows to the tenth of a cent's tenth. */
function usd(c: PageCtx, micro: number): string {
  const small = micro > 0 && micro < 10_000;
  return new Intl.NumberFormat(c.lang === "fi" ? "fi-FI" : "en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: small ? 4 : 2,
    maximumFractionDigits: small ? 4 : 2,
  }).format(micro / 1_000_000);
}

function logView(c: PageCtx, log: ReadLog): Html {
  const t = log.totals;
  const total =
    t.reads === 1
      ? c.t("reads.total_one", { cost: usd(c, t.cost_micro_usd) })
      : c.t("reads.total", { n: t.reads, cost: usd(c, t.cost_micro_usd) });
  const near = t.limit_micro_usd !== null && t.cost_micro_usd >= WARN_AT * t.limit_micro_usd;
  const count = new Intl.NumberFormat(c.lang === "fi" ? "fi-FI" : "en-US");
  return html`<section class="pizza-part pizza-stack pizza-reads">
    <h2 class="pizza-part__title">${c.t("reads.title")}</h2>
    <p class="pizza-title">${total}</p>
    ${
      t.limit_micro_usd === null
        ? ""
        : html`<p class="${near ? "pizza-warn" : "pizza-muted"}">
            ${c.t("reads.of_limit", {
              cost: usd(c, t.cost_micro_usd),
              limit: usd(c, t.limit_micro_usd),
            })}
          </p>`
    }
    ${near ? notice({ kind: "warn", title: c.t("reads.near_limit") }) : ""}
    ${
      log.reads.length === 0
        ? html`<p class="canccu-muted">${c.t("reads.none")}</p>`
        : html`<ul class="pizza-people pizza-list">
            ${log.reads.map(
              (r) =>
                html`<li class="pizza-person">
                  <span class="pizza-person__text"
                    ><span class="pizza-person__name"
                      >${r.kind === "menu" ? c.t("reads.menu", { n: r.pages }) : c.t("reads.receipt")}
                      · ${c.t(`reads.${r.outcome}` as MessageKey)}</span
                    ><span class="pizza-person__what"
                      >${date(c, r.at)}${
                        r.input_tokens === null
                          ? ""
                          : ` · ${c.t("reads.tokens_n", {
                              n: count.format(r.input_tokens + (r.output_tokens ?? 0)),
                            })}`
                      }${r.reason === null ? "" : ` · ${r.reason}`}</span
                    ></span
                  ><span class="pizza-amount canccu-num">${usd(c, r.cost_micro_usd)}</span>
                </li>`,
            )}
          </ul>`
    }
  </section>`;
}

function view(c: PageCtx, k: KeyStatus, log: ReadLog, error?: string): Html {
  return html`${flash(error)}
    <section class="pizza-part pizza-stack pizza-key">
      <h2 class="pizza-part__title">${c.t("integrations.reader")}</h2>
      <p class="canccu-muted">${PROVIDER.name} · ${PROVIDER.model}</p>
      <p>${c.t("integrations.reader_text")}</p>
      ${
        k.rejected
          ? notice({
              kind: "down",
              title: c.t("integrations.rejected", { provider: PROVIDER.name }),
            })
          : ""
      }
      ${
        k.set
          ? html`<p class="pizza-title">
                ${c.t("integrations.key_ending", { last_four: k.last4 ?? "" })}
              </p>
              <p class="canccu-muted">
                ${c.t("integrations.set_by", { name: k.set_by?.name ?? "—", date: date(c, k.set_at) })}
              </p>
              <p class="canccu-muted">
                ${
                  k.last_used_at === null
                    ? c.t("integrations.never_used")
                    : c.t("integrations.last_used", { date: date(c, k.last_used_at) })
                }
                ·
                ${
                  k.reads_this_month === 1
                    ? c.t("integrations.read_one")
                    : c.t("integrations.reads", { n: k.reads_this_month })
                }
              </p>`
          : html`<p class="pizza-title">${c.t("integrations.not_set")}</p>`
      }
      <form method="post" action="${PREFIX}integrations/key" class="pizza-form">
        ${formKey()}
        <label class="canccu-field"
          ><span class="canccu-field__label">${c.t("integrations.key")}</span
          ><input
            class="canccu-input"
            type="password"
            name="api_key"
            autocomplete="off"
            spellcheck="false"
            required
        /></label>
        <p class="canccu-muted canccu-small">${c.t("integrations.kept")}</p>
        <button class="canccu-button canccu-button--primary" type="submit">
          ${c.t(k.set ? "integrations.replace" : "integrations.set")}
        </button>
      </form>
      ${
        k.set
          ? html`<form method="post" action="${PREFIX}integrations/revoke" class="pizza-form">
              ${formKey()}
              <p class="canccu-muted canccu-small">${c.t("integrations.revoke_text")}</p>
              <button class="canccu-button canccu-button--danger" type="submit">
                ${c.t("integrations.revoke")}
              </button>
            </form>`
          : ""
      }
      <p class="canccu-muted canccu-small">
        <a href="${PREFIX}crew/settings">${c.t("integrations.off")}</a>
      </p>
    </section>
    ${logView(c, log)}`;
}

export function integrationsPages(app: FastifyInstance, deps: AppDeps): void {
  const admin = async (request: FastifyRequest) => {
    const c = await pageCtx(deps, request);
    if (!c.session.rights.has(INTEGRATIONS_WRITE))
      throw new KitError(`needs right ${INTEGRATIONS_WRITE}`, {
        status: 403,
        code: "missing_right",
      });
    return c;
  };

  app.get<{ Querystring: { error?: string } }>("/integrations", async (request, reply) => {
    const c = await admin(request);
    const k = must(
      await viaApi(app, request, "GET", "/api/pizza/reader/key"),
    ) as unknown as KeyStatus;
    const log = must(
      await viaApi(app, request, "GET", "/api/pizza/reader/reads"),
    ) as unknown as ReadLog;
    return organiserPage(request, reply, deps, c, {
      title: c.t("integrations.title"),
      description: c.t("about.integrations"),
      current: "integrations",
      narrow: true,
      body: view(c, k, log, request.query.error),
    });
  });

  app.post("/integrations/key", async (request, reply) => {
    await admin(request);
    const a = await viaApi(app, request, "PUT", "/api/pizza/reader/key", {
      api_key: formText(request, "api_key") ?? "",
    });
    return back(reply, "integrations", a);
  });

  app.post("/integrations/revoke", async (request, reply) => {
    await admin(request);
    const a = await viaApi(app, request, "DELETE", "/api/pizza/reader/key");
    return back(reply, "integrations", a);
  });
}
