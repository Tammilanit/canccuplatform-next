/**
 * Admin → Integrations (`/pizza/integrations`, mockup 20; `admin.integrations.write`): the AI
 * reader's provider key, set, replaced and revoked. The key goes in once and is never shown again:
 * the page has only its last four characters, who set it and when, its last use and the month's
 * reads. Served by pizza, the reader's only user, in the organiser shell's Admin group.
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

function view(c: PageCtx, k: KeyStatus, error?: string): Html {
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
    </section>`;
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
    return organiserPage(request, reply, deps, c, {
      title: c.t("integrations.title"),
      current: "integrations",
      narrow: true,
      body: view(c, k, request.query.error),
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
