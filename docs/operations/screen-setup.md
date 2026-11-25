# Set up a screen

For organisers and crew: from a computer and a TV to a screen that plays the event, in about five minutes. The same steps are in Screen studio → Devices, under **Set up a screen**. Every browser flag and the kiosk check page are explained in [screen-kiosk.md](../screen-kiosk.md); the rules behind pairing are in [contracts/screen.md](../../contracts/screen.md) (Pairing) and [contracts/tenants.md](../../contracts/tenants.md) (Screen access).

## What you need
- A computer with Chrome, Chromium or Edge, and a TV or monitor, one computer per screen.
- The event's address over **https**: `https://<event hostname>/screen/`. Over plain `http://` no screen can pair: the browser drops the screen's cookies, so the screen says "This address can't pair screens" and names the https address to open instead.
- An organiser's phone (or any browser) signed in with the right to pair screens.

## 1. Kiosk mode
Start the browser full screen on the event's screen page, with sound allowed and a profile of its own:

```sh
chromium --kiosk https://<event hostname>/screen/ \
  --autoplay-policy=no-user-gesture-required --no-first-run \
  --user-data-dir="$HOME/.config/canccu-kiosk"
```

Never a guest or incognito window: it forgets the screen's pairing at every restart. The full list of flags (crash bubbles, background throttling, touch screens, the Windows and Edge lines) is in [screen-kiosk.md](../screen-kiosk.md#the-browsers-flags).

## 2. Autostart
- Let the computer log in by itself and start the browser at login: a systemd user service or the desktop's autostart on Linux, Task Scheduler "at log on" on Windows. Restart it when it exits.
- Turn off sleep, the screen saver, display power-off and update restarts for the event.
- Turn on network time: a screen whose clock is off shows countdowns at the wrong moment.

After a power cut the screen then comes back by itself, already paired.

## 3. Sound
Connect the speakers to that computer. Each zone plays sound on one screen only: choose it in Screen studio → Zones, the zone's sound settings. `--autoplay-policy=no-user-gesture-required` is what lets it play without anyone tapping the screen.

## 4. Portrait
Turn the picture in the computer's display settings (rotate 90°). The screen sees that it is taller than wide and draws its zone's portrait layout by itself; Studio shows its size as "portrait 1080×1920".

## 5. Pair it
1. The screen shows a big code, a QR code and "Waiting for an organiser…". The code lives 10 minutes; a reload keeps it, and a new one comes by itself when it runs out.
2. Scan the QR with your phone. It opens Screen studio's **Pair a screen** with the code filled in; sign in first if asked, and the code is kept through the sign-in.
3. Give the screen a name that says where it is ("Hall left"), choose its zone (or **Choose later**) and press **Pair**.
4. Devices opens on the new screen: "Waiting for Hall left to connect…", then "Hall left is on." Press **Test pattern** to check its edges, its size and its orientation, and **Identify** to flash its name on it when you are not sure which screen is which.

No phone at hand? Open Screen studio → Devices → **Pair a screen** anywhere and type the 8 characters the screen shows.

## When something is wrong
Every message says what to do:

| You see | Where | What to do |
|---|---|---|
| "That code is wrong or has expired." | The pair dialog | Check the 8 characters on the screen; it shows a new code every 10 minutes. |
| "This address can't pair screens: open it with https." | The screen, or Studio | Open the `https://` address on the kiosk and in Studio. |
| "Hall left has not connected." | Devices, after a minute | Check that the screen is on and still shows its code. If it shows a new code, remove the screen and pair it again. |
| "Hall left is offline." | Devices | Check its power and its network; it catches up by itself when it is back. |
| "Not at the venue" | The screen | The event lets screens play only on the venue's network (below). Connect it there, or let screens play anywhere. |
| "Too many open pairing codes" | The screen | Use an open code, or **Clear open codes** on Devices. |

## Only on the venue's network
By default a paired screen plays wherever it is: pairing proves it is the event's, so a screen keeps playing on a 4G router or when the venue's address changes. An event with a fixed venue network may choose **Only on the venue's network** in Admin → Settings → Event access → Screens play. Then a screen elsewhere shows "Not at the venue" and asks again every 30 seconds; while the venue's address is being fixed, an event admin can turn the check off for up to 48 hours with the emergency switch.
