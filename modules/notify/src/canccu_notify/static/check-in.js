// The check-in page's two steps that need the phone itself (#441, docs/design sheet 7). The page
// works without it: this only adds what a server cannot know.
const card = document.querySelector(".canccu-front__card");

// "Couldn't check you in": a tap that cannot reach the event says so in the page's own card,
// instead of the browser's error page.
const unreachable = document.querySelector("template[data-canccu-unreachable]");
const form = card && card.querySelector("form");
if (card && unreachable && form) {
  form.addEventListener("submit", (event) => {
    if (navigator.onLine) return;
    event.preventDefault();
    card.replaceChildren(unreachable.content.cloneNode(true));
    card.querySelector("a[href='']")?.setAttribute("href", window.location.href);
  });
}

// "Scan again": where the browser reads QR codes, the camera opens in the page and a fresh
// check-in code is followed; elsewhere the hint says to use the phone's camera.
const scan = document.querySelector("[data-canccu-scan]");
const hint = document.querySelector("[data-canccu-scan-hint]");
if (scan) {
  scan.addEventListener("click", async () => {
    if (!("BarcodeDetector" in window) || !navigator.mediaDevices?.getUserMedia) {
      if (hint) hint.hidden = false;
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    } catch {
      if (hint) hint.hidden = false;
      return;
    }
    const view = document.createElement("div");
    view.className = "canccu-scan";
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "canccu-button canccu-button--secondary";
    close.textContent = "Close";
    view.append(video, close);
    document.body.prepend(view);
    await video.play();
    const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
    let open = true;
    const stop = () => {
      open = false;
      stream.getTracks().forEach((t) => t.stop());
      view.remove();
    };
    close.addEventListener("click", stop);
    while (open) {
      const codes = await detector.detect(video).catch(() => []);
      for (const found of codes) {
        let url;
        try {
          url = new URL(found.rawValue, window.location.href);
        } catch {
          continue;
        }
        // Only this event's own check-in page: a QR code elsewhere never takes the phone away.
        if (url.origin === window.location.origin && url.pathname === "/notify/check-in") {
          stop();
          window.location.assign(url.href);
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  });
}
