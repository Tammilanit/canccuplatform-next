// The Food pages' shots of scripts/demo-screenshots.mjs (group `pizza`; step 5 mockups 02–12 and
// 16–20): one order taken by the CI session from open to handed out, with the attendee's Food
// page, menu and order page and the holder's page at each step, at phone and desktop width (the
// guest's Food page too); the crew's Food page and the order's page; the money step (the total,
// a receipt read by CI's fake reader and confirmed, paid to the holder, and a member's view of
// it); pizzerias, a pizzeria, the menu CSV's preview and reading a menu photo; the daily record,
// one order's money and the export; Food settings and Integrations. The group has a shard of its
// own, so its orders never reach the screens of another group's shots (Moments' pizza stories).
// The order ends done.
import { randomBytes } from "node:crypto";
import { request } from "node:http";
import {
  DEMO_HOST,
  SCREEN,
  SESSION,
  expect,
} from "../modules/screen/test/stack/client.mjs";
import { roomReady } from "../modules/screen/test/stack/food.mjs";
import { DESK, PHONE, firstLine } from "./demo-screenshots-shot.mjs";

/** The demo pizzerias, when the stack has not loaded the event profile that holds them. */
const DEMO_MENU = [
  "pizzeria,phone,website,service,kind,number,name,description,price",
  'Demo Pizzeria,+000 000 0000,https://pizzeria.example,delivery,item,1,Margherita,"tomato, mozzarella",8.00',
  'Demo Pizzeria,,,,item,3,Pepperoni,"tomato, mozzarella, pepperoni",9.00',
  'Demo Pizzeria,,,,item,12,Kebab,"kebab, onion, chili",9.50',
  'Demo Pizzeria,,,,base,,Own pizza,"tomato, mozzarella",7.00',
  "Demo Pizzeria,,,,topping,,Ham,,1.00",
  "Demo Pizzeria,,,,topping,,Pineapple,,1.00",
  'Demo Trattoria,+000 000 0001,https://trattoria.example,takeaway,item,4,Margherita,"tomato, mozzarella",8.00',
  'Demo Trattoria,,,,item,7,Funghi,"mushroom, mozzarella",8.50',
  "",
].join("\n");

/** The import's preview shows changes: one price, one new item, one item the file leaves out. */
const CHANGED_MENU = [
  "pizzeria,kind,number,name,description,price",
  'Demo Pizzeria,item,1,Margherita,"tomato, mozzarella",8.50',
  'Demo Pizzeria,item,12,Kebab,"kebab, onion, chili",9.50',
  'Demo Pizzeria,item,22,Pizza bianca,"mozzarella, rosemary",9.00',
  "Demo Pizzeria,item,24,Calzone,folded,",
  "",
].join("\n");

const ORDER = "<order>";
const PIZZERIA = "<pizzeria>";
const RECEIPT = "<receipt>";
/**
 * A receipt photo for the fake reader, which answers mockup 18's receipt whatever it is sent: a
 * paper slip of lines, so the confirmed step's thumbnail shows a receipt, not a blank tile (#704).
 */
const RECEIPT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAANwAAAEsBAMAAABakcAfAAAACVBMVEX08eo6OjoaGhpRcC/1AAAACXBIWXMAAAsTAAALEwEAmpwYAAAAy0lEQVR4nO3VQQrDMAwEQH1BX8j/H1mKKT20SRPbNYkzcxcLi2AjAIBpLA3EKXMnr+JVpnkVACiyn9hB3E6hzKnLBIBi8NikuE/K/CbrxDXiAKBpgGrnKcUdFcqcsEwAKAYvTor7KZT5lF3ESeMAoOcAvcW27CzE9RPKHFYmABSDxybFrVDmrV4FAIrBi5PiXpS5LY+Iq8UBQMUAtc9TitsnlDl1mQAAAPex/E2cIA4AipYlqTgTt0aZhwrxmWsqvmv9zmcCAAAA5/AAuW8AxxeEzb8AAAAASUVORK5CYII=",
  "base64",
);
const GUEST = null;
/**
 * The order's other people (#704): Players 1–3 of the CI session stub (deploy/compose.ci.yml), each
 * with a pizza, so the money step shows who owes the holder; two are marked paid once it settles
 * to the holder, as mockup 19 C.
 */
