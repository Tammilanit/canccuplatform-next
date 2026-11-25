// The frames a screen draws before any theme reaches it (screens.mjs): a new screen's pairing
// frame, the plain-http frame (#783), and the player's answers to the device answers of
// contracts/screen.md, each handed to the page, so the frame is the real one.
import { expect } from "./client.mjs";
import { nameOf } from "./screen-views.mjs";
import { expiryLast } from "./screen-waits.mjs";

/** The frames drawn before a theme: a new screen, and the device answers of contracts/screen.md. */
export async function untouched({ demo, open, at, shot, cookie }, view, size) {
  const answers = {
    refused: [403, { error: { code: "venue_ip_refused", message: "not at the venue" } }],
    moved: [409, { error: { code: "device_moved", message: "moved" } }],
    unreachable: [503, { error: { code: "unavailable", message: "down" } }],
  };
  // The loopback holds 3 open pairing codes at most (contracts/screen.md, Pairing), and each
  // pairing frame leaves one.
  if (view === "pairing")
    expect(await demo.call("DELETE", "/api/screen/pairing"), 204, "clearing open pairing codes");
  const fresh = view === "pairing" || view === "insecure";
  const { page, close } = await open(size, fresh ? null : cookie);
  // Plain http, as the browser reports it there (#783): the stack itself is a secure context.
  if (view === "insecure")
    await page.addInitScript(() =>
      Object.defineProperty(window, "isSecureContext", { get: () => false }),
    );
  if (view in answers) {
    const [status, json] = answers[view];
    await page.route("**/api/screen/device/state", (route) => route.fulfill({ status, json }));
    await page.route("**/api/screen/device/home", (route) =>
      route.fulfill({ json: { url: "https://next-event.example/screen/" } }),
    );
  }
  await page.goto(at(view === "check" ? "/screen/check" : "/screen/"));
  const ready = {
    pairing: ".canccu-pairing-code",
    check: ".canccu-selfcheck__row",
    unreachable: ".canccu-frame__foot:not(:empty)",
  };
  await page.waitForSelector(ready[view] ?? `.canccu-frame--${view}`);
  await page.waitForTimeout(300);
  if (view === "pairing") await expiryLast(page);
  await shot(nameOf("default", view, size), page);
  await close();
}
