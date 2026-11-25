/*
 * The Devices page's pairing (#190, #783), on studio.js's helpers: by the button, or by the kiosk's
 * QR, whose code rides in the fragment. The fragment is cleared once read, so the code stays out of
 * the history (contracts/screen.md, Pairing); a signed-out scan went through sign-in, which drops
 * the fragment, so studio-signin.js kept the code. Every refusal is said in the dialog itself, in
 * plain words with what to do, and a done pair opens the page on the new screen's live panel.
 */

const PAIR_KEY = "canccu-studio-pair";

/** The message key for a refused pair, or null for one the server's own words say best. */
export function pairErrorKey(r) {
  if (r.status === 0) return "pair.error.offline";
  const code = r.data?.error?.code;
  if (code === "code_invalid") return "pair.error.code";
  if (code === "invalid_request" && /`code`/.test(r.data?.error?.message ?? "")) {
    return "pair.error.format";
  }
  if (code === "no_venue") return "pair.error.no_venue";
  if (code === "unknown_zone") return "pair.error.zone";
  return null;
}

/** The code as typed or scanned: letters and digits only, upper case. */
export const cleanCode = (value) =>
  String(value)
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();

/** Wires the page; `doc`, `win` and `helpers` are the page's own outside tests. */
export function pairing(doc, win, helpers) {
  const { api, failure, reloadWith, say } = helpers;
  // The kiosk's cookies are `Secure`: over plain http no screen can pair here.
  if (!win.isSecureContext) {
    for (const node of doc.querySelectorAll("[data-insecure]")) node.hidden = false;
  }
  const dialog = doc.getElementById("canccu-studio-pair");
  const kept = win.sessionStorage.getItem(PAIR_KEY);
  win.sessionStorage.removeItem(PAIR_KEY);
  if (!dialog) return;
  const form = dialog.querySelector("form");
  const error = dialog.querySelector("[data-pair-error]");
  const tell = (message) => {
    error.textContent = message;
    error.hidden = message === "";
  };
  const open = (code) => {
    tell("");
    form.elements.code.value = code;
    dialog.showModal();
    form.elements[code ? "name" : "code"].focus();
  };
  doc.querySelector("[data-open-pair]")?.addEventListener("click", () => open(""));
  dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
  if (win.location.hash.startsWith("#pair=")) {
    const code = cleanCode(decodeURIComponent(win.location.hash.slice(6)));
    win.history.replaceState(null, "", win.location.pathname + win.location.search);
    open(code);
  } else if (kept) open(kept);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const f = new FormData(form);
    const name = String(f.get("name")).trim();
    const body = {
      code: cleanCode(f.get("code")),
      name,
      ...(f.get("zone_key") ? { zone_key: f.get("zone_key") } : {}),
    };
    tell("");
    const r = await api("POST", "/api/screen/devices", body);
    if (!r.ok) {
      const key = pairErrorKey(r);
      tell(key === null ? failure(r) : say(key));
      if (key === "pair.error.code" || key === "pair.error.format") form.elements.code.focus();
      return;
    }
    const next = `${win.location.pathname}?paired=${encodeURIComponent(r.data.id)}`;
    reloadWith(say("pair.done", { device: name }), next);
  });
}

if (typeof window !== "undefined" && window.canccuStudio) {
  pairing(document, window, window.canccuStudio);
}