const PLAYERS = [
  ["canccu_session=demo-player-1", "1"],
  ["canccu_session=demo-player-2", "1"],
  ["canccu_session=demo-player-3", "3"],
];
const PAID = ["u_demo_01", "u_demo_02"];
const HALL = { width: 1920, height: 1080 };
/** The main zone's screen, as Studio mirrors it (#643, mockup 14): the food box in its rail. */
const BOX = "/screen/zones/main";
/**
 * [name, path, viewport, step, cookie]: the step the order is at when the shot is taken, and who
 * looks (the CI session unless GUEST). The attendee's shots are named as attendee.browser.test.ts
 * walks the flow: the Food page, the menu, my order at each step.
 */
const LISTED = [
  // The hall's screen first at each step Moments shows (#775): Pizza order open plays its card for
  // 20 s, and Pizza is here, the `pizza` rule's announcement (#777), holds the hero three minutes
  // from the order's event, after any moment that holds it has had its floor.
  ["pizza-screen-food-open", BOX, HALL, "open"],
  ["pizza-food-phone", "/pizza/", PHONE, "open"],
  ["pizza-food-guest-phone", "/pizza/", PHONE, "open", GUEST],
  ["pizza-food-start-phone", "/pizza/start", PHONE, "open"],
  ["pizza-food-menu-phone", `/pizza/orders/${ORDER}/add`, PHONE, "open"],
  ["pizza-food-menu-filter-phone", `/pizza/orders/${ORDER}/add?q=kebab`, PHONE, "open"],
  ["pizza-food-own-pizza-phone", `/pizza/orders/${ORDER}/add?tab=own`, PHONE, "open"],
  ["pizza-food-other-phone", `/pizza/orders/${ORDER}/add?tab=other`, PHONE, "open"],
  ["pizza-food-added-phone", `/pizza/orders/${ORDER}?added=1`, PHONE, "open"],
  ["pizza-holder-checklist-phone", `/pizza/hold/${ORDER}`, PHONE, "open"],
  // #789: the holder's card (also on on-the-way, which this session holds), and the photo viewer.
  ["pizza-food-holder-card-open-phone", `/pizza/orders/${ORDER}`, PHONE, "open"],
  ["pizza-food-closed-phone", `/pizza/orders/${ORDER}`, PHONE, "closed"],
  ["pizza-holder-call-phone", `/pizza/hold/${ORDER}/call`, PHONE, "closed"],
  ["pizza-holder-called-in-phone", `/pizza/hold/${ORDER}/called-in`, PHONE, "closed"],
  ["pizza-holder-placed-phone", `/pizza/hold/${ORDER}`, PHONE, "placed"],
  ["pizza-food-on-the-way-phone", `/pizza/orders/${ORDER}`, PHONE, "placed"],
  ["pizza-screen-food-on-the-way", BOX, HALL, "placed"],
  ["pizza-holder-here-phone", `/pizza/hold/${ORDER}/here`, PHONE, "placed"],
  ["pizza-crew-phone", "/pizza/crew", PHONE, "placed"],
  ["pizza-crew-order-phone", `/pizza/crew/orders/${ORDER}`, PHONE, "placed"],
  // Mockups 18 and 19: the money step, with the AI reader on (CI's fake reader).
  ["pizza-holder-money-phone", `/pizza/hold/${ORDER}/money`, PHONE, "placed"],
  ["pizza-holder-money-scan-phone", `/pizza/hold/${ORDER}/money/scan`, PHONE, "placed"],
  ["pizza-holder-money-total-phone", `/pizza/hold/${ORDER}/money/total`, PHONE, "placed"],
  ["pizza-holder-money-check-phone", `/pizza/hold/${ORDER}/money/check?receipt=${RECEIPT}`, PHONE, "read"],
  ["pizza-holder-money-confirmed-phone", `/pizza/hold/${ORDER}/money`, PHONE, "confirmed"],
  ["pizza-holder-photo-viewer-phone", `/pizza/hold/${ORDER}/money`, PHONE, "confirmed"],
  ["pizza-holder-money-payer-phone", `/pizza/hold/${ORDER}/money`, PHONE, "payer"],
  // The plan's "Pay me with": what a member who still owes the holder sees on their order (#769).
  ["pizza-food-pay-phone", `/pizza/orders/${ORDER}`, PHONE, "payer", PLAYERS[2][0]],
  ["pizza-screen-food-here", BOX, HALL, "arrived"],
  ["pizza-food-here-phone", `/pizza/orders/${ORDER}`, PHONE, "arrived"],
  ["pizza-holder-hand-out-phone", `/pizza/hold/${ORDER}/hand-out`, PHONE, "arrived"],
  ["pizza-holder-done-phone", `/pizza/hold/${ORDER}/hand-out`, PHONE, "done"],
  ["pizza-food-done-phone", `/pizza/orders/${ORDER}`, PHONE, "done"],
  ["pizza-food-earlier-phone", "/pizza/", PHONE, "done"],
  ["pizza-pizzerias-phone", "/pizza/crew/pizzerias", PHONE, "done"],
  ["pizza-pizzeria-phone", `/pizza/crew/pizzerias/${PIZZERIA}`, PHONE, "done"],
  ["pizza-import-preview-phone", "/pizza/crew/pizzerias/import", PHONE, "done"],
  ["pizza-menu-read-phone", `/pizza/crew/pizzerias/${PIZZERIA}/read`, PHONE, "done"],
  ["pizza-settings-phone", "/pizza/crew/settings", PHONE, "done"],
  // Mockup 12: the daily record, one order's money and the export; mockup 20: Integrations.
  ["pizza-record-phone", "/pizza/crew/record", PHONE, "done"],
  ["pizza-record-order-phone", `/pizza/crew/record/${ORDER}`, PHONE, "done"],
  ["pizza-export-phone", "/pizza/crew/export", PHONE, "done"],
  ["pizza-integrations-phone", "/pizza/integrations", PHONE, "done"],
];
/** Every page at both widths (amendment 5): a phone shot not listed at desk width gets it next. */
const SHOTS = LISTED.flatMap((s) => {
  const desk = s[0].replace(/-phone$/, "");
  const twin = s[2] === PHONE && !LISTED.some((t) => t[0] === desk);
  return twin ? [s, [desk, s[1], DESK, ...s.slice(3)]] : [s];
});

