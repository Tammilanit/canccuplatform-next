/**
 * A receipt read that gives nothing, on the holder's pages (#789 item 11, the table agreed with the
 * PO): each case says why in plain words and offers its way forward (try again, type by hand,
 * retake the photo, raise the cap), and a partly read receipt is not an error but the check page
 * with the unsure lines marked.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type pg from "pg";
import type { ReadReason } from "../src/reader.js";
import { DEFAULT_SETTINGS } from "../src/settings.js";
import {
  DATABASE_URL,
  TRUNCATE,
  freshDatabase,
  itemId,
  json,
  open,
  seedPizzerias,
  world,
} from "./helpers.js";
import type { World } from "./helpers.js";
import { form, upload, view } from "./forms.js";
import { bigJpeg, png } from "./images.js";

let pool: pg.Pool;
let w: World;
let id: string;
let pz: string;

beforeAll(async () => {
  if (DATABASE_URL) pool = await freshDatabase();
});
afterAll(async () => {
  if (DATABASE_URL) await pool.end();
});
beforeEach(async () => {
  if (!DATABASE_URL) return;
  await pool.query(TRUNCATE);
  w = await world(pool);
  ({ pz } = await seedPizzerias(w));
  id = json(await open(w, "pena", pz)).id as string;
  await w.call("anni", "POST", `/api/pizza/orders/${id}/items`, {
    kind: "menu",
    menu_item_id: await itemId(w, pz, "1"),
  });
  await w.call("pena", "POST", `/api/pizza/orders/${id}/place`, {});
  reader();
  await w.call("integrator", "PUT", "/api/pizza/reader/key", {
    api_key: "sk-ant-demo-key-0000wxyz",
  });
});

const reader = (more: Record<string, unknown> = {}) => {
  w.settings.set("demo", { ...DEFAULT_SETTINGS, ai_reader: true, ...more });
};
const location = (r: { headers: Record<string, unknown> }) => String(r.headers.location);
/** The page as read: its HTML with the apostrophes the template escapes put back. */
const page = async (url: string, who = "pena") =>
  (await view(w, who, url.replace(/^\/pizza/, ""))).body.replaceAll("&#39;", "'");
const scan = (bytes?: Buffer, type = "image/png") =>
  upload(w, "pena", `/hold/${id}/money/scan`, [
    { name: "receipt", type, bytes: bytes ?? Buffer.alloc(0) },
  ]);
/** The page a failed read lands on. */
const failing = async (fail: ReadReason | "rejected") => {
  w.reader.fail = fail;
  const r = await scan(await png());
  expect(location(r)).toMatch(new RegExp(`^/pizza/hold/${id}/money/scan\\?failed=`));
  return { url: location(r), body: await page(location(r)) };
};
const typeLink = () => `href="/pizza/hold/${id}/money/total"`;
const tryAgain = (body: string) =>
  /<form[^>]*action="\/pizza\/hold\/[^"]*\/money\/read"[\s\S]*?Try again/.test(body);

