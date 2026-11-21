// Runs settings.js against a small stand-in for the Settings form (test_settings_controls.py):
// a quick pick and a stepper set their number, ticked chips count as a change and Undo puts them
// back, a link's preview follows what is typed, and this device's time zone joins Suggested.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const [settingsJs] = process.argv.slice(2);

const page = new EventTarget();
const byId = {};
const selected = {};
let form = null;
let zoneSelects = [];
page.getElementById = (id) => byId[id] ?? null;
page.querySelector = (sel) => selected[sel] ?? (sel.startsWith("form") ? form : null);
page.querySelectorAll = (sel) =>
  sel === "select[data-canccu-zones]" ? zoneSelects : [];
page.createElement = (tag) => ({ tag, value: "", textContent: "" });

globalThis.document = page;
globalThis.matchMedia = () => ({ matches: false });
globalThis.addEventListener = () => {};
globalThis.location = { pathname: "/admin/settings/screen" };

// A field around a control, with its "Was" line.
function field(control) {
  const hint = { hidden: true };
  const preview = { hidden: true, href: "", textContent: "" };
  const box = {
    hint,
    preview,
    querySelector: (sel) =>
      ({ "[data-canccu-was-hint]": hint, "[data-canccu-preview]": preview })[sel] ?? null,
  };
  control.closest = (sel) => (sel === ".canccu-field" ? box : null);
  return box;
}

function number(id, value) {
  const input = {
    id,
    type: "number",
    value,
    step: 1,
    dataset: { canccuWas: value },
    validity: {},
    checkValidity: () => true,
    removeAttribute() {},
    setAttribute() {},
    stepUp() {
      this.value = String(Number(this.value) + 1);
    },
    stepDown() {
      this.value = String(Number(this.value) - 1);
    },
    dispatchEvent(event) {
      Object.defineProperty(event, "target", { value: this });
      return page.dispatchEvent(event);
    },
  };
  byId[id] = input;
  return input;
}

const chip = (value, checked) => ({ value, checked, type: "checkbox" });
const chips = [chip("screen", true), chip("discord_dm", false), chip("push", true)];
const fieldset = {
  tagName: "FIELDSET",
  dataset: { canccuWas: "screen, push" },
  validity: {},
  checkValidity: () => true,
  removeAttribute() {},
  setAttribute() {},
  querySelectorAll: (sel) =>
    sel === "input:checked" ? chips.filter((c) => c.checked) : chips,
};
const offline = number("canccu-field-offline", "45");
const link = {
  type: "url",
  value: "",
  dataset: { canccuWas: "" },
  validity: {},
  checkValidity: () => true,
  removeAttribute() {},
  setAttribute() {},
};
const fields = [offline, fieldset, link].map(field);

const count = { textContent: "", classList: { toggle() {} } };
const bar = { hidden: true };
const save = { disabled: false, textContent: "Save" };
const unanswered = { hidden: true };
form = {
  querySelectorAll: (sel) => (sel === "[data-canccu-was]" ? [offline, fieldset, link] : []),
  querySelector: (sel) =>
    ({
      "[data-canccu-count]": count,
      "[data-canccu-savebar]": bar,
      "[data-canccu-save]": save,
      "[data-canccu-unanswered]": unanswered,
    })[sel] ?? null,
};

// This device is in Helsinki; the saved zone is UTC.
const suggested = { options: [{ value: "UTC" }], append(o) { this.options.push(o); } };
const helsinki = { value: "Europe/Helsinki", textContent: "Helsinki" };
zoneSelects = [
  {
    options: [{ value: "UTC" }, helsinki],
    querySelector: (sel) => (sel === 'optgroup[label="Suggested"]' ? suggested : null),
  },
];
Intl.DateTimeFormat = () => ({ resolvedOptions: () => ({ timeZone: "Europe/Helsinki" }) });

await import(pathToFileURL(settingsJs).href);

const click = (target) => {
  const event = new Event("click");
  Object.defineProperty(event, "target", { value: target });
  page.dispatchEvent(event);
  return event;
};
const button = (data) => ({
  dataset: data,
  closest(sel) {
    if (sel === "[data-canccu-pick]" && "canccuPick" in data) return this;
    if (sel === "[data-canccu-step]" && "canccuStep" in data) return this;
    return null;
  },
});

// This device's zone joins Suggested once, after the saved one.
assert.deepEqual(
  suggested.options.map((o) => o.value),
  ["UTC", "Europe/Helsinki"],
);
assert.equal(suggested.options[1].textContent, "Europe / Helsinki (this device)");

// Nothing differs yet: the bar waits.
assert.equal(bar.hidden, true);

click(button({ canccuPick: "120", canccuFor: "canccu-field-offline" }));
assert.equal(offline.value, "120");
assert.equal(count.textContent, "1 change not saved");
assert.equal(fields[0].hint.hidden, false);

click(button({ canccuStep: "1", canccuFor: "canccu-field-offline" }));
assert.equal(offline.value, "121");
click(button({ canccuStep: "-1", canccuFor: "canccu-field-offline" }));
click(button({ canccuStep: "-1", canccuFor: "canccu-field-offline" }));
assert.equal(offline.value, "119");

// A ticked chip is a change of the list.
chips[1].checked = true;
page.dispatchEvent(new Event("change"));
assert.equal(count.textContent, "2 changes not saved");

// A link's preview opens what is typed, only once it is a web address.
link.value = "example";
let event = new Event("input");
Object.defineProperty(event, "target", { value: link });
page.dispatchEvent(event);
assert.equal(fields[2].preview.hidden, true);
link.value = "https://example.org/info";
event = new Event("input");
Object.defineProperty(event, "target", { value: link });
page.dispatchEvent(event);
assert.equal(fields[2].preview.hidden, false);
assert.equal(fields[2].preview.href, "https://example.org/info");
assert.equal(fields[2].preview.textContent, "Open https://example.org/info");

// Undo puts every control back, the chips included.
const undo = { closest: (sel) => (sel.endsWith("[data-canccu-undo]") ? undo : form) };
click(undo);
assert.equal(offline.value, "45");
assert.deepEqual(
  chips.map((c) => c.checked),
  [true, false, true],
);
assert.equal(link.value, "");
assert.equal(fields[2].preview.hidden, true);
assert.equal(bar.hidden, true);

console.log("ok");