export function pizzaListed(at) {
  return SHOTS.map(
    ([name, path, { width, height }]) =>
      `  ${name}.png  ${at(path)}  (${width}×${height}, the order ${path.includes(ORDER) ? "made for it" : "of the day"})`,
  );
}

/**
 * A pizza API call as the CI session (or `cookie`'s person) through Caddy (SCREEN is Caddy's
 * address here), each write with a fresh `Idempotency-Key`; a string body is the menu CSV, a
 * Buffer a PNG photo.
 */
function api(method, path, body, cookie = SESSION) {
  return new Promise((resolve, reject) => {
    const csv = typeof body === "string";
    const png = Buffer.isBuffer(body);
    const payload =
      body === undefined ? undefined : csv || png ? body : JSON.stringify(body);
    const req = request(
      {
        ...SCREEN,
        method,
        path,
        timeout: 10_000,
        headers: {
          host: DEMO_HOST,
          cookie,
          ...(method === "GET"
            ? {}
            : { "idempotency-key": randomBytes(12).toString("base64url") }),
          ...(payload === undefined
            ? {}
            : { "content-type": png ? "image/png" : csv ? "text/csv" : "application/json" }),
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (text += c));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            body: text ? JSON.parse(text) : null,
          }),
        );
      },
    );
    req.on("timeout", () =>
      req.destroy(new Error(`${method} ${path} timed out`)),
    );
    req.on("error", reject);
    req.end(payload);
  });
}

