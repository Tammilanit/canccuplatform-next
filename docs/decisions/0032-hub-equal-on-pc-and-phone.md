# 0032. The hub and every attendee page are equal on PC and phone; alerts by app push or browser notification

- **Status:** Accepted (adds amendment 5 to [the design guideline](../design/README.md#amendments-accepted-by-the-po-binding-for-the-build); narrows "phone first" in the step 5 plan, the step 7 pack and the App track pack, without superseding a record)
- **Date:** 2026-11-21

## Context
[0022](0022-product-vision.md) calls the hub "a phone hub (a PWA)", and the packs drew it that way: step 5's plan builds the attendee's Food pages "phone first, then desktop" (#119, its question U17: "phone-first and fine on desktop"), step 7's pack puts the player's pages "mobile-first in the hub's frame (App track P4)", and the App track's pack draws every hub page in a phone frame. [Contracts/notify.md](../../contracts/notify.md) speaks of "attendees' phones".

At a LAN, though, most attendees sit at their own PC all weekend. Phone-first pages show what that costs: at 1280 px the pizza money book left the record and its export in a narrow column, with the rest of the screen empty (#704).

On 2026-11-21 the product owner decided: "we might want to have the hub equally both -- PC and phone. They should complement each other and those who are 'phone-native' will want to run it all via phone, and those who rather do it via PC web browser can do it. Alerts can go via phone app or via www page notifications."

## Decision
**The hub and every attendee page are equal on PC and phone.** This is amendment 5 of [the design guideline](../design/README.md#5--equal-on-pc-and-phone-2026-11-21), binding for every page an attendee or the crew uses.
1. **Everything works fully in both.** Everything an attendee can do works in full in a PC web browser and on a phone, and none of it needs the installed app or a phone: signing up, the tick list, session and match pages, standings, pizza, money, uploading clips and photos.
2. **A layout for each width.** Each page is laid out for both widths. On a desktop that is a desktop layout (columns, side panels, tables where they help), never a phone column stretched or centred on a wide screen. It builds on amendment 3's widths and bands.
3. **Alerts reach either device.** The same notices reach people as push to the installed phone app or as browser notifications on the PC. Both are Web Push subscriptions in Notify, so a PC browser subscribes as a phone does. Discord DMs and channel posts stay the other paths, as Notify already offers. People choose their channels, and no notice depends on a phone.
4. **PC actions are first class**, for example dragging a clip file recorded on the gaming PC onto the upload.
5. **The crew's tools work on both:** the desk on a laptop or PC, the crew phone on the floor.
6. **Both widths are shot.** Every screenshot book and gate book shows attendee pages at phone width (390 px) and desktop width (1280 px or wider).

## Consequences
- **The design guideline** gains amendment 5 ([docs/design/README.md](../design/README.md)). Where a sheet or a pack's mockup draws an attendee page in a phone frame only, the amendment wins, and the page also needs its desktop layout.
- **Step 5's plan:** #119's "phone first, then desktop" and U17's "phone-first and fine on desktop" read as "laid out for PC and phone, both in full". The crew's Food page was already for desktop and phone. #704 gives the pizza money record its desktop layout. The plan's text stays as accepted; this record says how to read it.
- **Step 7's pack:** the player's pages (the new issue "the player's pages in the hub's frame") are laid out for PC and phone, not mobile-first. The crew's tools work on both: the session desk on a laptop or PC, the crew phone on the floor. The plan written after the session follows this.
- **The App track's pack:** P4 (the hub frames and links, and each module owns its own pages) stands. "In the hub's frame" now means a frame for both widths: a phone frame with its tab bar, and a desktop frame laid out for a wide window. The alerts flow (the pre-prompt, the permission, the alerts page, the inbox) applies on a PC browser too, and "turn off all alerts on this phone" means this device. The iPhone install guide stays, since Safari allows push only from the home screen. The track's plan follows this.
- **The roadmap:** the App track's goal and its Play item name the PC beside the phone ([roadmap](../roadmap.md#app)).
- **Built pages** that are only phone-first get their desktop layouts in their own step's polish, not with this record; #704 already covers the pizza record.
- **Screenshots:** a page's issue adds its desktop shot (1280 px or wider) beside its phone shot (390 px) in its group's list ([docs/ci.md](../ci.md#tiers), A new page) when it next changes; the gate books of steps 5 and 7 and the App track show both widths.
- **No contract changes.** Notify's `push` channel is a Web Push subscription from any browser, and Discord DMs are already the other channel. Notify's "phones" means any device that subscribed.

## Known limits
- **0022's words stay** ([decisions README](README.md)): "a phone hub (a PWA)" reads as "the hub (a PWA), on PC and phone". Notify's contract wording ("attendees' phones") changes in the App track's own contract work, when that work next touches the file.
- **Browser notifications need the page's service worker.** A PC browser that blocks notifications, or a closed browser, gets nothing pushed. Like a phone that refused, it relies on the inbox and the person's other channels (Discord DM).
