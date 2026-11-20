// The Food pages' shots of scripts/demo-screenshots.mjs (group `pizza`; step 5 mockups 07–11 and
// 17): one order taken by the CI session from open to handed out, with the holder's page at each
// step on a phone; the crew's Food page and the order's page; pizzerias, a pizzeria and the menu
// CSV's preview; Food settings. The group has a shard of its own, so its orders never reach the
// screens of another group's shots (Moments' pizza stories). The order ends done.
import { randomBytes } from "node:crypto";
import { request } from "node:http";
import {
  DEMO_HOST,
  SCREEN,
  SESSION,
  expect,
} from "../modules/screen/test/stack/client.mjs";
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
/** [name, path, viewport, step]: the step the order is at when the shot is taken. */
const SHOTS = [
  ["pizza-holder-checklist-phone", `/pizza/hold/${ORDER}`, PHONE, "open"],
  ["pizza-holder-call-phone", `/pizza/hold/${ORDER}/call`, PHONE, "closed"],
  ["pizza-holder-called-in-phone", `/pizza/hold/${ORDER}/called-in`, PHONE, "closed"],
  ["pizza-holder-placed-phone", `/pizza/hold/${ORDER}`, PHONE, "placed"],
  ["pizza-holder-here-phone", `/pizza/hold/${ORDER}/here`, PHONE, "placed"],
  ["pizza-crew", "/pizza/crew", DESK, "placed"],
  ["pizza-crew-phone", "/pizza/crew", PHONE, "placed"],
  ["pizza-crew-order", `/pizza/crew/orders/${ORDER}`, DESK, "placed"],
  ["pizza-crew-order-phone", `/pizza/crew/orders/${ORDER}`, PHONE, "placed"],
  ["pizza-holder-hand-out-phone", `/pizza/hold/${ORDER}/hand-out`, PHONE, "arrived"],
  ["pizza-holder-done-phone", `/pizza/hold/${ORDER}/hand-out`, PHONE, "done"],
  ["pizza-pizzerias", "/pizza/crew/pizzerias", DESK, "done"],
  ["pizza-pizzerias-phone", "/pizza/crew/pizzerias", PHONE, "done"],
  ["pizza-pizzeria", `/pizza/crew/pizzerias/${PIZZERIA}`, DESK, "done"],
  ["pizza-pizzeria-phone", `/pizza/crew/pizzerias/${PIZZERIA}`, PHONE, "done"],
  ["pizza-import-preview", "/pizza/crew/pizzerias/import", DESK, "done"],
  ["pizza-import-preview-phone", "/pizza/crew/pizzerias/import", PHONE, "done"],
  ["pizza-settings", "/pizza/crew/settings", DESK, "done"],
  ["pizza-settings-phone", "/pizza/crew/settings", PHONE, "done"],
];

export function pizzaListed(at) {
  return SHOTS.map(
    ([name, path, { width, height }]) =>
      `  ${name}.png  ${at(path)}  (${width}×${height}, the order ${path.includes(ORDER) ? "made for it" : "of the day"})`,
  );
}

/**
 * A pizza API call as the CI session through Caddy (SCREEN is Caddy's address here), each write
 * with a fresh `Idempotency-Key`; a string body is the menu CSV.
 */
function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const csv = typeof body === "string";
    const payload = body === undefined ? undefined : csv ? body : JSON.stringify(body);
    const req = request(
      {
        ...SCREEN,
        method,
        path,
        timeout: 10_000,
        headers: {
          host: DEMO_HOST,
          cookie: SESSION,
          ...(method === "GET"
            ? {}
            : { "idempotency-key": randomBytes(12).toString("base64url") }),
          ...(payload === undefined
            ? {}
            : { "content-type": csv ? "text/csv" : "application/json" }),
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

export async function pizzaShots({ shot, fail }) {
  let pz;
  let order;
  try {
    pz = await pizzerias();
    const menu = expect(await api("GET", `/api/pizza/pizzerias/${pz}`), 200, "the menu");
    const closes = new Date(Date.now() + 45 * 60_000).toISOString();
    order = expect(
      await api("POST", "/api/pizza/orders", { pizzeria_id: pz, closes_at: closes }),
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
  } catch (err) {
    fail(`pizza: the order for the shots: ${firstLine(err)}`);
    return;
  }
  // Each step through the API, as the holder takes it, before the shots of that step.
  const steps = {
    closed: () => api("POST", `/api/pizza/orders/${order}/close`),
    placed: () => api("POST", `/api/pizza/orders/${order}/place`, { estimate_minutes: 45 }),
    arrived: () =>
      api("POST", `/api/pizza/orders/${order}/arrive`, { pickup: "Entrance table" }),
    done: () => api("POST", `/api/pizza/orders/${order}/hand-out`),
  };
  let at = "open";
  for (const [name, path, viewport, step] of SHOTS) {
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
      path.replace(ORDER, order).replace(PIZZERIA, pz),
      viewport,
      SESSION,
      {
        touch: viewport === PHONE,
        ...(preview
          ? {
              // The preview is the answer to the import's form: the shot is of that page.
              ready: async (page) => {
                await page.locator("textarea[name=csv]").fill(CHANGED_MENU);
                await page.getByRole("button", { name: "Preview" }).click();
                await page.getByText("Pizza bianca").waitFor();
              },
            }
          : {}),
      },
    );
  }
}