describe.skipIf(!DATABASE_URL)("a failed receipt read on the holder's pages", () => {
  it("says the key was refused and the organisers told; typing goes on", async () => {
    const { body } = await failing("rejected");
    expect(body).toContain("The reader's key was refused");
    expect(body).toContain("The organisers have been told");
    expect(body).toContain(typeLink());
    expect(tryAgain(body)).toBe(false);
  });

  it("says the account is out of credit and the organisers told", async () => {
    const { body } = await failing("out_of_credit");
    expect(body).toContain("out of credit or over its limit");
    expect(body).toContain("The organisers have been told");
    expect(body).toContain(typeLink());
  });

  it("says the day's reads are used up, and where the crew raises the cap", async () => {
    reader({ ai_reader_daily_reads: 1 });
    await scan(await png());
    const r = await scan(await png());
    expect(location(r)).toContain("failed=reader_limit");
    const holder = await page(location(r));
    expect(holder).toContain("Today's reads are used up");
    expect(holder).toContain("The crew can raise the cap");
    expect(holder).not.toContain('href="/pizza/crew/settings"');
    expect(await page(location(r), "organiser")).toContain('href="/pizza/crew/settings"');
  });

  it("says the service is down, with Try again and typing", async () => {
    const { body } = await failing("service_down");
    expect(body).toContain("The reader's service is down");
    expect(tryAgain(body)).toBe(true);
    expect(body).toContain(typeLink());
  });

  it("says the reader did not answer, with Try again and typing", async () => {
    const { body } = await failing("failed");
    expect(body).toContain("The reader did not answer");
    expect(tryAgain(body)).toBe(true);
    expect(body).toContain(typeLink());
  });

  it("says the reader took too long, with Try again", async () => {
    const { body } = await failing("timeout");
    expect(body).toContain("The reader took too long");
    expect(tryAgain(body)).toBe(true);
  });

  it("gives the reader's own reason for a photo it could not read, and photo tips", async () => {
    const { body } = await failing("unreadable");
    expect(body).toContain(w.reader.unreadableReason);
    expect(body).toContain("Lay the receipt flat");
    expect(body).toContain("Take a photo of the receipt");
    expect(body).toContain(typeLink());
  });

  it("says the reader would not read it, and offers typing only", async () => {
    const { body } = await failing("declined");
    expect(body).toContain("The reader would not read this photo");
    expect(body).toContain(typeLink());
    expect(tryAgain(body)).toBe(false);
  });

  it("counts down and tries again by itself when the reader is busy", async () => {
    w.reader.retryAfterS = 7;
    const { body } = await failing("rate_limited");
    expect(body).toContain("The reader is busy");
    expect(body).toContain('data-countdown="7"');
    expect(tryAgain(body)).toBe(true);
  });

  it("reads the kept photo again with Try again, and lands on the check", async () => {
    const { url } = await failing("service_down");
    const receipt = new URL(url, "http://x").searchParams.get("receipt") ?? "";
    expect(receipt).toMatch(/^pr_/);
    w.reader.fail = null;
    const r = await form(w, "pena", `/hold/${id}/money/read`, { receipt_id: receipt });
    expect(location(r)).toBe(`/pizza/hold/${id}/money/check?receipt=${receipt}`);
    expect(
      (json(await w.call("pena", "GET", `/api/pizza/orders/${id}/money`)).receipts as unknown[])
        .length,
    ).toBe(1);
  });

  it("says the reader is off when it was turned off meanwhile, and typing goes on", async () => {
    const { url } = await failing("service_down");
    const receipt = new URL(url, "http://x").searchParams.get("receipt") ?? "";
    w.settings.set("demo", DEFAULT_SETTINGS);
    const r = await form(w, "pena", `/hold/${id}/money/read`, { receipt_id: receipt });
    expect(location(r)).toContain("failed=reader_off");
    const body = await page(location(r));
    expect(body).toContain("The reader is off here");
    expect(body).toContain(typeLink());
  });

  it("gives a read's other refusal in its own words, not as a photo that did not arrive", async () => {
    const { url } = await failing("service_down");
    const receipt = new URL(url, "http://x").searchParams.get("receipt") ?? "";
    w.reader.fail = null;
    // The order moved on meanwhile: called in no more, so the read answers 409 `not_placed`.
    await w.call("pena", "POST", `/api/pizza/orders/${id}/undo`, {});
    const r = await form(w, "pena", `/hold/${id}/money/read`, { receipt_id: receipt });
    const said = encodeURIComponent("The order is not called in yet.");
    expect(location(r)).toBe(`/pizza/hold/${id}/money/scan?error=${said}`);
    // The scan page is no longer the order's step: it hands the refusal on to the order.
    const on = await view(w, "pena", location(r).replace(/^\/pizza/, ""));
    expect(location(on)).toBe(`/pizza/hold/${id}?error=${said}`);
    const body = await page(location(on));
    expect(body).toContain("The order is not called in yet.");
    expect(body).not.toContain("did not arrive");
  });

  it("says a photo over 30 MB is too large, and offers the camera again", async () => {
    const r = await scan(await bigJpeg(31 * 1024 * 1024), "image/jpeg");
    expect(location(r)).toContain("failed=file_too_large");
    const body = await page(location(r));
    expect(body).toContain("at most 30 MB");
    expect(body).toContain("Take a photo of the receipt");
  });

  it("says a file that is not a photo is the wrong type", async () => {
    const r = await scan(Buffer.from("GIF89a"), "image/gif");
    expect(location(r)).toContain("failed=unsupported_media_type");
    expect(await page(location(r))).toContain("Send a JPEG, PNG or WebP photo");
  });

  it("shows a partly read receipt as the check, its unsure lines marked", async () => {
    w.reader.receipt = {
      total_cents: 850,
      lines: [
        {
          text: "1 x 1 Margherita 8.50",
          number: "1",
          name: "Margherita",
          quantity: 1,
          amount_cents: 850,
          kind: "item",
          unsure: true,
        },
      ],
    };
    const r = await scan(await png());
    expect(location(r)).toMatch(/\/money\/check\?receipt=/);
    const body = await page(location(r));
    expect(body).toContain("pizza-unsure");
    expect(body).toContain("Unsure: check it on the photo");
  });
});

describe.skipIf(!DATABASE_URL)("a failed menu read on the crew's pages", () => {
  it("says why, keeps the photos form, and offers typing the menu", async () => {
    w.reader.fail = "service_down";
    const r = await upload(w, "menus", `/crew/pizzerias/${pz}/read`, [
      { name: "menu.png", type: "image/png", bytes: await png() },
    ]);
    expect(location(r)).toMatch(
      new RegExp(`^/pizza/crew/pizzerias/${pz}/read\\?failed=service_down`),
    );
    const body = await page(location(r), "menus");
    expect(body).toContain("The reader's service is down");
    expect(body).toContain(`href="/pizza/crew/pizzerias/${pz}"`);
    expect(body).toContain('type="file"');
  });
});
