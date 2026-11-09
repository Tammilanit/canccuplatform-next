# Plan: issue #184 — the render-job container for PPTX and PDF

Package `screen-render-job`, branch `184-feat-screen-the-render`. Step 3, wave 3 of the package sketch (`docs/briefs/step-3-screen.md`, `## Plan`: "the content engine (#108) and the render job (#184)"). Sources of truth: `contracts/screen.md` ("The PPTX render job", the `screen.render.*` events, Health) with `contracts/screen.openapi.yaml` and `contracts/screen/content.openapi.yaml` as merged in #201, [0010](../decisions/0010-scope.md) (never inside a request), [0013](../decisions/0013-multi-tenant-core.md) item 27 (fair job queues), and the step 3 final plan (P3, D9, D10, O8). This plan changes no contract; it names one contract choice for the lead (question 5).

## Why a plan first
1. **No screen module yet.** `modules/screen/` is empty on main. The render jobs belong to the screen module: the `render_jobs` rows in Postgres, the queue in Valkey, the API under `/api/screen/render-jobs`, the `screen.render.*` events and copying the slides into the files volume ("Screen copies the slide PNGs into the files volume after the job"). The draft plan for #108 (PR #205, `docs/plans/issue-108.md`) puts the module skeleton, the kit-ts migration runner (its D2) and the assets table with content-addressed, reference-counted files (its D9, slices A + B and G) in #108, and says "submitting the render job is #184's" (its D10). This package would otherwise build a second skeleton and a stand-in assets table that #108 replaces.
2. **Size.** About 2,800 changed lines (below), roughly twice the package limit of about 1,500 ([AGENTS.md](../../AGENTS.md#how-work-flows)). Workers may not split an issue.
3. **One wording in the criteria needs the lead's reading:** "no network, no shared volume". A container with no network at all can only be reached through a volume, so screen and the container need either a private network or a socket-only volume (question 2).
4. **CI is `.github/`.** The renderer's tests need LibreOffice and poppler, so CI runs them in the built image. Like every new module, that needs a `ci.yml` change today (#108's plan, question 6).

## Size by area (source plus tests, estimated)
Legacy: `~/legacy/canccusignage/src/lib/pptx/` (`render.ts` 104 lines, `inspect.ts` 11, `cache-key.ts` 34; tests `pptx-render.test.ts`, `pptx.test.ts`). It rendered one slide per page request on the host's `soffice` and `pdftoppm`: the `soffice` to PDF to `pdftoppm` pipeline and the slide count are kept, everything else is rebuilt (the brief's "Port with changes" row).

