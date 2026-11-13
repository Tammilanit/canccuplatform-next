import { describe, expect, it } from "vitest";
import { button, card, field, healthBadge, page } from "../src/components.js";
import { escapeHtml, html, raw } from "../src/html.js";

const s = (h: { toString(): string }): string => h.toString();
const EVIL = `<script>alert("x")</script>`;

describe("button", () => {
  it.each(["primary", "secondary", "danger"] as const)("%s", (variant) => {
    expect(s(button({ label: "Save", variant }))).toMatchSnapshot();
  });
  it("with type, name, value and disabled", () => {
    expect(
      s(button({ label: "Reset", type: "button", name: "action", value: "reset", disabled: true })),
    ).toMatchSnapshot();
  });
});

describe("field", () => {
  it("text with hint", () => {
    expect(
      s(field({ name: "title", label: "Title", value: "Demo", hint: "Shown on screens" })),
    ).toMatchSnapshot();
  });
  it("number with error", () => {
    expect(
      s(
        field({
          name: "slots",
          label: "Slots",
          type: "number",
          value: 8,
          error: "Too many",
          required: true,
        }),
      ),
    ).toMatchSnapshot();
  });
  it("password", () => {
    expect(s(field({ name: "pin", label: "PIN", type: "password" }))).toMatchSnapshot();
  });
  it("checkbox", () => {
    expect(
      s(field({ name: "open", label: "Open", type: "checkbox", value: true })),
    ).toMatchSnapshot();
    expect(s(field({ name: "open", label: "Open", type: "checkbox", value: false }))).not.toContain(
      "checked",
    );
  });
  it("select", () => {
    expect(
      s(
        field({
          name: "mode",
          label: "Mode",
          value: "b",
          options: [
            { value: "a", label: "A" },
            { value: "b", label: "B" },
          ],
        }),
      ),
    ).toMatchSnapshot();
  });
  it("select with a hidden option it can still hold", () => {
    const h = s(
      field({
        name: "mode",
        label: "Mode",
        options: [
          { value: "a", label: "A" },
          { value: "gone", label: "Gone", hidden: true },
        ],
      }),
    );
    expect(h).toContain('<option value="a">A</option>');
    expect(h).toContain('<option value="gone" hidden>Gone</option>');
  });
});

describe("card", () => {
  it("with title", () => {
    expect(s(card({ title: "Health", body: healthBadge("ok") }))).toMatchSnapshot();
  });
  it("without title", () => {
    expect(s(card({ body: "Plain text" }))).toMatchSnapshot();
  });
});

describe("page", () => {
  it("defaults, no logo, no theme", () => {
    expect(s(page({ title: "Admin", body: card({ body: "Hi" }) }))).toMatchSnapshot();
  });
  it("with logo, theme and css href", () => {
    expect(
      s(
        page({
          title: "Admin",
          body: "Hi",
          logoUrl: "/files/assets/logo.svg",
          cssHref: "/static/ui.css",
          profile: { theme: { colors: { primary: "#ff0000" }, fonts: { body: "Inter" } } },
        }),
      ),
    ).toMatchSnapshot();
  });
  it("marks the body with the surface, admin by default", () => {
    expect(s(page({ title: "x", body: "" }))).toContain(
      '<body class="canccu-page canccu-surface canccu-surface--admin">',
    );
    expect(s(page({ title: "x", body: "", surface: "screen" }))).toContain(
      '<body class="canccu-page canccu-surface canccu-surface--screen">',
    );
  });
  it("puts the response nonce on the theme <style>", () => {
    const nonce = "abcdEFGH0123+/==-_xyz";
    const profile = { theme: { colors: { primary: "#ff0000" } } };
    expect(s(page({ title: "x", body: "", profile, nonce }))).toContain(`<style nonce="${nonce}">`);
    expect(s(page({ title: "x", body: "", profile }))).toContain("<style>");
    expect(() => page({ title: "x", body: "", profile, nonce: 'a"b' })).toThrow(/nonce/);
  });
  it("drops an unsafe theme value instead of writing it into <style>", () => {
    const out = s(
      page({
        title: "x",
        body: "",
        profile: { theme: { colors: { primary: "</style><script>" } } },
      }),
    );
    expect(out).not.toContain("<style>");
    expect(out).not.toContain("<script>");
  });
});

describe("healthBadge", () => {
  it.each(["ok", "degraded", "down"] as const)("%s", (status) => {
    expect(s(healthBadge(status))).toMatchSnapshot();
  });
});

describe("escaping", () => {
  it("escapes <script> in every text and attribute", () => {
    const outputs = [
      button({ label: EVIL, name: EVIL, value: EVIL }),
      field({ name: EVIL, label: EVIL, value: EVIL, hint: EVIL }),
      field({ name: "e", label: "e", error: EVIL }),
      field({ name: "o", label: "o", options: [{ value: EVIL, label: EVIL }] }),
      card({ title: EVIL, body: EVIL }),
      page({ title: EVIL, body: EVIL, logoUrl: `"${EVIL}`, cssHref: `"${EVIL}` }),
    ].map(s);
    for (const out of outputs) {
      expect(out).not.toContain("<script>");
      expect(out).toContain("&lt;script&gt;");
    }
  });
  it("does not double-escape nested Html", () => {
    const inner = html`<b>${"a & b"}</b>`;
    const out = s(card({ body: inner }));
    expect(out).toContain("<b>a &amp; b</b>");
    expect(out).not.toContain("&amp;amp;");
  });
  it("escapeHtml covers & < > \" '", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
  it("a plain string equal to earlier markup is still escaped", () => {
    const markup = s(raw("<b>x</b>"));
    expect(s(html`${markup}`)).toBe("&lt;b&gt;x&lt;/b&gt;");
  });
  it("joins lists and skips empty slots", () => {
    expect(s(html`${["a", html`<i>b</i>`, null, undefined, false, 3]}`)).toBe("a<i>b</i>3");
  });
});
