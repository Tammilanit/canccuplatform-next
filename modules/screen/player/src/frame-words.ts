/**
 * The device frames' words (#385, sheet 9 of docs/design): a lead line for everyone, then help for
 * the crew. player.ts picks the frame; these are what it says.
 */
export const SETUP = "Screen setup";
export const CONNECTING = {
  kicker: "Starting",
  title: "Connecting…",
  lines: ["This screen is waiting for the event's server."],
};
export const UNREACHABLE = {
  title: "No connection yet",
  lines: ["This screen starts when it reaches the event.", "Crew: check the cable or the Wi-Fi."],
};
export const REFUSED = {
  title: "Not at the venue",
  lines: [
    "This event lets screens play only on the venue's network.",
    "Crew: connect it to the venue's network, or ask an organiser to let screens play from anywhere (Event access).",
  ],
  foot: "Trying again every 30 s · nothing is shown while refused",
};
export const archived = (event: string | null | undefined) => ({
  title: "This event has ended",
  lines: [
    event ? `Thank you for coming to ${event}.` : "Thank you for coming.",
    "Crew: the platform admin moves screens between events.",
  ],
});
export const MOVED = { title: "This screen has moved" };
export const MOVED_HELP = "Crew: update the kiosk's start address when convenient.";
export const PARKED = {
  title: "Not assigned to an event",
  lines: [
    "This screen is paired, but no event holds it right now.",
    "Crew: the platform admin moves screens between events.",
  ],
};
export const NO_VENUE = {
  title: "This event has no venue yet",
  lines: ["Screens pair only once the event has a venue.", "Ask an organiser to set it."],
  foot: "Trying again every 30 s",
};
export const TOO_MANY = {
  title: "Too many open pairing codes",
  lines: ["Use an open code, or wait until one expires."],
  foot: "Trying again every 30 s",
};
/** The pairing frame (#783): the code, the QR beside the words, and the typed fallback. */
export const PAIRING = {
  kicker: "New screen",
  title: "Pair this screen",
  lines: [
    "Waiting for an organiser…",
    "Scan the QR code with a phone and sign in, or type the code in Screen studio → Devices.",
  ],
};
/**
 * The pairing and device cookies are `Secure`: over plain http the browser drops them, so a code
 * could be claimed but never collected (contracts/screen.md, Pairing). Say so instead.
 */
export const insecure = (address: string) => ({
  title: "This address can't pair screens",
  lines: [`Open it with https: ${address}`, "Crew: change the kiosk's start address to that one."],
});
