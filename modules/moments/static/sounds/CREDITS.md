# The default sound pack: credits

Every sound here is dedicated to the public domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/), as its Wikimedia Commons page says (licence read from the Commons API on 2026-11-16). CC0 asks for no attribution; the authors are named anyway. No legacy clip is in the pack: none of the legacy repo's sounds has a confirmed CC0 source (step 4 plan, L9). The files are the Commons originals, or for a WAV original the Ogg Vorbis that Commons makes of it; nothing was edited.

Moments serves them at `/api/moments/sounds/pack/<file>` (contracts/moments.md, The library). `src/cues/catalog.ts` names them (`PACK`) and links them to the built-in cues; each event may link any sound of its own instead.

| File | Length | Source on Wikimedia Commons | Author | Default for |
|---|---|---|---|---|
| `chime-soft.ogg` | 1.5 s | [Chime (1) Sample.wav](https://commons.wikimedia.org/wiki/File:Chime_(1)_Sample.wav) | UnKnownrNone | `announce.attention` (the crew spotlight) |
| `chime-bright.ogg` | 2.3 s | [Chime.wav](https://commons.wikimedia.org/wiki/File:Chime.wav) | Walechon24 | `announce.attention`, `tournament.pre`, `tournament.post`, `strip.tournament_next`, `strip.finals_open`; the sound check |
| `happy-beep.ogg` | 1.1 s | [Simple Happy Beep.ogg](https://commons.wikimedia.org/wiki/File:Simple_Happy_Beep.ogg) | waveplaySFX | `announce.attention`, `poll.open`, `cast.live` |
| `music-box.ogg` | 0.8 s | [Music Box.ogg](https://commons.wikimedia.org/wiki/File:Music_Box.ogg) | unknown author | `nowplaying.start`, `photo.showcase` (a new photo) |
| `nudge.ogg` | 0.9 s | [Nudge.ogg](https://commons.wikimedia.org/wiki/File:Nudge.ogg) | unknown author | `ticker.message`, `chrome.hot` (the hot game rule), `chrome.voice`, `chrome.spike` |
| `gong.ogg` | 5.6 s | [Gong or bell vibrant (short).ogg](https://commons.wikimedia.org/wiki/File:Gong_or_bell_vibrant_(short).ogg) | PDSounds | `tournament.start` (the match called rule), `strip.finals_start` |
| `drum-roll.ogg` | 4.0 s | [Drum Roll Intro.ogg](https://commons.wikimedia.org/wiki/File:Drum_Roll_Intro.ogg) | Iwan Sounds and DIY | `tournament.start`, `tournament.post` (the finals result rule) |
| `ding.ogg` | 1.1 s | [406243 stubb typewriter-ding-near-mono.wav](https://commons.wikimedia.org/wiki/File:406243_stubb_typewriter-ding-near-mono.wav) | _stubb | `announce.result`, `poll.result`, `pizza.placed` |
| `bicycle-bell.ogg` | 1.5 s | [Bicycle-bell-1.wav](https://commons.wikimedia.org/wiki/File:Bicycle-bell-1.wav) | Soundscape_Leuphana | `pizza.open`, `pizza.placed` (the pizza rule) |
| `alarm.ogg` | 3.2 s | [A1r "Alarm" (Radio-Stop).wav](https://commons.wikimedia.org/wiki/File:A1r_%22Alarm%22_(Radio-Stop).wav) | ElectroTiel | `announce.urgent`, `emergency.start` (the emergency) |
| `airplane-chime.ogg` | 2.9 s | [Airplane Chime Sound Effect.ogg](https://commons.wikimedia.org/wiki/File:Airplane_Chime_Sound_Effect.ogg) | Sharelk | `announce.ended`, `announce.cleared` (the emergency's "All clear"), `cast.ended`, `pizza.closed` |

Every built-in moment that sounds (the five rules, the crew spotlight, the emergency and its "All clear", a new photo) and all 25 built-in cues have a sound here. The `standings` rule asks for no cue: a leaderboard that changes often would sound all evening. Storyboards (#114) pick from these cues.
