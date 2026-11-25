/*
 * The way to sign in from a signed-out Devices page. The kiosk's QR carries its pairing code in the
 * fragment, which no server sees and sign-in does not bring back, so the code is kept in this tab
 * for studio.js to open the pair dialog with after sign-in (contracts/screen.md, Pairing).
 */
"use strict";

(() => {
  if (location.hash.startsWith("#pair=")) {
    const code = decodeURIComponent(location.hash.slice(6)).replace(/[^A-Za-z0-9]/g, "");
    if (code) sessionStorage.setItem("canccu-studio-pair", code.toUpperCase());
  }
  // Sign-in's cookie is `Secure`, so over plain http it would loop: say what to do instead (#783).
  if (!window.isSecureContext) {
    document.querySelector("[data-insecure]").hidden = false;
    return;
  }
  location.replace(document.querySelector("a[data-sign-in]").href);
})();
