/**
 * A read that gave nothing, on the pages (#789 item 11): why, in a sentence, and the way forward
 * the PO agreed for each case: Try again (counting down by itself while the reader is busy, at
 * most twice), type the numbers by hand, retake the photo with the tips, or raise the day's cap.
 * Carried in the page's address after a redirect, so a reload never reads again; only the case is
 * taken from it, and the words are the page's own, except the reader's reason for an unreadable
 * photo, which is shown as text.
 */
import { attrs, html } from "@canccu/ui";
import { timeoutFor } from "../reader.js";
import type { Html } from "@canccu/ui";
import { SETTINGS_WRITE, backTo, formKey } from "./kit.js";
import type { ApiAnswer, PageCtx } from "./kit.js";
import type { MessageKey } from "./messages.js";

const CASES = [
  "reader_off",
  "reader_key_rejected",
  "out_of_credit",
  "reader_limit",
  "rate_limited",
  "service_down",
  "timeout",
  "unreadable",
  "declined",
  "failed",
  "file_too_large",
  "unsupported_media_type",
  "image_invalid",
  "upload_failed",
  "too_many_pages",
] as const;
type Case = (typeof CASES)[number];
const isCase = (v: unknown): v is Case => CASES.includes(v as Case);

const RETRY: ReadonlySet<Case> = new Set(["rate_limited", "service_down", "timeout", "failed"]);
const TOLD: ReadonlySet<Case> = new Set(["reader_key_rejected", "out_of_credit"]);
const TIPS: ReadonlySet<Case> = new Set(["unreadable", "image_invalid"]);
/** The page tries a busy reader again by itself this many times (D4); then Try again is a tap. */
const AUTO_TRIES = 2;

export interface ReadFailure {
  failed: Case;
  receipt: string | null;
  after: number | null;
  why: string | null;
  tries: number;
}

/**
 * What static/progress.js says while a receipt is sent and read, and how long the page waits:
 * the reader's own limit for one page and 10 s more (D4).
 */
export function progressAttrs(c: PageCtx): Record<string, string> {
  return {
    "data-progress": "",
    "data-sending": c.t("progress.sending"),
    "data-reading": c.t("progress.reading", { s: "{s}" }),
    "data-checking": c.t("progress.checking"),
    "data-lost": c.t("progress.lost"),
    "data-timeout": String(timeoutFor(1) + 10_000),
  };
}

/**
 * Where a failed API answer sends the page: back to `path` with the case and what Try again needs,
 * when it is a read failure the page knows; any other refusal (the order moved on, the event was
 * archived, no right) in the API's own words, since "Try again" would only fail the same way.
 */
export function failedTo(
  path: string,
  a: ApiAnswer,
  o: { receipt?: string; tries?: number } = {},
): string {
  const q = failureQuery(a, o);
  return q === null ? backTo(path, a) : backTo(`${path}?${q}`);
}

function failureQuery(a: ApiAnswer, o: { receipt?: string; tries?: number }): string | null {
  const e = (a.body.error ?? {}) as {
    code?: string;
    reason?: string;
    message?: string;
    retry_after_s?: number;
  };
  const named = e.code === "reader_failed" ? e.reason : e.code;
  const failed = isCase(named) ? named : a.status >= 500 ? "failed" : null;
  if (failed === null) return null;
  const q = new URLSearchParams({ failed });
  if (o.receipt !== undefined) q.set("receipt", o.receipt);
  if (typeof e.retry_after_s === "number") q.set("after", String(e.retry_after_s));
  if (failed === "unreadable" && typeof e.message === "string") q.set("why", e.message);
  if (o.tries !== undefined && o.tries > 0) q.set("tries", String(o.tries));
  return q.toString();
}

/** The failure a failed API answer is, for a page that shows it without a redirect; or null. */
export function failureFrom(a: ApiAnswer): ReadFailure | null {
  const q = failureQuery(a, {});
  return q === null ? null : failureOf(Object.fromEntries(new URLSearchParams(q)));
}

/** The failure a page's address names, or null. */
export function failureOf(q: Record<string, string | undefined>): ReadFailure | null {
  if (!isCase(q.failed)) return null;
  const after = Number(q.after);
  const tries = Number(q.tries);
  return {
    failed: q.failed,
    receipt: typeof q.receipt === "string" && /^pr_[\w-]{1,60}$/.test(q.receipt) ? q.receipt : null,
    after: Number.isInteger(after) && after > 0 && after <= 120 ? after : null,
    why: typeof q.why === "string" ? q.why.slice(0, 200) : null,
    tries: Number.isInteger(tries) && tries > 0 ? tries : 0,
  };
}

/**
 * Why and the ways on. `retry`: where Try again posts the kept photo to be read again (a receipt;
 * a menu's photos are not kept, so its form is the way); `type`: typing the numbers instead.
 */
export function readErrorView(
  c: PageCtx,
  f: ReadFailure,
  ways: { retry?: string; type?: string; typeLabel?: string },
): Html {
  const unreadable = f.failed === "unreadable" && f.why !== null && f.why !== "";
  const countdown =
    f.failed === "rate_limited" && f.after !== null && f.tries < AUTO_TRIES ? f.after : null;
  const retry =
    ways.retry !== undefined && f.receipt !== null && RETRY.has(f.failed)
      ? html`<form${attrs({
          method: "post",
          action: ways.retry,
          class: "pizza-inline",
          "data-countdown": countdown === null ? undefined : String(countdown),
          "data-countdown-text": c.t("readerr.countdown", { n: "{n}" }),
          ...progressAttrs(c),
        })}>
          ${formKey()}<input type="hidden" name="receipt_id" value="${f.receipt}" /><input
            type="hidden"
            name="tries"
            value="${f.tries + 1}"
          />
          <button class="canccu-button canccu-button--primary" type="submit">
            ${c.t("readerr.try_again")}
          </button>
          <span class="pizza-muted" data-countdown-note role="status"></span>
        </form>`
      : "";
  return html`<section class="canccu-notice canccu-notice--down pizza-read-error" role="alert">
    <p class="pizza-title">${c.t("readerr.title")}</p>
    <p>${unreadable ? f.why : c.t(`readerr.${f.failed}` as MessageKey)}</p>
    ${TOLD.has(f.failed) ? html`<p>${c.t("readerr.told")}</p>` : ""}
    ${
      f.failed === "reader_limit"
        ? html`<p>
            ${c.t("readerr.raise_cap")}
            ${
              c.session.rights.has(SETTINGS_WRITE)
                ? html`<a href="/pizza/crew/settings">${c.t("readerr.raise_cap_link")}</a>`
                : ""
            }
          </p>`
        : ""
    }
    ${f.receipt === null ? "" : html`<p class="pizza-muted">${c.t("readerr.kept")}</p>`}
    ${
      TIPS.has(f.failed)
        ? html`<p class="pizza-muted">${c.t("readerr.tips")}</p>
            <ul class="pizza-tips">
              <li>${c.t("readerr.tip_flat")}</li>
              <li>${c.t("readerr.tip_whole")}</li>
              <li>${c.t("readerr.tip_still")}</li>
            </ul>`
        : ""
    }
    <div class="pizza-read-error__ways">
      ${retry}
      ${
        ways.type === undefined
          ? ""
          : html`<a class="canccu-button canccu-button--secondary" href="${ways.type}"
              >${ways.typeLabel ?? c.t("readerr.type")}</a
            >`
      }
    </div>
  </section>`;
}
