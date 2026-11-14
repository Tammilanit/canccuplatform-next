# Step 3 screenshot book: every surface with its use case

Issue #386. Every page, state and screen a person meets on the demo stack at main `368e6fe` (2026-11-14), after every step 3 package merged, the last being #513. Each image has one short paragraph: who uses it, when, what they do there, and the mockup it follows. The book is grouped by person: [the organiser](#the-organiser), [the crew](#the-crew), [the attendee](#the-attendee) and [the room](#the-room). The product owner reads it before the step 3 checkpoint. The lead adds [an evaluation and a plan](#leads-evaluation) at the end.

## How it was made

- **Source:** every image comes from the artifact `demo-screenshots` of one full Demo stack run on main `368e6fe`, started by hand after #513 merged ([43604390294](https://github.com/Tammilanit/canccuplatform-next/actions/runs/43604390294), green). None was taken on a local stack or by a module-tier run. `scripts/demo-screenshots` took them in Chromium with the demo event and its fixture, signed in with the CI session stub, which holds every right the pages check ([docs/ci.md](../ci.md#demo-stack)). The no-access pages use a second session that holds no role. The run fails if a page does not answer, if a screen does not draw the event or if a screen's text does not pass the readability check, so each image shows a working page, not an error caught by accident.
- **Data:** the demo profile, plus:
  - a run of show around the time of the run, over two days, with Dinner on now and the semi-final 15 min late;
  - a ticker line;
  - two zones, Main hall (landscape) and Entrance (portrait), each with a screen paired;
  - 40 people who signed in over the day;
  - five assets in the Screen studio and, for its playlist and schedule shots, four playlists with schedule windows and a break;
  - a session without a role (Player Zero), for the no-access pages;
  - three more demo events, for the states the demo event cannot be in: one archived (15–16 Oct) for the read-only pages, one that starts next week and one away from its venue, for check-in.

  For the Pins shots the stack freezes its screens for an hour. For the Health shots it stops notify, then starts it again. A screen state the stack cannot reach on its own is the player's own answer to that state, handed to the page: refused, moved, archived, a claim, a photo, the sample statistics, the stage and the Director.
- **Sizes:**
  - Desktop pages are 1280 px wide. Settings, Run of show and Devices also have a 1440 px shot. Schedule, its window editor and What plays at… are shot only at 1440 px, and the playlist editor at 1920 px.
  - Phone pages are 390 px wide.
  - Pages are shown 1:1, as full pages.
  - Screens were shot at 1920×1080, 3840×2160, 1080×1920 and 2160×3840 and are scaled down here to 720 px on the short side (JPEG), with one 1:1 crop of a 4K screen.
  - The full set (282 PNGs: every theme at every size, and frame strips of the motion vocabulary) is in the artifact.
- **Time:** the run took its shots between about 14:22 and 14:28 UTC on 14 November, so the clocks show 14:2x and the countdowns about an hour.
- **The offline marker:** only R29, R30 and R37 carry it, because they show the offline state itself. Every other screen was shot online.
- **Mockups:** "sheet N" is sheet N of the accepted design guideline [docs/design/mockups.html](../design/mockups.html) (PO, 2026-11-12); "mockup NN" is the step 3 brief's mockup in [docs/briefs/step-3-screen/](../briefs/step-3-screen/).

## Contents

