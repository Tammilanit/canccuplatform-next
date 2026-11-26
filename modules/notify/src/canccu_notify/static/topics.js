// Notifications (#782, sheets 01 and 02): what only a script adds to pages that work without one.
// A kind's switch saves at once, and the page answers with the notice and its Undo; a stepper's
// buttons and the quick picks set the number as if typed, inside its min and max.
for (const save of document.querySelectorAll(".canccu-notify-save")) save.hidden = true;

document.addEventListener("change", (event) => {
  const form = event.target.closest(".canccu-notify-switchform");
  if (form && event.target.name === "enabled") form.requestSubmit();
});

document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-canccu-pick], [data-canccu-step]");
  const input = button && document.getElementById(button.dataset.canccuFor);
  if (!input) return;
  if ("canccuPick" in button.dataset) input.value = button.dataset.canccuPick;
  // stepUp and stepDown keep the number inside its min and max.
  else if (button.dataset.canccuStep === "-1") input.stepDown();
  else input.stepUp();
});
