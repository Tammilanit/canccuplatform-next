import { describe, expect, it } from "vitest";
import { html } from "../src/html.js";
import { iconButton, infoTip, statusChip, tooltip } from "../src/tip.js";

const s = (h: { toString(): string }): string => h.toString();
const tipId = (markup: string): string => /role="tooltip" id="([^"]+)"/.exec(markup)?.[1] ?? "";

describe("the tooltip (#782)", () => {
  it("names its text with aria-describedby on the trigger", () => {
    const out = s(tooltip(html`<a href="/x">Open</a>`, "Opens the <live> view"));
    const id = tipId(out);
    expect(id).not.toBe("");
    expect(out).toContain(`<a aria-describedby="${id}" href="/x">Open</a>`);
    expect(out).toContain("Opens the &lt;live&gt; view</span>");
  });

  it("gives every tooltip its own id", () => {
    expect(tipId(s(infoTip("a")))).not.toBe(tipId(s(infoTip("b"))));
  });

  it("is an info button with a label for screen readers", () => {
    const out = s(infoTip("Checks that phones can receive notifications."));
    expect(out).toContain(
      '<button type="button" class="canccu-tip__info" aria-label="More about this"',
    );
    expect(out).toContain(`aria-describedby="${tipId(out)}"`);
  });

  it("makes an icon button's label its aria-label and its tooltip", () => {
    const out = s(iconButton({ icon: "close", label: "Remove the zone", href: "/z" }));
    expect(out).toContain('aria-label="Remove the zone"');
    expect(out).toContain('href="/z"');
    expect(out).toMatch(
      /role="tooltip" id="[^"]+" class="canccu-tip__text" aria-hidden="true">Remove the zone</,
    );
  });

  it("puts a tooltip on a status chip, which a keyboard can reach", () => {
    const out = s(statusChip("down", "Down", "The part does not answer."));
    expect(out).toContain('class="canccu-badge canccu-badge--down" tabindex="0"');
    expect(out).toContain(`aria-describedby="${tipId(out)}"`);
    expect(out).toContain("The part does not answer.");
  });
});
