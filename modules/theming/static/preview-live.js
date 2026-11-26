/*
 * A Studio preview frame's side of the live preview (plan issue-784 D3): token values posted by the
 * framing Studio page (same origin, its parent only) are set on the root, ahead of the draft's
 * saved token CSS; null takes one back. Only the platform's custom properties: never a property
 * of the page itself. Set through the CSSOM, which the page's style policy allows.
 */
"use strict";

addEventListener("message", (event) => {
  if (event.source !== parent || event.origin !== location.origin) return;
  const data = event.data;
  if (data?.type !== "canccu-theme-live" || typeof data.vars !== "object" || data.vars === null)
    return;
  const style = document.documentElement.style;
  for (const [name, value] of Object.entries(data.vars)) {
    if (!/^--canccu-[a-z0-9-]{1,48}$/.test(name)) continue;
    if (value === null) style.removeProperty(name);
    else if (typeof value === "string" && value.length <= 200) style.setProperty(name, value);
  }
});
