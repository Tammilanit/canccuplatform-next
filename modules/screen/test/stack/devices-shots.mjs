// Devices in the grid that scales (amendment 3, #642; docs/design/grids/04-devices.svg): no
// screens, then 2 and 12 at 1280 and 1920 px and 12 on a phone. The script pairs the screens it
// needs and revokes them afterwards; the empty state needs a fleet with nothing paired.
import { SESSION } from "./client.mjs";

const DESK = { width: 1280, height: 800 };
const HD = { width: 1920, height: 1080 };
const PHONE = { width: 390, height: 844 };
const PAGE = "/admin/screen/devices";
// Demo names; the page lists them by name.
const NAMES = [
  ["Hall left", "main"],
  ["Hall right", "main"],
  ["Back room", "entrance"],
  ["Café bar", "entrance"],
  ["Entrance portrait", "entrance"],
  ["Hall balcony", "main"],
  ["Lobby", "entrance"],
  ["Lounge", "entrance"],
  ["Spare kiosk", "main"],
  ["Stage left", "main"],
  ["Stage right", "main"],
  ["Workshop", "entrance"],
];

export const DEVICE_PAGES = [
  ["screen-devices-none", PAGE, DESK],
  ["screen-devices-2", PAGE, DESK],
  ["screen-devices-2-1920", PAGE, HD],
  ["screen-devices-12", PAGE, DESK],
  ["screen-devices-12-1920", PAGE, HD],
  ["screen-devices-12-phone", PAGE, PHONE],
];

const firstLine = (err) =>
  String(err?.message ?? err)
    .split("\n")[0]
    .slice(0, 300);

export async function devicesShots({ demo, shot, fail }) {
  const paired = [];
  const pair = async (upTo) => {
    while (paired.length < upTo) {
      const [name, zone] = NAMES[paired.length];
      paired.push(await demo.pair(name, zone));
    }
  };
  try {
    const { devices } = (await demo.call("GET", "/api/screen/devices")).body;
    if (devices.length === 0) await shot("screen-devices-none", PAGE, DESK, SESSION);
    else
      fail(
        `devices, none: ${devices.length} screens are still paired (${devices.map((d) => d.name).join(", ")})`,
      );
    await pair(2);
    await shot("screen-devices-2", PAGE, DESK, SESSION);
    await shot("screen-devices-2-1920", PAGE, HD, SESSION);
    await pair(12);
    await shot("screen-devices-12", PAGE, DESK, SESSION);
    await shot("screen-devices-12-1920", PAGE, HD, SESSION);
    await shot("screen-devices-12-phone", PAGE, PHONE, SESSION, { touch: true });
  } catch (err) {
    fail(`devices: ${firstLine(err)}`);
  } finally {
    for (const device of paired) {
      await demo.revoke(device.id).catch((err) => fail(`devices cleanup: ${firstLine(err)}`));
    }
  }
}
