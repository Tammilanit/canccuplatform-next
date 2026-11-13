// The Health page follows the watch's checks (every 10 s): reload while the page is in view, without
// "?check=now", so an open page never makes admin check more often than the watch does.
setInterval(() => {
  if (document.visibilityState === "visible")
    location.replace(location.pathname);
}, 10000);
