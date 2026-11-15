// Runs shell.js and health.js against a small stand-in for the page (test_health_scripts.py):
// after each Health swap the menu note is read again, and two note reads are never open at once.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const [shellJs, healthJs] = process.argv.slice(2);
const timers = [];
const pending = [];
const fetched = [];

function element(tag) {
  return { tag, textContent: "", className: "", remove() {} };
}

const item = {
  badge: null,
  querySelector() {
    return this.badge;
  },
  append(badge) {
    badge.remove = () => {
      this.badge = null;
    };
    this.badge = badge;
  },
};

const page = new EventTarget();
Object.assign(page, {
  visibilityState: "visible",
  querySelector: (sel) => (sel.includes("health-view") ? item : null),
  querySelectorAll: () => [],
  createElement: (tag) =>
    tag === "template"
      ? { innerHTML: "", content: { querySelector: () => null } }
      : element(tag),
});
globalThis.document = page;
globalThis.window = { addEventListener() {} };
Object.defineProperty(globalThis, "navigator", {
  value: {},
  configurable: true,
});
globalThis.getSelection = () => null;
globalThis.setInterval = (fn) => timers.push(fn);
globalThis.clearInterval = () => {};
// Each fetch waits until the test answers it, so reads can be held open.
globalThis.fetch = (url) =>
  new Promise((resolve) => {
    fetched.push(url);
    pending.push({ url, resolve });
  });

const settle = () => new Promise((r) => setTimeout(r, 0));
function answer(url, body) {
  const at = pending.findIndex((p) => p.url === url);
  const [{ resolve }] = pending.splice(at, 1);
  resolve({
    ok: true,
    redirected: false,
    json: async () => body,
    text: async () => String(body),
  });
}
const NOTE = "/api/admin/health/note";
const notes = () => fetched.filter((u) => u === NOTE).length;

await import(pathToFileURL(shellJs));
await import(pathToFileURL(healthJs));
const [noteTick, healthTick] = timers;

// The note's first read is open: its tick does not start a second one.
assert.equal(notes(), 1);
noteTick();
assert.equal(notes(), 1);

// The Health page swaps in a newer check while that read is open: the note is read again once it
// answers, so the older answer never stays drawn.
healthTick();
await settle();
answer("/admin/health-view/live", "<p>tiles</p>");
await settle();
assert.equal(notes(), 1);
answer(NOTE, { status: "ok", text: "" });
await settle();
assert.equal(notes(), 2);
answer(NOTE, { status: "down", text: "1 down" });
await settle();
assert.equal(item.badge?.textContent, "1 down");

// With no read open, a swap reads the note at once.
healthTick();
await settle();
answer("/admin/health-view/live", "<p>tiles</p>");
await settle();
assert.equal(notes(), 3);
answer(NOTE, { status: "ok", text: "" });
await settle();
assert.equal(item.badge, null);
console.log("ok");