| Area | Content | Estimate |
|---|---|---|
| A1. Renderer service | `modules/screen-render/`: a small server on a Unix socket, one job at a time, the framing of deck in and slides out, a 10-minute job timeout that kills the whole process group, cleanup of the scratch directory | 200 |
| A2. Deck checks before any renderer runs | Content sniffing (PPTX zip or PDF, not by name); zip limits (entries, total uncompressed size, ratio); `.rels` scan refusing external relationships that load content; macro parts refused; image headers checked against a pixel cap; slide or page count over 300 refused (`too_many_slides`); plain-words messages | 250 |
| A3. Conversion | `soffice --headless` to PDF in a throw-away profile with links and macros off; `pdftoppm` in batches of pages, each fitted within 3840×2160 (question 4, the product owner's answer); a PDF goes straight to `pdftoppm` | 180 |
| A4. Fonts and warnings | The image's broad open font set; `font_missing` from the deck's `a:latin`/`a:ea`/`a:cs` typefaces (theme fonts resolved) against `fc-list`, the substitute from `fc-match`, the slides each font is used on; for a PDF, `pdffonts` per page (not embedded and not in the image) | 120 |
| A5. Image and deploy | Dockerfile (Debian, LibreOffice Impress headless, poppler-utils, fonts), Compose service with the isolation below, README with the check command | 130 |
| A6. Tests with real decks | Small real PPTX and PDF fixtures (made with LibreOffice, committed); hostile decks built in the test by changing a real one: a linked image, an OLE link, a remote template, a decompression-bomb image, a zip bomb, 301 slides, a macro deck, a corrupt file, a PDF with a missing font | 450 |
| B1. Jobs in Postgres | Migration `render_jobs` (per tenant under RLS; state, timestamps, error, slides, warnings, lease); the store | 240 |
| B2. Fair queue in Valkey | Per-tenant job lists, a ring of tenants with waiting jobs, at most one running job per tenant, an atomic take (Lua); rebuilt from Postgres `queued` rows at start-up; `queue_position` | 200 |
| B3. Dispatcher | Takes the next job, streams the deck to the renderer, checks every returned PNG (signature, size, count), writes slides to `/files/<tenant>/screen/renders/<asset>/<version>/slide-<n>.png` (temporary name, then rename), leases with requeue once after a lost worker, cancel aborts the stream, events `screen.render.queued`, `.started`, `.succeeded`, `.failed`, `.cancelled` | 250 |
| B4. API and health | `POST`, `GET /api/screen/render-jobs`, `GET`, `DELETE …/{job_id}`, `GET …/{job_id}/result`, serving `/api/screen/renders/…` from the job's row; submit on a `pptx` or `pdf` upload (the hook in #108's assets); the `render` health check (degraded when the oldest queued job is over 10 minutes old) | 180 |
| B5. Tests | Fair-queue tests (one event's 20 decks against another's one: the second waits for one job at most), dispatcher tests against a fake renderer, API tests, a Compose test against the real renderer | 600 |
| **Total** | **A ≈ 1,330, B ≈ 1,470** | **≈ 2,800** |

