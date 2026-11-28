// The Discord page's changes (#765): each form names the contract's API path and method
// (data-bot-api, data-bot-method) and the page to show after (data-bot-done). Its fields become
// the JSON body: an empty text is left out (a credential that stays as stored), data-bot-int is a
// number, data-bot-null an empty choice as null, data-bot-flag a switch as {flags: {name: on}}.
// The page then opens `done`, or itself with ?error=<code>; the server says either in words, so
// no text from an answer reaches the page. A bind's answer is Discord's install page, opened.
const FORM = "form[data-bot-api]";

function bodyOf(form) {
  const body = {};
  for (const el of form.querySelectorAll("input, select")) {
    if ("botFlag" in el.dataset) {
      body.flags = { ...body.flags, [el.dataset.botFlag]: el.checked };
    } else if (!el.name) {
      continue;
    } else if ("botInt" in el.dataset) {
      body[el.name] = Number.parseInt(el.value, 10);
    } else if ("botNull" in el.dataset) {
      body[el.name] = el.value || null;
    } else if (el.value) {
      body[el.name] = el.value;
    }
  }
  return body;
}

function withError(code) {
  const url = new URL(location.href);
  url.searchParams.delete("done");
  url.searchParams.delete("bind");
  url.searchParams.set("error", code);
  return url.pathname + url.search + url.hash;
}

// A target that differs from this page only by its #fragment is no navigation: the browser
// would stay, and the page would stay as it was, its buttons disabled. Reload it instead.
function open(target) {
  const to = new URL(target, location.href);
  if (to.pathname === location.pathname && to.search === location.search) {
    location.reload();
  } else {
    location.assign(to.href);
  }
}

async function send(form) {
  const method = form.dataset.botMethod;
  const body = bodyOf(form);
  const init = { method, headers: { accept: "application/json" } };
  if (Object.keys(body).length) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(form.dataset.botApi, init);
  } catch {
    open(withError("unreachable"));
    return;
  }
  const answer = await res.json().catch(() => ({}));
  if (!res.ok) {
    // The API's own error code wins, 5xx included; a 5xx without one is Caddy's, for a part
    // that is down, and to the organiser that is no answer.
    const code = answer?.error?.code || (res.status >= 500 ? "unreachable" : "refused");
    open(withError(code));
    return;
  }
  // The bind's answer: Discord's install page, beside the API the module is set up with.
  const next = answer?.authorize_url;
  if (typeof next === "string" && /^https?:\/\//.test(next)) {
    location.assign(next);
    return;
  }
  open(form.dataset.botDone);
}

document.addEventListener("submit", (event) => {
  const form = event.target.closest(FORM);
  if (!form) return;
  event.preventDefault();
  const ask = form.dataset.botConfirm;
  if (ask && !confirm(ask)) return;
  for (const b of form.querySelectorAll("button")) b.disabled = true;
  send(form);
});

// A switch is its own change: turning it sends it.
document.addEventListener("change", (event) => {
  if (!("botAutosubmit" in event.target.dataset)) return;
  event.target.closest(FORM)?.requestSubmit();
});
