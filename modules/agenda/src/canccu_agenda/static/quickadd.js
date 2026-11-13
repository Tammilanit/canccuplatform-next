// Quick add (docs/design/mockups.html, sheet 5). Without this script the form still works: the
// server moves a time after midnight to the next day when the Day was left as the form chose it
// (quickadd._night), and the button says what it adds as the page was drawn. With it, the form
// says so before it is sent:
// - a time typed picks "At", and a length typed picks "Other…";
// - a time after midnight picks the next day and says why, while the Day is the form's own;
// - a day picked by hand drops the form's own day (day_auto), so neither this script nor the
//   server moves it again;
// - the button repeats the day and the time.
const form = document.querySelector(".canccu-agenda-quick");
const NIGHT_ENDS = 6; // as day_view.NIGHT_ENDS

if (form) {
  const at = form.elements.namedItem("at");
  const minutes = form.elements.namedItem("minutes");
  let auto = form.elements.namedItem("day_auto");
  const days = [...form.querySelectorAll("input[name=day]")];
  const hint = form.querySelector(".canccu-agenda-night");
  const submit = form.querySelector("button");
  const pick = (name, value) => {
    const input = form.querySelector(`input[name=${name}][value="${value}"]`);
    if (input) input.checked = true;
  };
  const label = (input) => input.nextElementSibling.textContent;
  // The day the form moved by itself, so a time back before midnight moves it back.
  let moved = false;

  const update = () => {
    const when = form.querySelector("input[name=when]:checked");
    const time = /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(at.value) ? at.value : "";
    const night = when && when.value === "at" && time && Number(time.slice(0, 2)) < NIGHT_ENDS;
    const index = auto ? days.findIndex((d) => d.value === auto.value) : -1;
    const own = days[index];
    const next = index >= 0 ? days[index + 1] : undefined;
    if (next && night && own.checked) {
      next.checked = true;
      moved = true;
    } else if (next && moved && !night && next.checked) {
      own.checked = true;
      moved = false;
    }
    const day = days.find((d) => d.checked);
    hint.hidden = !(moved && day === next);
    if (!hint.hidden) {
      hint.textContent = `${time} is after midnight, so ${label(day)} is picked. Change it if you mean otherwise.`;
    }
    if (when && when.value === "at" && time && day) {
      submit.textContent = `Add on ${label(day).split(" ")[0]} at ${time}`;
    } else {
      submit.textContent = when && when.value === "in30" ? "Add in 30 min" : "Add now";
    }
  };

  at.addEventListener("input", () => {
    if (at.value) pick("when", "at");
    update();
  });
  minutes.addEventListener("input", () => {
    if (minutes.value) pick("length", "other");
  });
  form.addEventListener("change", (e) => {
    if (e.target.name === "day" && auto) {
      auto.remove();
      auto = null;
      moved = false;
    }
    update();
  });
  update();
}