| Person | Surfaces | Images |
|---|---|---|
| Organiser, desktop | Sign-in and its states, Settings, Health, Event profile, People, errors, Run of show, Notifications, Theme studio, Screen studio, the archived event | [O1–O37, O53–O59, O65–O92](#organiser-at-the-desk) |
| Organiser, phone | The same pages in one column with the bottom bar, the person sheet, offline | [O38–O52, O60–O64, O93–O96](#organiser-on-a-phone) |
| Crew | Sign-in, no role yet, run of show and Screen studio on a phone; the kiosk frames | [C1–C21](#the-crew) |
| Attendee | Check-in and each of its states, privacy, the phone hub's preview | [A1–A12](#the-attendee) |
| The room | The Pulse at 1080p, 4K and portrait; the other layouts and widgets with and without the bot's data; claims; offline; the end; the other themes; the stage, the Director and the choreographer | [R1–R13, R21–R27, R29–R64](#the-room) |

The IDs stay with their screens, so comments on earlier versions still hold. Pages added since take the next free number of their group and stand where they belong. Eight IDs left the book:
- **R14–R20** (the pushed playlist and the Terminal embed on a full-size screen) came from a local stack. The full run shoots no screen while a pushed playlist or an embed plays (see [Not in this book](#not-in-this-book)).
- **R28** (the takeover over Ambient) was the same file as R27, byte for byte (see R27).

## The organiser

The organiser runs the event from a laptop before and during it, and from a phone on the floor. Every organiser page sits in one shell (sheet 2):
- on top, the event's name, dates and Live badge, and the clock on the right;
- on the left, the Event menu (Run the event · Screens and look · Admin), with the person at its foot.

On a phone the menu becomes the bottom bar, with Quick add in the middle.

### Organiser at the desk

#### O1 · Sign-in
![Sign-in page, desktop](step3-screenshot-book/o01-sign-in.png)

The organisers and crew open the event's address on the day they start working on it. The event's name, dates and venue greet them on the left. Here they sign in with Discord. Before the installer has switched Discord on, the card says so and offers the first-run code instead. Mockup: sheet 3.

#### O65 · Signed in, no role yet
![Sign-in page saying the person has no role yet](step3-screenshot-book/o65-sign-in-no-role.png)

Someone signed in with Discord, but an owner has not given them a role yet. Here that is Player Zero, the stack's session without a role. They do not get a page they may not open. Instead they see:
- who they are signed in as;
- that an event owner can now see them under People and give them a role;
- Check again, and Sign in as someone else.

Mockup: sheet 3.

#### O66 · Signed out
![You were signed out page](step3-screenshot-book/o66-sign-in-signed-out.png)

A session ends after 4 hours without use, or after 24 hours in all. The next page an organiser opens says so, says that nothing they saved is lost, and offers Sign in again. Mockup: sheets 3 and 8.

#### O90 · Sign-in after the event
![Sign-in page of an archived event](step3-screenshot-book/o90-sign-in-archived.png)

Once an event is archived, its front door shows its dates with an Archived badge. It asks organisers to sign in to look back, for example to copy last year's run of show. Mockup: sheet 3.

#### O2 · Settings
![Settings page](step3-screenshot-book/o02-settings.png)

An event admin sets the event up and comes back when something should behave differently. There is one row per part (General, Run of show, Games, Notifications, Screens), each with its current values and when it last changed. A row opens that part's settings. Mockup: sheets 2 and 4.

#### O3 · Settings at 1440 px
![Settings page at 1440 px with Last changes](step3-screenshot-book/o03-settings-wide.png)

On a wide screen, Last changes stands beside the list: who changed what across every part, newest first. An admin uses it, for example, to see when a screen setting changed during the event. Mockup: sheets 2 and 4.

#### O4 · Settings of one part (General)
![General settings form](step3-screenshot-book/o04-settings-admin.png)

The admin changes the event's time zone or language before the event and saves. Every page and screen follows. Mockup: sheet 4.

#### O73 · Settings of one part (Screens)
![Screens settings form](step3-screenshot-book/o73-settings-screen.png)

The Screens part in three groups:
- **Playing:** the minimum gap between breaks, the ticker's look, progress bars, and the slow layout shift against burn-in.
- **Motion:** the event's energy level, Follow the day, and whether a hot game's art shows on the stage.
- **When the network is slow:** the heartbeat, after how long a screen counts as offline, how long to wait for content, and the asset shown when content is late.

An admin sets these before the event and rarely touches them again. Mockup: sheet 4.

#### O74 · Settings, a change not saved
![Screens settings with one change and the save bar](step3-screenshot-book/o74-settings-screen-change.png)

The admin changes Screen offline after from 60 to 30 s. The field says "Was 60.", and the save bar at the foot counts "1 change not saved" with Undo and Save. Mockup: sheet 4.

#### O75 · Settings, a value out of range
![Screens settings with a value out of range](step3-screenshot-book/o75-settings-screen-invalid.png)

A value out of range (3 s) is marked in place with the allowed range, and the bar says "1 field needs fixing before you can save". Mockup: sheet 4.

#### O76 · Settings, couldn't save
![Screens settings after a save that did not reach the platform](step3-screenshot-book/o76-settings-screen-failed.png)

When a save never reaches the platform, a banner says "Couldn't save", the change stays in the form, and the bar offers Save again. Mockup: sheet 4.

#### O5 · Health
![Health page](step3-screenshot-book/o05-health-view.png)

An admin or the installer checks that every part of the platform runs, with its version, answer time and log name. They do it when something looks wrong or after an update. Check now asks again. Mockup: sheet 4.

#### O67 · Health with a part down
![Health page with Notifications down](step3-screenshot-book/o67-health-view-trouble.png)

When a part stops (for this shot the stack stops notify), Health counts it as down. Its row says what that means: no answer since 14:24, and messages wait and go out when it is back. What to check is there for whoever runs the platform. The Health item in the menu shows "1 down". The page swaps in each new check without reloading. Mockup: sheet 4.

#### O68 · The Health note on another page
![Run of show with the menu's Health item saying 1 down](step3-screenshot-book/o68-agenda-trouble.png)

The same "1 down" note stands on the Health item in the menu of every organiser page, here Run of show. An organiser busy elsewhere sees that something is wrong and where to look. The note clears by itself when the part is back. Mockup: sheet 2.

#### O6 · Event profile
![Event profile page](step3-screenshot-book/o06-profile.png)

An admin can:
- save the whole event (name, modules, settings and look) as one file, by download or to the event folder;
- replace the event's setup from a profile, for example to start next year's event from this one's. The replace actions are red and ask first.

Mockup: sheet 4.

#### O77 · Event profile, load again
![Load the Demo Event profile again, asking first](step3-screenshot-book/o77-profile-load-ask.png)

Load the profile again… asks first. It lists what is replaced (every setting and the theme), what is kept (the run of show, people and their roles) and that there is no undo. It offers Download current profile before Replace settings and look. Mockup: sheet 4.

#### O78 · Event profile, upload a profile
![Upload a profile, asking first](step3-screenshot-book/o78-profile-upload-ask.png)

Upload a profile… asks the same before it takes a zip with `profile.yaml` and its assets, as Download makes it. Mockup: sheet 4.

#### O7 · People, only you
![People page with only the owner](step3-screenshot-book/o07-people.png)

The owner hands out roles to the people who have signed in. Before anyone else has signed in, the page says "Only you so far" and offers Copy the sign-in link to send to the crew. Mockup: sheet 4.

#### O69 · People, forty people
![People page with 40 people and their roles](step3-screenshot-book/o69-people-many.png)

With the crew signed in, the page has a search, the filters All · No role yet · Admin with their counts, and one row per person. Each row has their role as two buttons (No role, Admin), when they were last here, and Remove…. A long display name is cut with an ellipsis. Mockup: sheet 4.

#### O70 · People, a search
![People page filtered to people with no role](step3-screenshot-book/o70-people-search.png)

Typing in the search with No role yet chosen narrows the list to the people still waiting for a role, the ones the owner looks for when the crew arrives. Mockup: sheet 4.

#### O71 · People, a role changed
![People page after giving Player 1 the Admin role](step3-screenshot-book/o71-people-changed.png)

After a role change, a note on top says "Player 1 is now an Admin", what an admin may open, and offers Undo. Mockup: sheet 4.

#### O72 · Remove a person
![Remove Player 2, asking first](step3-screenshot-book/o72-people-remove.png)

Remove… asks first. The person is signed out at once and loses their role. Their past changes stay in the history, and they can sign in again and ask for a role. Mockup: sheet 4.

#### O8 · Not found
![Not found page in the shell](step3-screenshot-book/o08-error-not-found.png)

Anyone who follows an old or cut-short link lands here, inside the shell, with one way on: Open Run of show. Mockup: sheet 8.

#### O9 · Run of show, empty
![Run of show, empty day](step3-screenshot-book/o09-agenda-empty.png)

An organiser opens the run of show for the first time when planning the event. Nothing is on the day yet, and the page offers Add the first item, Full form and Quick add. Mockup: sheet 5.

#### O10 · Run of show, the day
![Run of show, the day with Dinner on now](step3-screenshot-book/o10-agenda.png)

During the event the organiser keeps this page open:
- **On top:** what is on now (Dinner, 10 min late), with Delay by +5/+10/+15/Other… and Show on screens now.
- **Below:** the day with the now line. Each item shows its time, its old time when it moved, where and for whom. The earlier items fold into one line.

Day chips switch days, the audience menu filters, and Jump to now scrolls back. Mockup: sheet 5, mockup 11.

#### O80 · Run of show, earlier items shown
![Run of show with the earlier items unfolded](step3-screenshot-book/o80-agenda-earlier.png)

Show on the folded line brings back the day's earlier items (doors, the opening ceremony, the group stage), so the organiser can check what already happened. Mockup: sheet 5.

#### O79 · Run of show, adding in a gap
![Run of show with Add between 13:45 and 15:30 on the now line](step3-screenshot-book/o79-agenda-gap.png)

Between two items the day offers "Add between 13:45 and 15:30". The organiser fills a gap in the day without typing times. Mockup: sheet 5.

#### O11 · Run of show at 1440 px
![Run of show at 1440 px with the live miniature and a selected item](step3-screenshot-book/o11-agenda-wide.png)

On a wide screen the now card also shows what people see: a live miniature of the main zone, and what Discord got. Picking an item opens it beside the day. The organiser can delay it, push it to screens, edit or cancel it without leaving the day. Mockup: sheet 5, mockup 11.

#### O12 · An item beside the day
![Run of show with an item panel open at 1280 px](step3-screenshot-book/o12-agenda-item.png)

At 1280 px the item opens as a panel over the day. It shows:
- when and where, and the channels people were told on;
- quick delays, On screens now, and Edit or move;
- its changes, and Cancel this item….

The organiser uses it to answer "what happened to the semi-final?" and act on it. Mockup: sheet 5.

#### O13 · Delay confirm over the day
![Delay confirmation dialog over the day](step3-screenshot-book/o13-agenda-delay.png)

After the organiser taps a delay chip, this asks before anything changes:
- whether to move the items after it too;
- whether to tell people;
- what each choice does on screens, Discord and phones, and which items will overlap.

Mockup: sheet 5, mockup 11.

#### O14 · Delay page, moving the items after it
![Delay page with following items moved and people told](step3-screenshot-book/o14-agenda-delay-following.png)

The full Delay page opens from Other… or a link. It takes any number of minutes (negative brings the item forward); here the items after it move too and people are told. The summary lists each item's new time and who gets which message. Mockup: sheet 5, mockup 11.

#### O15 · Delay page, quietly
![Delay page, quiet delay](step3-screenshot-book/o15-agenda-delay-quiet.png)

The same delay for a typo-sized fix: nothing else moves and nobody is told. The screens and the hub still show the new time. Mockup: sheet 5.

#### O81 · Delay page, an overlap
![Delay page warning that a following item now overlaps](step3-screenshot-book/o81-agenda-delay-overlap.png)

A 30 min delay without moving the items after it: the summary warns that Board games corner now overlaps it by 15 min. The organiser can decide to move the following items too before confirming. Mockup: sheet 5.

#### O82 · Cancel an item
![Cancel the semi-final, asking first](step3-screenshot-book/o82-agenda-cancel.png)

Cancel this item… asks first and lists what happens:
- the item stays on the run of show, struck through;
- screens show a notice within a second, Discord gets a post, and phones get a notice;
- Bring back undoes it until the event ends.

Mockup: sheet 5.

#### O83 · A cancelled item
![A cancelled item with Bring back](step3-screenshot-book/o83-agenda-bring-back.png)

A cancelled item (Raffle) opened from the day shows its Cancelled badge, its details and changes, and Bring back. Mockup: sheet 5.

#### O16 · New item
![New item form](step3-screenshot-book/o16-agenda-new-item.png)

An organiser plans the programme before the event, one item at a time. The form asks for:
- title, kind, start and end, and who sees it;
- where, and which screen zone shows it first;
- reminders and channels.

The organiser can also start from a template (Food, Ceremony, Game session). Mockup: sheet 5.

#### O17 · Edit an item
![Edit item form](step3-screenshot-book/o17-agenda-edit.png)

The organiser corrects or moves an item. At the foot, Tell people decides whether the change is announced or a quiet fix. Mockup: sheet 5.

#### O91 · Run of show after the event
![Run of show of an archived event, read only](step3-screenshot-book/o91-agenda-archived.png)

In an archived event the run of show is read only. A banner says the event has ended, and an item's panel says it can't be delayed, edited or cancelled. Organisers open it to look back. Mockup: sheet 5.

#### O18 · Notifications, no topics
![Notifications topics page, empty](step3-screenshot-book/o18-notify-topics.png)

An organiser sets up the topics attendees can follow. In the demo event no module that sends notifications is switched on, so the page says topics appear when one is. Mockup: sheet 2 (shell); no sheet of its own.

#### O19 · New topic, nothing to base it on
![New topic page, nothing to base a topic on](step3-screenshot-book/o19-notify-new-topic.png)

The organiser tries to add a topic. With no module offering one, the page explains why and offers Back. Mockup: sheet 2 (shell), sheet 8's empty-state pattern.

#### O20 · Theme studio, no draft
![Theme studio brand kit with no draft](step3-screenshot-book/o20-studio.png)

An event admin gives the event its look, usually weeks before. With no draft, the screens show the published theme. The admin starts a draft from the current theme or from a platform theme (Default, Terminal, Level-up). The previews show the real venue screen, the phone hub, the organiser pages and Discord. Mockup: sheet 6, mockup 12.

#### O21 · Theme studio, a draft
![Theme studio brand kit with a draft: logo and two colours](step3-screenshot-book/o21-studio-draft.png)

The admin uploads a logo and picks a primary and an accent colour, a scheme, a Discord colour and a font. Every preview changes at once. Before anything goes live:
- "Ready to publish: all text reads clearly on every surface" checks the contrast;
- Preview on a screen… tries the draft on one real screen (O85).

Publish makes the draft live on every screen without a reload. Discard draft… asks first. Mockup: sheet 6, mockup 12.

#### O84 · Theme studio, publishing a light draft
![Publish asking about a light look on venue screens](step3-screenshot-book/o84-studio-draft-light.png)

When the admin publishes a light draft, the Studio asks first. In a dark hall a light screen is bright and tiring, and it lights the room. Phones and organiser pages are fine. The admin can Keep editing or Publish as it is. Mockup: sheets 6 and 9.

#### O85 · Theme studio, preview on a screen
![Preview the draft on a screen dialog](step3-screenshot-book/o85-studio-screen-dialog.png)

The admin picks one real screen (Entrance or Hall left, each with its zone and whether it is online) and for how long: 2 min, 5 min or until they end it. Only that screen shows the draft, with a "Preview" mark (R49), and it goes back to the published theme by itself. Mockup: sheet 6.

#### O86 · Theme studio, previewing on a screen
![Theme studio while a preview runs on Hall left](step3-screenshot-book/o86-studio-screen-notice.png)

While the preview runs, a note on top says which screen shows the draft and how long is left, with End preview. Here the publish check also has one thing to check: no module offers the announcements widget, so its region shows nothing. Mockup: sheet 6.

#### O22 · Theme studio, preview at full size
![Theme studio, the draft's screen preview at full size](step3-screenshot-book/o22-studio-draft-preview.png)

The admin judges the draft on the real player at full size, zone by zone, before publishing. Mockup: sheet 6, mockup 12.

#### O23 · Theme studio, Advanced with a draft
![Theme studio Advanced page with a draft](step3-screenshot-book/o23-studio-draft-advanced.png)

A designer or a technical admin goes past the brand kit. The page has:
- the publish check;
- a theme package upload;
- the draft's files;
- every token: colours, fonts, sizes, and the motion style (speed, intensity, spotlight, motion pack).

Mockup: sheets 6 and 11.

#### O24 · Theme studio, Advanced with no draft
![Theme studio Advanced page with no draft](step3-screenshot-book/o24-studio-advanced.png)

The same page before a draft exists: only the package upload, which starts a draft from a whole theme. Mockup: sheet 6.

#### O25 · Theme studio, History
![Theme studio History, nothing published](step3-screenshot-book/o25-studio-history.png)

The admin looks back at what was published and when. Here nothing is published yet, so the screens show the platform's default look. Mockup: sheet 6.

#### O26 · Screen studio, Live
![Screen studio Live with two zone miniatures](step3-screenshot-book/o26-screen-live.png)

During the event the organiser sees what every zone shows right now, as live miniatures, with how many of its screens are online. A tap opens the zone. Set the ticker and Pair a screen are one tap away. Here Entrance shows its check-in QR and Main hall the Pulse. Mockups: 07 and 13.

#### O27 · Screen studio, Devices
![Screen studio Devices](step3-screenshot-book/o27-screen-devices.png)

The organiser or crew lead checks the fleet:
- **On top:** a summary line (how many screens, online and offline, and the player bundle they run).
- **For each screen:** its live miniature, online dot, zone, sound, orientation and size, what it shows now, when it was last seen and whether it is up to date, with Identify, Reload and Assign.

Clear open codes drops pairing codes nobody used. Mockup: mockup 07.

#### O28 · Devices at 1440 px
![Screen studio Devices at 1440 px with Recent](step3-screenshot-book/o28-screen-devices-wide.png)

On a wide screen, Recent stands beside the screens: pairings and screens going offline, newest first. The crew lead sees which screen dropped and when without opening each one. Mockup: mockup 07.

#### O29 · Zones and layouts
![Screen studio zones list, new zone form and Motion](step3-screenshot-book/o29-screen-zones.png)

Before the event the organiser groups screens into zones (a zone shows one thing on all its screens). A new zone needs a name and a key the run of show uses.

Below, Motion sets how lively the screens move:
- the event's level: None, Calm, Lively or Party;
- Follow the day: calmer at doors and wind-down, livelier at the peak;
- a level per zone;
- the theme's spotlight, speed and motion pack.

A line says what each zone is now and when it changes. Mockup: mockup 08, sheets 10 and 11.

#### O30 · Zone editor, the Pulse
![Zone editor for Main hall with the Pulse layout](step3-screenshot-book/o30-screen-zone-editor.png)

The organiser composes what Main hall shows:
1. **Layout:** picks one of the seven built-ins from the gallery. Dashboard, Ambient and Portrait say their statistics come with the bot's data.
2. **Boxes:** clicks a box to choose its widgets and their order. In the hero they take turns under the Director, with a thin line as the turn indicator (R57–R64). The box also sets what shows when all its widgets are empty, and the photo wall's pace and order.
3. **The zone:** sets the header, the hub QR and the sound.
4. **Preview:** checks the real player at a chosen time, here or on one screen (O87), before going live.

Changes lists what will change. Undo stays for 10 minutes after going live. Mockup: mockup 08, sheets 10 and 13.

#### O88 · Zone editor, the header's screen name
![Zone editor with the header selected and its screen name changed](step3-screenshot-book/o88-screen-zone-screen-name.png)

A click on the header box selects it. Here the zone's name in the header changes from Automatic (hidden when the event has one screen, R44) to Always, and Changes lists it. Mockup: sheets 10 and 16.

#### O89 · Zone editor, the photo wall
![Zone editor with the hero's photo wall settings changed](step3-screenshot-book/o89-screen-zone-photo-wall.png)

The hero's photo wall (R11) is changed to 12 seconds per photo, in shuffle order instead of newest first, and Changes lists both. Mockup: sheet 16.

#### O31 · Zone editor, boxes resized and one hidden
![Zone editor with resized boxes and the Venue card hidden](step3-screenshot-book/o31-screen-zone-boxes.png)

The organiser drags a box's handles, or uses Narrower/Wider/Shorter/Taller, to give the side rail more room. They also hide the Venue card. Its space goes to the boxes beside it, and it waits under Hidden boxes with Show Venue card to bring it back. Changes names each change before Go live, and Reset to the built-in layout… undoes them all. Mockup: mockup 08, sheet 10.

#### O56 · Zone editor, a resize leaves a gap
![Zone editor warning that a column between the hero and the side rail is empty](step3-screenshot-book/o56-screen-zone-gap.png)

The organiser resizes the boxes and leaves one column between the hero and the side rail uncovered:
- the column is shaded on the map;
- Changes warns "1 column between Hero and Side rail is empty";
- Fill the gap grows the box beside the gap into the space.

The organiser can still go live with the gap. Mockup: mockup 08, sheet 10; no mockup draws the warning (#422).

#### O57 · Zone editor, a saved layout with a gap
![Zone editor opening on a saved layout with an empty column](step3-screenshot-book/o57-screen-zone-gap-saved.png)

The same warning appears when the zone's saved layout already has a gap, for example from an earlier edit. Here it names the gap beside the Venue card too. Nothing has changed yet, so Go live waits, and Fill the gap turns the fix into a change to go live. Mockup: mockup 08, sheet 10; no mockup draws the warning (#422).

#### O32 · Zone editor, the Dashboard
![Zone editor with the Dashboard layout and the hero role](step3-screenshot-book/o32-screen-zone-dashboard.png)

The organiser switches Main hall to the Dashboard. Its boxes are the hero, Online (activity graph), In voice (voice rooms), Top games (now playing), Right now and the side rail. A note says the statistics come with the bot's data. Until the data arrives, those boxes give their space to the boxes beside them on the screens (R43).

Below the boxes:
- Which box is the hero? moves the hero role with a click.
- Grow for a showcase decides whether the hero grows when something is showcased (R9).

Mockup: sheet 10 (README change 1).

#### O87 · Zone editor, previewing on a screen
![Zone editor while a preview runs on Hall left](step3-screenshot-book/o87-screen-zone-preview-notice.png)

Preview on a screen… in the zone editor shows the unsaved change on one screen, here Hall left with 4:58 left. Every other screen keeps the live zone, and End preview stops it. R49 is what that screen shows. Mockup: mockup 08.

#### O33 · Content
![Screen studio Content: assets and push now](step3-screenshot-book/o33-screen-content.png)

Before and during the event the organiser drops in images, videos, slide decks and sounds, or links a web page or YouTube video, within the event's storage quota:
- each asset shows its kind, size and use, with Replace and Delete;
- a deck shows its rendered slides and warns of a stand-in font;
- Push now plays something on chosen zones until a set time.

Mockup: mockup 10.

#### O34 · Content with a playlist, at 1920 px
![Screen studio Content with the playlist editor open](step3-screenshot-book/o34-screen-content-playlist.png)

The organiser builds a playlist from the assets: slides per deck, seconds per image, a video at its own length. They see its run order and push it to every zone now. Playing now shows what is pushed and until when. Mockup: mockup 10.

#### O35 · Schedule, one zone
![Screen studio Schedule for one zone](step3-screenshot-book/o35-screen-schedule.png)

The organiser plans what each zone's playlist widget plays on the event's days:
- **The calendar:** windows per day with the now line, and the breaks that interrupt them.
- **Beside it:** Now says what plays and what comes next. What plays at… answers for any time (O59). Conflicts and gaps lists, for example, hours with no window.

Add window, or a drag on a day, adds a window (O58). A drag moves a window or changes its end, and a tap shows its details. Mockup: mockup 09.

#### O58 · Schedule, a new window
![Schedule's window editor dialog over the calendar](step3-screenshot-book/o58-screen-schedule-editor.png)

The organiser adds a window with Add window or a drag on a day. The window has:
- the zone and the playlist;
- a priority, 0 to 999 (where windows overlap, the higher plays);
- a layout: the zone's own or another;
- when it plays: every week on chosen days, from and until, or while a run-of-show item runs.

Saving checks that nobody else changed the window meanwhile. Mockup: mockup 09.

#### O59 · Schedule, what plays at…
![Schedule's What plays at… answer for Main hall at 19:20](step3-screenshot-book/o59-screen-schedule-at.png)

Someone asks "what will the hall show during dinner?", or the organiser checks before the event. They pick a day, a time and a zone, and the answer says box by box what plays: the hero's playlist and its item, the rail's now and next, the ticker's line. It also says:
- which window wins and why;
- how a run-of-show delay moved things;
- the next break and the next change.

A link opens it on a virtual screen. Mockup: mockup 09.

#### O36 · Schedule, all zones
![Screen studio Schedule across all zones](step3-screenshot-book/o36-screen-schedule-all-zones.png)

The same plan for every zone side by side. A window that loses to a higher priority is greyed. Now, Breaks, and Conflicts and gaps list each zone under its name, one line per conflict. Mockup: mockup 09.

#### O37 · Ticker
![Screen studio Ticker](step3-screenshot-book/o37-screen-ticker.png)

An organiser or crew member sets the one calm line across the bottom of every screen. It runs for 15 min, 1 h or 4 h, until a time, or with no end, and they can clear it. Mockup: mockup 13.

#### O53 · Pins
![Screen studio Pins, nothing pinned](step3-screenshot-book/o53-screen-pins.png)

An event admin checks which player bundle and theme revision every screen draws (In effect), and whether the screens follow the platform version and the published theme or are held (Pinned). Shortly before the doors open, Freeze for the event holds both until the event ends, so no update or publish changes the screens mid-event. The freeze ends by itself. Here nothing is pinned yet. Mockup: none draws it; the step 3 brief's operations item O5 ("freeze for the event") asks for it, in sheet 2's shell.

#### O54 · Pins, frozen
![Screen studio Pins while the screens are frozen](step3-screenshot-book/o54-screen-pins-frozen.png)

After the freeze:
- a banner says the screens are frozen, what is held, until when and by whom;
- Pinned lists the held bundle and theme revision, the end, and what follows afterwards;
- Unfreeze puts back what was pinned before the freeze.

The demo stack freezes for an hour. Mockup: none draws it; the step 3 brief's operations item O5 ("freeze for the event") asks for it, in sheet 2's shell.

#### O55 · Live, frozen
![Screen studio Live with the frozen banner](step3-screenshot-book/o55-screen-live-frozen.png)

While a freeze holds, the same banner stands on every Screen studio page, here Live. Whoever runs the screens during the event knows that a new theme or update will not reach them until it ends. Mockup: mockups 07 and 13, with O54's banner.

#### O92 · Screen studio after the event
![Screen studio of an archived event, read only](step3-screenshot-book/o92-screen-studio-archived.png)

In an archived event a note says nothing in the Screen studio can be changed. The archived demo event never had zones, so the list is empty; Motion still shows the event's settings. Mockup: none draws the archived Studio; sheet 2's shell.

### Organiser on a phone

#### O38 · Settings
![Settings on a phone](step3-screenshot-book/o38-settings-phone.png)

An admin checks or changes a setting on the floor. Each part is one row, with its name, what it covers and its current values stacked. Mockup: sheets 2 and 4.

#### O39 · Health
![Health on a phone](step3-screenshot-book/o39-health-view-phone.png)

An admin checks that every part runs when someone reports a problem on the floor. Mockup: sheet 4.

#### O95 · Health with a part down
![Health on a phone with Notifications down](step3-screenshot-book/o95-health-view-trouble-phone.png)

The part that is down and its What to check, in the phone's narrower table. Mockup: sheet 4.

#### O40 · Event profile
![Event profile on a phone](step3-screenshot-book/o40-profile-phone.png)

Saving or replacing the profile. It is rarely done on a phone, but the page is there. Mockup: sheet 4.

#### O41 · People
![People on a phone, only the owner](step3-screenshot-book/o41-people-phone.png)

Before the crew has signed in: "Only you so far" and Copy the sign-in link, so the owner can send the link from the floor. Mockup: sheet 4.

#### O93 · People, forty people
![People on a phone with 40 people](step3-screenshot-book/o93-people-many-phone.png)

The list in one column: each person with their role on the right, the search and the filters above. A tap opens the person (O94). Mockup: sheet 4.

#### O94 · A person
![A person's page on a phone](step3-screenshot-book/o94-people-person-phone.png)

The owner gives a newly signed-in crew member a role while standing next to them. The page shows:
- the person's name, username and when they were last here (a long name wraps);
- their role as No role / Admin, with what an admin may open;
- Remove from Demo Event….

Mockup: sheet 4.

#### O42 · Notifications
![Notifications topics on a phone](step3-screenshot-book/o42-notify-topics-phone.png)

The topics page in one column. Mockup: sheet 2.

#### O43 · Theme studio, no draft
![Theme studio on a phone, no draft](step3-screenshot-book/o43-studio-phone.png)

The admin checks the look on the go. The venue screen preview is on top, and a tap opens it full size. The Screen/Phone/Pages/Discord switch replaces the desktop's four previews. Mockup: sheet 6, mockup 12.

#### O44 · Theme studio, a draft
![Theme studio on a phone with a draft](step3-screenshot-book/o44-studio-draft-phone.png)

The brand kit in one column under the preview: logo, colours, scheme, Discord colour and font. Mockup: sheet 6, mockup 12.

#### O45 · Zones
![Zones on a phone](step3-screenshot-book/o45-screen-zones-phone.png)

The zone list, the new-zone form and Motion in one column. Mockups: 08 and 13, sheet 11.

#### O46 · Zone editor
![Zone editor on a phone](step3-screenshot-book/o46-screen-zone-editor-phone.png)

The whole zone editor in one column: the layout gallery, the boxes, the selected box and the zone's settings, then the preview and the change list at the foot. Mockup: mockup 08.

#### O47 · Zone editor, boxes resized
![Zone editor on a phone with resized boxes](step3-screenshot-book/o47-screen-zone-boxes-phone.png)

Resizing and hiding boxes on a phone, with the same buttons as at the desk. Mockup: mockup 08.

#### O62 · Zone editor, a gap
![Zone editor on a phone with the gap warning](step3-screenshot-book/o62-screen-zone-gap-phone.png)

The shaded gap on the box map. The warning and Fill the gap sit in the change list at the foot of the one-column editor. Mockup: mockup 08; no mockup draws the warning (#422).

#### O48 · Content
![Content on a phone](step3-screenshot-book/o48-screen-content-phone.png)

Assets and Push now in one column, for pushing something from the floor. Mockups: 10 and 13.

#### O49 · Content with a playlist
![Content on a phone with the playlist editor](step3-screenshot-book/o49-screen-content-playlist-phone.png)

The playlist editor in one column, under the asset library. Mockup: mockup 10.

#### O50 · Schedule
![Schedule on a phone](step3-screenshot-book/o50-screen-schedule-phone.png)

One zone and one day at a time, with breaks and conflicts below. Mockup: mockup 09.

#### O51 · Schedule, a window's details
![Schedule on a phone with a window's details](step3-screenshot-book/o51-screen-schedule-details-phone.png)

A tap on a window shows its playlist, time and priority, with Edit window. Mockup: mockup 09.

#### O63 · Schedule, editing a window
![Window editor on a phone](step3-screenshot-book/o63-screen-schedule-editor-phone.png)

Edit window opens the same editor as a full-height sheet, here for the Welcome loop window, with Delete window… at its foot. Mockup: mockup 09.

#### O64 · Schedule, what plays at…
![Schedule on a phone with What plays at…](step3-screenshot-book/o64-screen-schedule-at-phone.png)

What plays at… under the day's calendar, to answer a crew member's question on the spot. Mockup: mockup 09.

#### O60 · Pins
![Pins on a phone](step3-screenshot-book/o60-screen-pins-phone.png)

The Pins page in one column, so an admin can freeze the screens from the floor. Mockup: none draws it; the step 3 brief's operations item O5 ("freeze for the event") asks for it, in sheet 2's shell.

#### O61 · Pins, frozen
![Pins on a phone while frozen](step3-screenshot-book/o61-screen-pins-frozen-phone.png)

The frozen banner, what is held, and Unfreeze, in one column. Mockup: none draws it; the step 3 brief's operations item O5 ("freeze for the event") asks for it, in sheet 2's shell.

#### O52 · Not found
![Not found on a phone](step3-screenshot-book/o52-error-not-found-phone.png)

The error page with the bottom bar. Mockup: sheet 8.

#### O96 · You're offline
![You're offline page on a phone](step3-screenshot-book/o96-offline-phone.png)

The organiser's phone loses its connection on the floor. The page says the phone is offline and that nothing is wrong with the event. It loads by itself when the phone is back online, or with Try again. Mockup: sheet 8.

## The crew

The crew works on the floor with a phone in hand. They keep the run of show honest, get screens working and set the ticker. The Screen studio on a phone is their "crew remote" (mockup 13): the same pages in one column with big targets. At a screen, the kiosk frames tell them what is wrong and what to do.

### On a phone

#### C1 · Sign-in
![Sign-in on a phone](step3-screenshot-book/c01-sign-in-phone.png)

A crew member opens the event's address on their phone at the start of a shift and signs in. Mockup: sheet 3.

#### C19 · No role yet
![No role yet on a phone](step3-screenshot-book/c19-sign-in-no-role-phone.png)

A crew member signs in before the owner has given them a role. On any page, the run of show included, they land here: who they are signed in as, that they should ask an event owner, Check again, and Sign in as someone else. The run of show's address answers with this same page, so the book shows it once. Mockup: sheet 3.

#### C2 · Run of show
![Run of show on a phone](step3-screenshot-book/c02-agenda-phone.png)

The crew checks what is on now and next, and delays the current item with one tap when it runs late. Items are rows with time, where and kind. The now line and the late badges show at a glance. Mockup: sheet 5, mockup 11.

#### C20 · Run of show, scrolled
![Run of show on a phone with the on-now strip on top](step3-screenshot-book/c20-agenda-strip-phone.png)

When the crew scrolls the day, a strip on top keeps "On now: Dinner · until 15:10" with its delay, and Now scrolls back. Mockup: sheet 5.

#### C3 · An item
![An item's sheet on a phone](step3-screenshot-book/c03-agenda-item-phone.png)

A tap on an item opens it as a sheet: when and where, the channels people were told on, quick delays, On screens now, Edit or move, its changes, and Cancel. Mockup: sheet 5.

#### C4 · Delay confirm
![Delay confirm on a phone](step3-screenshot-book/c04-agenda-delay-phone.png)

The delay's confirm as a bottom sheet, with the same choices and summary as at the desk and full-width buttons. Mockup: sheet 5, mockup 11.

#### C5 · Quick add
![Quick add on a phone](step3-screenshot-book/c05-agenda-quick-add-phone.png)

Something unplanned happens: food arrives, a session starts. The crew adds it in seconds with:
- a kind chip and a title;
- the day;
- Now, In 30 min or At;
- a place and a length.

Mockup: sheet 5.

#### C21 · Quick add after midnight
![Quick add on a phone for 00:30, picking the next day](step3-screenshot-book/c21-agenda-quick-add-night-phone.png)

Late in the evening, a crew member adds something at 00:30. Quick add picks the next day itself and says so, so a late addition does not land a day early. The button reads "Add on Sun at 00:30". Mockup: sheet 5.

#### C6 · Screen studio, Live
![Screen studio Live on a phone](step3-screenshot-book/c06-screen-live-phone.png)

The crew checks from anywhere in the venue what every zone shows. Quick actions below the zones delay what's on now, set the ticker or push content. Mockup: mockup 13.

#### C7 · Devices
![Devices on a phone](step3-screenshot-book/c07-screen-devices-phone.png)

A crew member standing at a screen finds it in the list, then identifies it, reloads it or assigns it to a zone. Mockups: 07 and 13.

#### C8 · Pair a screen
![Pair dialog on a phone](step3-screenshot-book/c08-screen-pair-phone.png)

A crew member opens this with Pair a screen, or from the kiosk's pairing link with the code already filled in. They:
1. enter the 8 characters a new screen shows (C10);
2. name the screen;
3. pick a zone, or choose later.

A new screen plays in under a minute. Mockups: 06 and 17.

#### C9 · Ticker
![Ticker on a phone](step3-screenshot-book/c09-screen-ticker-phone.png)

The crew puts a line on every screen ("Pizza orders close at 20:00") from the floor. Mockup: mockup 13.

### At the kiosk

These frames show on the screen itself, before or instead of the event's content. They speak to the crew who set it up.

#### C10 · Pairing
![Pairing frame, 1080p](step3-screenshot-book/c10-default-pairing-1920x1080.jpg)

A new screen shows this the first time it opens the event's screen address: its code, large, and how long the code lasts. An organiser pairs it with the code (C8). Mockups: 05 and 06, sheet 9.

#### C11 · Pairing, portrait
![Pairing frame, portrait](step3-screenshot-book/c11-default-pairing-1080x1920.jpg)

The same on a portrait screen. Mockup: mockup 05, sheet 9.

#### C12 · Paired, waiting for a zone
![Paired but not assigned frame](step3-screenshot-book/c12-default-unassigned-1920x1080.jpg)

A screen that is paired but has no zone shows its name and says an organiser assigns it. It starts by itself. Mockup: mockup 05, sheet 9.

#### C13 · Kiosk check
![Kiosk check frame](step3-screenshot-book/c13-default-check-1920x1080.jpg)

The crew installing a kiosk opens this check. It shows whether the screen size, clock, pairing, sound, offline mode and player version are right, and how to fix what is not (for example, sound blocked until a tap). Mockup: sheet 9; the kiosk guide [docs/screen-kiosk.md](../screen-kiosk.md).

#### C14 · Identify
![Identify card over the Pulse](step3-screenshot-book/c14-default-identify-1920x1080.jpg)

When the crew taps Identify on Devices, the screen shows its name, zone and version for 15 s, so they know which physical screen is which. Mockup: mockup 05, sheet 9.

#### C15 · Identify, portrait
![Identify card on a portrait screen](step3-screenshot-book/c15-default-identify-1080x1920.jpg)

The same on the portrait Entrance screen. Mockups: 03 and 05.

#### C16 · Not at the venue
![Refused frame: not at the venue](step3-screenshot-book/c16-default-refused-1920x1080.jpg)

A screen outside the venue's network is refused and shows nothing of the event. It tells the crew to check the uplink or ask about the emergency switch, and it tries again every 30 s. Mockup: mockup 05, sheet 9.

#### C17 · No connection yet
![Unreachable frame](step3-screenshot-book/c17-default-unreachable-1920x1080.jpg)

A screen that has never reached the event (cable, Wi-Fi) says so and keeps trying. Mockups: 05 and 16, sheet 9.

#### C18 · Moved
![Moved frame](step3-screenshot-book/c18-default-moved-1920x1080.jpg)

After the platform admin moves the venue's screens to the next event, a screen shows this and takes itself there. The crew can update the kiosk's start address later. Mockups: 05 and 15, sheet 9.

## The attendee

Attendees mostly meet the event on the screens (see [the room](#the-room)). On their phone, step 3 has check-in in all its states; the hub's own pages are the App track's. Every check-in page puts the event up front and gives one task per page.

#### A1 · Check in
![Check-in page on a phone, signed in](step3-screenshot-book/a01-check-in-phone.png)

An attendee arriving at the venue scans the QR on the entrance screen (R5) and lands here. Already signed in, they check in with one tap. A line says check-in is optional. Mockup: sheet 7, mockup 14.

#### A3 · Check in, first time
![Check-in page on a phone, not signed in](step3-screenshot-book/a03-check-in-sign-in-phone.png)

An attendee who has never signed in signs in with Discord once. After that, checking in is one tap. Mockup: sheet 7, mockup 14.

#### A4 · Checked in
![You're checked in, with the Wi-Fi and what is on now](step3-screenshot-book/a04-check-in-done-phone.png)

After the tap the page welcomes them, says when they checked in, and gives what they need next: the guest and attendee Wi-Fi networks (with Show password) and what is on now. Mockup: sheet 7, mockup 14.

#### A5 · Already checked in
![You're already checked in](step3-screenshot-book/a05-check-in-again-phone.png)

Scanning again later says they are already checked in, since when, and that there is nothing more to do, with the same Wi-Fi and now. Mockup: sheet 7.

#### A6 · Check in at the venue
![Check in at the venue, on the venue's Wi-Fi](step3-screenshot-book/a06-check-in-at-venue-phone.png)

An event that accepts check-ins only on its own network tells someone on mobile data to join the venue's Wi-Fi and scan the code on a screen again. Mockup: sheet 7.

#### A7 · Check-in not open yet
![Check-in opens on Tuesday](step3-screenshot-book/a07-check-in-not-open-phone.png)

Before the event, the page says when check-in opens and when the doors open. Mockup: sheet 7.

#### A8 · Check-in has closed
![Check-in has closed](step3-screenshot-book/a08-check-in-closed-phone.png)

After the event, the page thanks them for coming. Mockup: sheet 7.

#### A9 · The code has expired
![This code has expired](step3-screenshot-book/a09-check-in-expired-phone.png)

The code on the screen changes every 30 seconds. A photo of an old one says so and offers Scan again; the info desk can check them in by hand. Mockup: sheet 7, mockup 14.

#### A10 · Discord sign-in cancelled
![Discord sign-in was cancelled](step3-screenshot-book/a10-check-in-cancelled-phone.png)

The attendee closed Discord before sign-in finished. The page says they are not checked in yet and offers Try again with Discord. Mockup: sheet 7.

#### A11 · Couldn't check in
![Couldn't check you in](step3-screenshot-book/a11-check-in-unreachable-phone.png)

The phone did not reach the event, for example because it lost signal. The page says so and offers Try again. Mockup: sheets 7 and 8.

#### A12 · Privacy
![Privacy page on a phone](step3-screenshot-book/a12-privacy-phone.png)

The Privacy link at the foot of each page says what signing in and checking in keep and for how long. Mockup: sheet 7.

#### A2 · The phone hub, preview
![Phone hub preview from the Theme studio](step3-screenshot-book/a02-hub-preview-phone.png)

Not a page attendees open yet: the Theme studio's sample of the hub (what is on now, Turn on alerts), so the admin sees the brand kit on a phone. The real hub is the App track's. Mockup: sheet 6, mockup 12.

## The room

Everyone in the venue sees the screens: attendees in passing, from across the hall. The default layout is the Pulse (mockup 02):
- a header with the event's name, the zone and the clock;
- a large hero;
- a rail with now and next, and the Wi-Fi and hub card;
- the ticker.

Unless named, the images show the platform's default theme (Night).

### The Pulse at every size

#### R1 · Pulse, 1080p
![Pulse, 1920×1080](step3-screenshot-book/r01-default-pulse-1920x1080.jpg)

The main-hall screen all day shows:
- the next big thing (the semi-final, 15 min late) with a countdown;
- what is on now and next;
- how to get online and to the hub;
- the ticker.

People glance at it to know where to be and when. Mockup: mockup 02, sheet 9.

#### R2 · Pulse, 4K
![Pulse, 3840×2160, scaled down](step3-screenshot-book/r02-default-pulse-3840x2160.jpg)

The same screen on a 4K panel, scaled down here: the layout keeps its proportions. Mockup: mockup 02.

#### R3 · Pulse, 4K, 1:1 detail
![Pulse at 4K, top-left quarter at full resolution](step3-screenshot-book/r03-default-pulse-3840x2160-crop.jpg)

The top-left quarter of R2 at full resolution, to show how sharp the text is on a 4K screen. Mockup: mockup 02.

#### R4 · Pulse, portrait
![Pulse portrait, 1080×1920](step3-screenshot-book/r04-default-pulse-1080x1920.jpg)

A portrait screen in a corridor or café: the same content stacked, with a Right now box (check-ins so far). Mockup: mockup 03, sheet 9.

#### R5 · Entrance, portrait with the check-in QR
![Entrance zone, portrait, with the check-in QR in the hero](step3-screenshot-book/r05-default-entrance-1080x1920.jpg)

At the door, the Entrance zone's hero is the check-in QR, with its refresh bar, which leads to A1. Below it are now and the delayed item, Right now, Wi-Fi and the ticker. Mockups: 03 and 14.

#### R44 · Pulse at an event with one screen
![Pulse whose header leaves out the zone's name](step3-screenshot-book/r44-default-pulse-one-screen-1920x1080.jpg)

At an event with a single screen, the header leaves out the zone's name, because there is nothing to tell apart (the screen name's Automatic, O88). Mockup: sheets 9 and 16.

### The other layouts and widgets

#### R6 · Hero
![Hero layout](step3-screenshot-book/r06-default-hero-1920x1080.jpg)

One big message across the screen with a now/next strip at the foot. It suits a stage screen, where the next big moment matters most. Mockup: sheet 10.

#### R7 · Split
![Split layout](step3-screenshot-book/r07-default-split-1920x1080.jpg)

The hero and a two-card rail, for a screen that should carry both the main moment and practical info. Mockup: sheet 10.

#### R8 · Dashboard, with the bot's data
![Dashboard layout with statistics](step3-screenshot-book/r08-default-dashboard-1920x1080.jpg)

A busy hall's Dashboard once statistics arrive. It has:
- **The hero:** the next item with its countdown.
- **Online · 24 h:** the day's online count as bars, with its peak.
- **Playing now:** the top games, with players and trend arrows.
- **Right now:** online, in voice and checked in, with their peaks.
- **The rail:** now and next.

The demo stack hands the screen sample statistics in the bot's shape; the bot sends the real ones with #389. In voice rooms still waits for the bot's counts per room, so Online takes its cells. Mockup: sheet 10.

#### R43 · Dashboard, waiting for the bot's data
![Dashboard with its statistics boxes giving their space away](step3-screenshot-book/r43-default-dashboard-waiting-1920x1080.jpg)

The same zone before any statistics arrive, as at an event whose bot is not connected yet. The statistics and top-games boxes give their cells to the boxes beside them, so the next item, Right now and now fill the screen instead of empty cards. When the statistics come, the screen turns into R8 by itself. Mockup: sheet 10; [contracts/screen.md](../../contracts/screen.md) (Boxes waiting for their source, #426).

#### R9 · Dashboard, a showcase
![Dashboard with the hero grown to a showcase](step3-screenshot-book/r09-default-dashboard-showcase-1920x1080.jpg)

When something is showcased (here an announcement), the hero grows and the other boxes shrink aside. Mockup: sheet 10, README change 1 and amendment 2.

#### R10 · Ambient
![Ambient layout](step3-screenshot-book/r10-default-ambient-1920x1080.jpg)

A calm screen for a chill-out area or the night: a big clock and the date, with now and the delayed next item. Mockup: sheet 10.

#### R45 · Ambient, with people still online
![Ambient with the line 218 still online](step3-screenshot-book/r45-default-ambient-online-1920x1080.jpg)

With the bot's data, Ambient adds one line under now and next ("218 still online", with its trend arrow). Late at night, the calm screen says how many people are still around. Mockup: sheets 10 and 16.

#### R48 · Portrait, Right now
![Portrait Pulse with Right now's figures](step3-screenshot-book/r48-default-portrait-right-now-1080x1920.jpg)

The portrait screen's Right now box with the bot's data: online with its trend and peak, in voice with its peak, and checked in. Mockup: sheets 10 and 16.

#### R11 · Photo wall in the hero
![Pulse with the photo wall in the hero](step3-screenshot-book/r11-default-photo-1920x1080.jpg)

The event's newest photos take a turn in the hero as a wall: five tiles, the newest large with its album and author. The demo's photos are placeholders. The rail shows now and the delayed item. Mockup: mockup 02, sheets 9 and 16.

#### R46 · A new photo pops in
![Pulse with a new photo popping over the whole hero](step3-screenshot-book/r46-default-photo-pop-1920x1080.jpg)

A photo that has just come in pops large over the whole hero for a moment, then joins the wall. The zone switches this off with "New photo pops in large" (O30). Mockup: sheet 16.

#### R12 · Photo wall, portrait
![Portrait screen with the photo wall in the hero](step3-screenshot-book/r12-default-photo-1080x1920.jpg)

The café's portrait screen with the photo wall in its hero. Mockup: mockup 03, sheet 16.

#### R47 · A new photo pops in, portrait
![Portrait screen with a new photo popping over the hero](step3-screenshot-book/r47-default-photo-pop-1080x1920.jpg)

The same pop on the portrait screen. Mockup: mockup 03, sheet 16.

#### R13 · Rail with nothing to show
![Pulse with an empty rail box showing the logo](step3-screenshot-book/r13-default-rail-empty-1920x1080.jpg)

When the run of show has nothing beyond the item the hero already shows, the rail's now-and-next box shows the event's logo. It does not repeat the hero or stand empty. Mockup: sheet 9.

#### R49 · A preview on one screen
![Screen with the Preview mark, showing an unsaved Dashboard](step3-screenshot-book/r49-default-preview-mark-1920x1080.jpg)

The one screen chosen for a preview (O85, O87) shows the draft or the unsaved change with a small "Preview" mark in its top-left corner. Here the zone editor's unsaved switch to the Dashboard is waiting for statistics. Every other screen keeps the live zone, and the mark tells the crew in the hall why this one looks different. Mockup: sheet 6.

### The stage, the Director and the choreographer

Three step 3 features make the screen follow the event: energy levels (sheet 11), the stage and card backgrounds (sheet 15), and the Director with its crew spotlight (sheet 13). These are still frames, so the motion itself does not show. The artifact also holds frame strips of the motion vocabulary at each level and motion pack (28 frames), which the book does not repeat.

#### R50 · Pulse, tonight's final with its art
![Pulse hero meant to carry the final's art band](step3-screenshot-book/r50-default-pulse-hero-art-1920x1080.jpg)

The shot hands the Pulse hero tonight's final with what sheets 9–10 put there: the game's art band, "8 teams left", its description, and a Semis chip that counts down to the semis. The frame from main shows none of these. The hero draws the semis and its countdown, as in R1. Item 1 of the lead's evaluation of the previous version, the flat hero, still stands on main. Mockup: sheets 9, 10 and 15.

#### R51 · The stage, calm
![Pulse on the stage at the calm level](step3-screenshot-book/r51-default-stage-calm-1920x1080.jpg)

The stage at the evening's peak with the level set to Calm (O29, O73), for a quiet area or a slow hour. Mockup: sheets 11 and 15.

#### R52 · The stage, lively
![Pulse on the stage at the lively level](step3-screenshot-book/r52-default-stage-lively-1920x1080.jpg)

The same at Lively, the demo event's level. Mockup: sheets 11 and 15.

#### R53 · The stage, party
![Pulse on the stage at the party level](step3-screenshot-book/r53-default-stage-party-1920x1080.jpg)

The same at Party, for the peak of the night. In a still frame the three levels look the same: they differ in how much and how fast the screen moves (sheet 11), which only the artifact's motion strips show. Mockup: sheets 11 and 15.

#### R54 · A surge, before
![Pulse just before a game surges](step3-screenshot-book/r54-default-stage-surge-before-1920x1080.jpg)

Just before a game surges (its player count jumps), the screen is the lively Pulse of R52. Mockup: sheets 13 and 15.

#### R55 · A surge, during
![The surging game taking the hero, the rail mid-change](step3-screenshot-book/r55-default-stage-surge-during-1920x1080.jpg)

The surge takes the hero: Hot right now, Demo Game, 14 playing now, surging since 14:27, on the game's card art (sheet 15's card background). The frame catches the rail mid-change, with its old and new contents crossfading. Mockup: sheets 13 and 15.

#### R56 · A surge, after
![The surging game holding the hero after the change](step3-screenshot-book/r56-default-stage-surge-after-1920x1080.jpg)

Once the change settles, the hot game holds the hero and the rail moves the delayed semis up. The stage tint, the game's art behind the cards (sheet 15's stage background), does not stand out in these frames. Mockup: sheets 13 and 15.

#### R57 · The Director, a turn
![The Director's turn: Today in numbers in the hero](step3-screenshot-book/r57-default-director-line-f1-1920x1080.jpg)

The Director takes turns in the hero between its features (O30: Rotation, The Director). Here it shows Today in numbers: the most people online and when, the photos shared, and a chart by hour. The thin line at the hero's foot fills as the turn runs, so the room sees that something else is coming. The rail shows the semis' countdown. Mockup: sheet 13.

#### R58 · The Director, the next turn
![The Director's next turn: the semis in the hero](step3-screenshot-book/r58-default-director-line-f2-1920x1080.jpg)

The next turn brings the semis and its countdown into the hero, with a fresh line. Mockup: sheet 13.

#### R59 · The Director, the photo wall's turn
![The Director's turn for the photo wall](step3-screenshot-book/r59-default-director-line-f3-1920x1080.jpg)

Then the photo wall's turn. The rail has moved on to now and the delayed item. Mockup: sheets 13 and 16.

#### R60 · The Director holds a surge
![A surge holding the hero with the hold ring](step3-screenshot-book/r60-default-director-ring-f1-1920x1080.jpg)

When a surge holds the hero, the Director keeps it there instead of turning. A small ring in the hero's top-right corner fills as the hold runs out. Mockup: sheet 13.

#### R61 · The Director holds a surge, 5 s later
![The hold ring 5 s fuller](step3-screenshot-book/r61-default-director-ring-f2-1920x1080.jpg)

The same 5 s later: the ring is fuller, and the rail has turned to the semis' countdown. Mockup: sheet 13.

#### R62 · The choreographer, before both turn
![Hero and rail just before both turn](step3-screenshot-book/r62-default-choreographer-f1-1920x1080.jpg)

When the hero and the rail both turn every 6 s, the choreographer spaces their turns so they never change at the same moment. Just before: the photo wall in the hero, and now with the delayed item in the rail. Mockup: sheet 13.

#### R63 · The choreographer, the hero turned
![The hero turned to Today in numbers, the rail not yet](step3-screenshot-book/r63-default-choreographer-f2-1920x1080.jpg)

The hero turns first, to Today in numbers. The rail keeps still. Mockup: sheet 13.

#### R64 · The choreographer, then the rail
![The rail turned to the semis' countdown](step3-screenshot-book/r64-default-choreographer-f3-1920x1080.jpg)

A moment later, the rail turns to the semis' countdown. Mockup: sheet 13.

### Claims

A claim is something that briefly takes over part of the screen: an announcement, a game that is hot right now, a match being called, an emergency. In step 3 the Screen draws them; Moments decides them in step 4.

#### R21 · Claim on the rail
![Announcement claim on the rail](step3-screenshot-book/r21-default-claim-rail-1920x1080.jpg)

An announcement ("Dinner is served") takes the rail's now-and-next box for a while. Mockup: mockup 04.

#### R22 · Claim on the rail, portrait
![Announcement claim on a portrait screen](step3-screenshot-book/r22-default-claim-rail-1080x1920.jpg)

The same on a portrait screen. Mockup: mockup 04.

#### R23 · Claim on the hero
![Hot right now claim on the hero](step3-screenshot-book/r23-default-claim-hero-1920x1080.jpg)

A game that is hot right now takes the hero on its card art, with how many are playing. The rail moves the delayed item up. Mockup: mockup 04, sheet 15.

#### R24 · Claim on the hero, portrait
![Hot right now on a portrait screen](step3-screenshot-book/r24-default-claim-hero-1080x1920.jpg)

The same on a portrait screen. Mockup: mockup 04.

#### R25 · Overlay claim
![Match called overlay](step3-screenshot-book/r25-default-claim-overlay-1920x1080.jpg)

A match is called. A band over the foot of the screen says who plays and where to go, while the rest keeps playing. Mockup: mockup 04.

#### R26 · Overlay claim, portrait
![Match called overlay on a portrait screen](step3-screenshot-book/r26-default-claim-overlay-1080x1920.jpg)

The same on a portrait screen. Mockup: mockup 04.

#### R27 · Takeover
![Emergency takeover](step3-screenshot-book/r27-default-claim-takeover-1920x1080.jpg)

An emergency takes the whole screen in fixed red with one instruction, on every screen, whatever the theme or the layout. The demo stack also shoots it over the Ambient layout. That file is identical to this one, byte for byte, because the takeover covers every layout, so the book shows it once. Mockup: mockup 04, sheet 9.

### Offline and the end

#### R29 · Offline
![Pulse offline with the marker](step3-screenshot-book/r29-default-offline-1920x1080.jpg)

When the venue's uplink drops, every screen keeps playing what it has and marks "offline since" in a corner. The crew sees it, and attendees still see the programme. Mockup: mockup 16, sheet 9.

#### R30 · Offline, portrait 4K
![Offline on a portrait 4K screen, scaled down](step3-screenshot-book/r30-default-offline-2160x3840.jpg)

The same on a portrait 4K screen. Mockups: 03 and 16.

#### R31 · The event has ended
![Archived frame: this event has ended](step3-screenshot-book/r31-default-archived-1920x1080.jpg)

After the event is archived, its screens thank people for coming. The platform admin moves them to the next event. Mockup: mockup 05, sheet 9.

#### R32 · The event has ended, portrait
![Archived frame, portrait](step3-screenshot-book/r32-default-archived-1080x1920.jpg)

The same on a portrait screen. Mockup: mockup 05.

### The other demo themes

The same screens in the demo event's two other themes, to show that a theme changes the look but not the layout or the content.

#### R33 · Level-up, Pulse
![Level-up theme, Pulse](step3-screenshot-book/r33-level-up-pulse-1920x1080.jpg)

The Pulse in the Level-up theme: its logo, accent lines on the cards, a framed clock and a ticker with its own separators. Mockup: mockup 02 in the theme's colours.

#### R34 · Level-up, Pulse portrait
![Level-up theme, Pulse portrait](step3-screenshot-book/r34-level-up-pulse-1080x1920.jpg)

The same on a portrait screen. Mockup: mockup 03.

#### R35 · Level-up, Dashboard
![Level-up theme, Dashboard](step3-screenshot-book/r35-level-up-dashboard-1920x1080.jpg)

The Dashboard of R8 in Level-up, with the chart in the theme's warm colours. Mockup: sheet 10.

#### R36 · Level-up, Ambient
![Level-up theme, Ambient](step3-screenshot-book/r36-level-up-ambient-1920x1080.jpg)

Ambient in Level-up, with the clock in a card. Mockup: sheet 10.

#### R37 · Level-up, offline
![Level-up theme, offline](step3-screenshot-book/r37-level-up-offline-1920x1080.jpg)

The offline marker in Level-up. Mockup: mockup 16.

#### R38 · Terminal, Pulse
![Terminal theme, Pulse](step3-screenshot-book/r38-terminal-pulse-1920x1080.jpg)

The Pulse in the Terminal theme: outlined boxes, a cyan accent and a flat dark ground. Mockup: mockup 02 in the theme's colours.

#### R39 · Terminal, Pulse portrait
![Terminal theme, Pulse portrait](step3-screenshot-book/r39-terminal-pulse-1080x1920.jpg)

The same on a portrait screen. Mockup: mockup 03.

#### R40 · Terminal, Dashboard
![Terminal theme, Dashboard](step3-screenshot-book/r40-terminal-dashboard-1920x1080.jpg)

The Dashboard of R8 in Terminal. Mockup: sheet 10.

#### R41 · Terminal, Split
![Terminal theme, Split](step3-screenshot-book/r41-terminal-split-1920x1080.jpg)

Split in Terminal. Mockup: sheet 10.

#### R42 · Terminal, waiting for a zone
![Terminal theme, paired but not assigned](step3-screenshot-book/r42-terminal-unassigned-1920x1080.jpg)

A device frame in a theme: a screen that is paired but not yet assigned follows the published theme. Mockup: mockup 05.

## Not in this book

What a person can meet on main that the full demo stack run does not show, and what is drawn but not built in step 3:

- **A pushed playlist or a theme embed on a full-size screen:** the full run shoots no screen while a pushed playlist or an embed plays. O34 shows the push only in its Playing now line. Earlier versions of this book showed them as R14–R20, from a local stack. They left this version because every image now comes from the one full run.
- **A full-screen break:** a `break` playlist set to `full` plays inside the hero's playlist widget on main, because the screen's composed state has no full-screen place for it yet (`modules/screen/src/compose/playing.ts`).
- **A web page or a video link as a playlist item:** the screen frames only `https://` pages on the event's `web_allowlist` and YouTube's no-cookie player. The demo stack serves neither, so these items are not shot.
- **Discord sign-in itself:** Discord cannot run in CI, so the organisers' sign-in shows its "isn't switched on yet" state (O1). Check-in shows Continue with Discord (A3) but not Discord's own page.
- **The superadmin's device registry** (mockup 15): an API on the superadmin hostname, with no page yet.
- **The hub's own pages:** the App track's. A2 is only the Theme studio's preview of one.
- **Sheets 11–16 against step 3:**
  - **In step 3, as still frames:** energy levels and the motion vocabulary (sheet 11: O29, O73, R51–R53; the motion strips are in the artifact only), the Director and its spotlight (sheet 13: R57–R64), and the card background (sheet 15: R23, R55).
  - **In step 3, from sheet 16 (widgets with character):** the photo wall and its pop (R11, R12, R46, R47), Right now with peaks and check-ins (R4, R8, R48), the screen name (R44, O88), Ambient's online line (R45), and Online · 24 h and Playing now with sample data (R8).
  - **Not shown:** the stage tint (sheet 15) does not stand out in R54–R56, and the hero's art band (sheets 9–10) does not draw in R50.
  - **Later steps:** scenes (sheet 12) and cues (sheet 14), and sheet 16's widgets that need data step 3 does not have yet, such as game art from a games catalogue and teams left.
- **Every theme at every size, and every phone twin:** the book shows a selection. The artifact holds each demo theme's Pulse, frames and layouts at every size it was shot, and a phone shot of most desk pages.

## Lead's evaluation

*To be written by the lead: a frank rating per surface, what still falls short of beautiful and unified, and a plan to fix it.* The lead's evaluation of this book's previous version (main `07ea9ac`) is in PR #423's comments. Its image IDs still point at the same screens, except R14–R20 and R28, which left the book.