## Design (holds for every split)
| # | Decision | Reason |
|---|---|---|
| R1 | **Two parts:** the renderer container `screen-render` (A) knows nothing of tenants, Postgres, Valkey or the files volume; the screen module (B) owns jobs, queue, events and files | The contract's split ("the container keeps no state"; "Screen copies the slide PNGs"); the part that parses untrusted files holds nothing worth stealing |
| R2 | **The renderer in Python 3.12, standard library only** (`zipfile`, `xml.etree` with entity expansion refused, `subprocess`, `socketserver`) | No third-party code next to untrusted input; Python is already one of the two stacks ([0006](../decisions/0006-stack.md)) and the image needs no Node. The screen side stays TypeScript as #108 decides |
| R3 | **Isolation in Compose:** `network_mode: none`; the only mount is a socket-only volume `render-socket` (question 2); `read_only: true`, `tmpfs` scratch with a size cap, `user` non-root, `cap_drop: [ALL]`, `no-new-privileges`, `mem_limit`, `cpus`, `pids_limit`; no environment secrets, not even the service key | With no network a compromised renderer cannot reach screen's internal paths, Postgres, Valkey or the uplink; with no files volume it cannot read other events' files |
| R4 | **Screen is the client:** the renderer listens on the socket, screen connects, sends kind, size and the deck, and reads back `result.json` and the slides; screen trusts nothing it reads (PNG signature, dimensions within the cap, at most `slide_count` files, byte cap per slide) | The renderer can only answer, never call; a hostile answer is just a failed job |
| R5 | **External links:** a `.rels` relationship with `TargetMode="External"` of a loading type (image, OLE object, attached template, media, frame, sub-document) is refused as `file_invalid` with "This deck links to content outside the file (…). Embed it and upload again." Hyperlinks are kept (question 3) | The contract's "linked images, OLE links, remote templates"; refusing hyperlinks would refuse ordinary decks, and a screen never follows one |
| R6 | **LibreOffice runs in a fresh profile per job** with macros off and link updates never (`registrymodifications.xcu` in the image), killed with its process group at the timeout | Defence in depth behind R3 and R5; no state left between jobs of different events |
| R7 | **Plain-words errors:** each refusal keeps its contract code (`file_invalid`, `too_many_slides`, `render_timeout`, `renderer_failed`) and a message an organiser can act on ("The deck has 412 slides; the limit is 300. Split it into two decks.") | Criterion 3 |
| R8 | **Fair queue:** round robin over events with waiting jobs, one running job per event, concurrency equal to the number of renderer workers (one by default). An event waits behind at most one job of each other event, never behind another event's whole backlog. Postgres holds the truth; the Valkey keys are rebuilt from it | 0013 item 27; the contract's "one running job per event at a time, events served in turn" |
| R9 | **Fonts:** Liberation (Arial, Times New Roman, Courier New metrics), Carlito and Caladea (Calibri, Cambria metrics), DejaVu, Noto (Sans, Serif, CJK, emoji), Open Sans, Roboto, Lato, Montserrat, Source Sans; a `font_missing` warning names the deck's font and the substitute `fc-match` chose, also when it is metric-compatible | Criterion 1; the contract's "drawn with a substitute", and the organiser learns why the line breaks may move |
| R10 | **Slides fitted within 3840×2160 PNG** (question 4, the product owner's answer on #184), streamed back slide by slide and deleted once sent | Sharp on the 4K screens step 3 proves; streaming keeps a 300-slide deck at 4K out of the size-capped `/tmp`, which counts against the memory limit |
| R11 | **Lost workers:** a running job whose lease ran out (screen replica restarted) goes back to the head of its event's list once, then fails `renderer_failed` | Stateless containers; a crashing deck cannot loop forever |

## Proposed split (for the lead)
| Slice | Content | Risk | Needs |
|---|---|---|---|
| A. The renderer container | A1–A6, R1–R7, R9, R10, its Compose service, and its CI job (`.github/`) | high (parses untrusted files; isolation in deploy config; `.github/`) | — (can run now, beside #108) |
| B. Render jobs in screen | B1–B5, R8, R11; the submit on upload | high (wires the isolated container in, as the brief rated #184) or normal if the lead reads it as API inside a module | #108's skeleton (slice A + B) and assets (slice G); A |

The criteria map as: isolation, external links, fonts and warnings → A; fair queue, progress and events → B; timeouts and size limits, plain-words failures → A (renderer) and B (job timeout, lost workers); tests with real and hostile decks → A, and B's Compose test.

## Questions
1. **Split:** split #184 into slices A and B above, or keep one issue at about twice the limit and wait for #108's skeleton and assets? Recommendation: split; A runs now.
2. **"No network, no shared volume":** a socket-only volume `render-socket` (mounted in screen and screen-render, holding nothing but the socket) with `network_mode: none`; or a private `internal: true` network that only screen joins, with no volume at all? Recommendation: the socket volume. A private network still lets a compromised renderer open connections to screen's HTTP port and its internal paths; the socket volume holds no data and gives the renderer no way to call anything.
3. **Hyperlinks** (R5): keep external hyperlinks and refuse only relationships that load content, or refuse every external relationship as the contract's sentence can be read? Recommendation: refuse only loading kinds.
4. **Slide size** (R10): fit within 2560×1440, 1920×1080, or 3840×2160? Recommendation: 2560×1440, the brief's photo cap. Answered: 3840×2160 (the product owner, on #184).
5. **Progress slide by slide:** the brief's flow is "watch a deck render slide by slide", but `RenderJob` has only `state` and `queue_position`. Add `slides_done` (and `slide_count` while running) to `RenderJob` in a small additive contract PR first, or keep the state and queue position? Recommendation: the additive fields, no extra event (Studio reads the job while it shows it).
6. **CI:** the renderer's tests run in its image through a `ci.yml` job (high). The same choice as #108's question 6: a generic step for every module with checks, or one job per module? Recommendation: the generic step, once.

## After the answers
The lead rewrites #184 (or opens the slices) as the answers decide; slice A then runs as one package against this design table, slice B after #108's skeleton and assets are merged.

## Answers (2026-11-09)
The user approved the plan with every recommendation, except question 4: the product owner chose slides at 3840×2160. This branch builds slice A only: slice B needs #108's screen module, and only the lead can split the issue. Question 5 (`slides_done`) is a contract change, so it goes in its own PR first. Question 6 got the smallest CI change: one `screen-render` job, not the generic step.