/** The demo pizzerias, imported unless the event profile brought them. */
async function pizzerias() {
  const listed = expect(await api("GET", "/api/pizza/pizzerias"), 200, "pizzerias");
  if (!listed.body.pizzerias.some((p) => p.name === "Demo Pizzeria")) {
    expect(
      await api("POST", "/api/pizza/menu/import", DEMO_MENU),
      200,
      "importing the demo menus",
    );
  }
  const again = expect(await api("GET", "/api/pizza/pizzerias"), 200, "pizzerias");
  return again.body.pizzerias.find((p) => p.name === "Demo Pizzeria").id;
}

/**
 * Ordering on: the demo profile has it off (events/demo/profile.yaml). Pizza follows admin's
 * settings.changed event, so the first order may still meet the old setting for a moment.
 */
async function orderingOpen() {
  const now = expect(
    await api("GET", "/api/admin/settings/pizza"),
    200,
    "the pizza settings",
  ).body;
  if (now.values.ordering_open === true) return;
  expect(
    await api("PUT", "/api/admin/settings/pizza", {
      settings_version: now.settings_version,
      values: { ...now.values, ordering_open: true },
    }),
    200,
    "turning ordering on",
  );
}

/**
 * Settling to the holder allowed and the AI reader on, with a key set in Integrations (CI's fake
 * reader never calls the provider), so the money step shows the reader's notice and its read.
 */
async function readerOn() {
  const now = expect(
    await api("GET", "/api/admin/settings/pizza"),
    200,
    "the pizza settings",
  ).body;
  expect(
    await api("PUT", "/api/admin/settings/pizza", {
      settings_version: now.settings_version,
      values: { ...now.values, settle_to_payer: true, ai_reader: true },
    }),
    200,
    "turning the AI reader on",
  );
  expect(
    await api("PUT", "/api/pizza/reader/key", { api_key: "sk-ant-demo-ci-not-a-key-wxyz" }),
    200,
    "setting the reader's key",
  );
}

async function openOrder(body) {
  for (let tries = 1; ; tries++) {
    const res = await api("POST", "/api/pizza/orders", body);
    const closed = res.status === 403 && res.body?.error?.code === "ordering_closed";
    if (!closed || tries === 20) return res;
    await new Promise((r) => setTimeout(r, 500));
  }
}

