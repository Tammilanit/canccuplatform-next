# Setting up a screen kiosk

A venue screen is a computer with a Chromium-based browser (Chrome, Chromium or Edge) showing `https://<event hostname>/screen/` full screen. This guide sets one up so it never shows a black or silent screen, survives a reboot and keeps playing when the venue's uplink drops. The screen contract is [contracts/screen.md](../contracts/screen.md); the player is `modules/screen/player/`.

## Before the doors open: the check page
Open `https://<event hostname>/screen/check` in the kiosk's browser, with the same profile and flags it runs with (below). Each row is green or says what to fix:

| Row | Green when | If not |
|---|---|---|
| Screen | The display gives at least 1920×1080 device pixels, either way round | Set the display's resolution to 1920×1080 or more; screens are designed for 1080p and 4K, nothing smaller |
| Clock | The computer's clock is within 2 seconds of the server's | Turn on network time (NTP). Rotation and countdowns run on the screen's own clock, so a drifting kiosk shows other moments than its neighbours, and Studio flags it `clock_drift` |
| Device | The browser is paired and in a zone | Open `/screen/` to pair it, then assign it in Screen studio → Devices |
| Sound | Sound plays without a tap | Add `--autoplay-policy=no-user-gesture-required`. **Tap to test the sound** plays a short tone; a tap unlocks sound only until the next reload, which is why the flag is needed |
| Offline | The offline cache runs | The screen must be served over `https://`; the cache starts after `/screen/` has loaded once |

## The browser's flags
The legacy's black and silent screens came from missing flags. Start the browser with all of these:

| Flag | Why |
|---|---|
| `--kiosk https://<event hostname>/screen/` | Full screen, no address bar, no tabs |
| `--autoplay-policy=no-user-gesture-required` | Otherwise the browser blocks sound until someone taps the screen, after every reload |
| `--no-first-run` | No welcome page on a fresh profile |
| `--disable-session-crashed-bubble` and `--hide-crash-restore-bubble` | No "restore pages?" bubble over the screen after a power cut |
| `--disable-features=Translate` | No translate bar over an event in another language |
| `--disable-background-timer-throttling`, `--disable-renderer-backgrounding`, `--disable-backgrounding-occluded-windows` | A window the system thinks is hidden otherwise slows its timers, and rotation and the clock fall behind |
| `--disable-pinch` and `--overscroll-history-navigation=0` | A touch screen cannot be zoomed or swiped back off the screen |
| `--user-data-dir=<a folder of its own>` | A profile that keeps the device cookie and the offline cache. Never guest or incognito: the screen would ask to be paired after every restart |

On Windows also add `--disable-features=CalculateNativeWinOcclusion` (merge it with the line above: `--disable-features=Translate,CalculateNativeWinOcclusion`): without it Windows can decide the window is covered and the screen goes black. Edge also takes `--edge-kiosk-type=fullscreen`.

## The computer
- **Log in automatically** and start the browser at login (a systemd user service or the desktop's autostart on Linux; Task Scheduler "at log on" on Windows). Restart it if it exits.
- **Never sleep:** turn off sleep, the screen saver, display power-off and automatic restarts for updates during the event.
- **Network time on**, see the check page's Clock row.
- **HTTPS:** the device cookie is `Secure`, so a kiosk pairs and keeps its pairing only over `https://`. The IP-mode demo stack (plain `http://` on port 80) can show the page but cannot pair a real kiosk, and browsers give it no offline cache.

### Linux example (Chromium)
```sh
chromium --kiosk https://<event hostname>/screen/ \
  --autoplay-policy=no-user-gesture-required --no-first-run \
  --disable-session-crashed-bubble --hide-crash-restore-bubble \
  --disable-features=Translate \
  --disable-background-timer-throttling --disable-renderer-backgrounding \
  --disable-backgrounding-occluded-windows \
  --disable-pinch --overscroll-history-navigation=0 \
  --user-data-dir="$HOME/.config/canccu-kiosk"
```

### Windows example (Edge)
```bat
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --kiosk https://<event hostname>/screen/ --edge-kiosk-type=fullscreen --autoplay-policy=no-user-gesture-required --no-first-run --disable-session-crashed-bubble --hide-crash-restore-bubble --disable-features=Translate,CalculateNativeWinOcclusion --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --disable-pinch --overscroll-history-navigation=0 --user-data-dir=C:\canccu-kiosk
```

To run the check page, start the same command once with `/screen/check` in place of `/screen/`, then switch back.

## When the uplink drops
The screen keeps its last composed state and the files it names in the browser's cache and keeps playing: rotation, the clock and countdowns run on, and a small "offline since" mark shows after 10 seconds. A kiosk that reboots without the uplink draws the last state it kept, marked offline since it last heard from the server. Nothing new starts offline; when the uplink returns the screen catches up by itself, without a reload.

Custom embeds (`/theming/sandbox/<revision>/…`) are kept like the theme's files, under their immutable addresses. Browsers never let a page's offline cache answer a sandboxed frame itself, so the frame reads the copy that fetching them ahead left in the browser's ordinary cache, which keeps it as long as it has room.

## Seeing a zone without a kiosk
`https://<event hostname>/screen/zones/<zone key>` draws a zone as its screens show it, live, for anyone signed in with the right to read the event's screens (`?orientation=portrait` for a portrait screen). It is a mirror: it plays no sound, sends no heartbeat and never shows in device health, and its check-in QR is a sample without the live code. Studio's live view and the CI screenshots use it.
