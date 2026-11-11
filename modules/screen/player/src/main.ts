/** The bundle's entry: the loader page (`/screen/`) runs this as its one script. */
import "./player.css";
import "./screen.css";
import { Player } from "./player.js";

const body = document.body;
const player = new Player({
  fetch: (input, init) => fetch(input, init),
  nav: {
    hash: () => location.hash,
    // The transfer code is single use: drop it from the address, so a reload never sends it again.
    clearHash: () => {
      history.replaceState(null, "", location.pathname + location.search);
    },
    origin: () => location.origin,
    go: (url) => {
      location.assign(url);
    },
    reload: () => {
      location.reload();
    },
  },
  root: body,
  bundle: body.dataset.bundle ?? "dev",
});
void player.start();