export async function pizzaShots({ shot, fail }) {
  let pz;
  let order;
  let receipt = "";
  try {
    await orderingOpen();
    await readerOn();
    // The screens' default zones (the main one shows the food box) exist once Studio reads them.
    expect(await api("GET", "/api/screen/zones"), 200, "the screens' zones");
    pz = await pizzerias();
    const menu = expect(await api("GET", `/api/pizza/pizzerias/${pz}`), 200, "the menu");
    const closes = new Date(Date.now() + 45 * 60_000).toISOString();
    order = expect(
      await openOrder({ pizzeria_id: pz, closes_at: closes }),
      201,
      "opening an order",
    ).body.id;
    for (const [number, note] of [
      ["12", "no onion"],
      ["12", "no onion"],
      ["1", null],
    ]) {
      const item = menu.body.menu.items.find((i) => i.number === number);
      expect(
        await api("POST", `/api/pizza/orders/${order}/items`, {
          kind: "menu",
          menu_item_id: item.id,
          ...(note === null ? {} : { note }),
        }),
        201,
        "adding a pizza",
      );
    }
    for (const [cookie, number] of PLAYERS) {
      const item = menu.body.menu.items.find((i) => i.number === number);
      expect(
        await api(
          "POST",
          `/api/pizza/orders/${order}/items`,
          { kind: "menu", menu_item_id: item.id },
          cookie,
        ),
        201,
        "adding a player's pizza",
      );
    }
  } catch (err) {
    fail(`pizza: the order for the shots: ${firstLine(err)}`);
    return;
  }
  // Each step through the API, as the holder takes it, before the shots of that step.
  const steps = {
    closed: () => api("POST", `/api/pizza/orders/${order}/close`),
    placed: () => api("POST", `/api/pizza/orders/${order}/place`, { estimate_minutes: 45 }),
    // The receipt's photo, read by the fake reader: the holder checks it (mockup 18 C).
    read: async () => {
      const added = await api("POST", `/api/pizza/orders/${order}/receipts`, RECEIPT_PNG);
      expect(added, 201, "adding the receipt");
      receipt = added.body.id;
      return api("POST", `/api/pizza/receipts/${receipt}/read`, {});
    },
    confirmed: () =>
      api("PATCH", `/api/pizza/orders/${order}/money`, { total_cents: 5450, receipt_id: receipt }),
    payer: async () => {
      expect(
        await api("PUT", "/api/pizza/me/pay-details", {
          mobilepay: "040 000 0000",
          iban: "FI21 1234 5600 0007 85",
        }),
        200,
        "Pay me with",
      );
      const settled = await api("PATCH", `/api/pizza/orders/${order}/money`, {
        settle_to: "payer",
      });
      for (const user of PAID) {
        expect(
          await api("PUT", `/api/pizza/orders/${order}/paid/${user}`, { paid: true }),
          200,
          "marking a player paid",
        );
      }
      return settled;
    },
    arrived: () =>
      api("POST", `/api/pizza/orders/${order}/arrive`, { pickup: "Entrance table" }),
    done: () => api("POST", `/api/pizza/orders/${order}/hand-out`),
  };
  let at = "open";
  for (const [name, path, viewport, step, cookie = SESSION] of SHOTS) {
    if (step !== at) {
      try {
        expect(await steps[step](), 200, `the order: ${step}`);
      } catch (err) {
        fail(`pizza: ${firstLine(err)}`);
        return;
      }
      at = step;
    }
    const preview = name.startsWith("pizza-import-preview");
    await shot(
      name,
      path.replace(ORDER, order).replace(PIZZERIA, pz).replace(RECEIPT, receipt),
      viewport,
      cookie,
      {
        touch: viewport === PHONE,
        // The read's sum and Confirm stay in view at the window's foot: shot as tall as the page,
        // so that footer sits under the lines, not over them.
        ...(name.startsWith("pizza-holder-money-check") ? { tall: true } : {}),
        // The attendee's pages keep their live stream open, so the network never goes idle.
        ...(name.startsWith("pizza-food")
          ? { ready: (page) => page.locator(".pizza-hub__main").waitFor() }
          : {}),
        // The screen draws the box once its state has the order: judged as every screen is.
        ...(path === BOX
          ? {
              fullPage: false,
              readable: true,
              ready: (page) => roomReady(page, step),
            }
          : {}),
        ...(name.startsWith("pizza-holder-photo-viewer")
          ? {
              fullPage: false,
              ready: (page) =>
                page.locator("a[data-viewer]").first().click().then(() => page.locator("dialog.pizza-viewer img").waitFor()),
            }
          : {}),
        ...(preview
          ? {
              // The preview is the answer to the import's form: the shot is of that page.
              ready: async (page) => {
                await page.locator("textarea[name=csv]").fill(CHANGED_MENU);
                await page.getByRole("button", { name: "Preview" }).click();
                // The change's row: the hidden CSV that Apply sends names the pizza too.
                await page.locator(".canccu-list__title", { hasText: "Pizza bianca" }).waitFor();
              },
            }
          : {}),
      },
    );
  }
}
