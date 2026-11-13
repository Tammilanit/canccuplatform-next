// People's "Copy the sign-in link" (#437): the link is made whole against this page's own
// address, the event's hostname, which is where the person should sign in.
for (const button of document.querySelectorAll("[data-canccu-copy]")) {
  const label = button.textContent;
  button.addEventListener("click", async () => {
    const link = new URL(button.dataset.canccuCopy, window.location.href).href;
    try {
      await navigator.clipboard.writeText(link);
      button.textContent = "Copied";
    } catch {
      // No clipboard (plain http on a phone): show the link, so it can be copied by hand.
      button.textContent = link;
    }
    setTimeout(() => (button.textContent = label), 4000);
  });
}
