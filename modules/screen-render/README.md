# screen-render

The render job of the screen module: PPTX and PDF decks to slide PNGs, in a container that sees
nothing but its socket ([contract](../../contracts/screen.md#the-pptx-render-job),
[plan](../../docs/plans/issue-184.md)). It knows no tenant, database, queue or files volume: the
screen module queues the jobs fairly, sends one deck at a time over the socket and stores the
slides it gets back.

- **Isolation** (`deploy/compose.yml`): `network_mode: none`; the only mount is the
  `render-socket` volume, holding the socket; read-only root, a size-capped `/tmp`, no
  capabilities, a non-root user, memory, CPU and process limits.
- **Before rendering** (`inspect.py`): the kind is read from the content; zip bombs, external
  content links (images, OLE objects, templates, media), macros, XML entities, images over 60
  megapixels (PNG, JPEG, GIF, BMP, WebP) and decks over 300 slides or 100 MiB are refused with a message an organiser can act on.
- **Rendering** (`convert.py`): LibreOffice (a fresh profile per job, macros off) makes a PDF,
  poppler draws the pages in batches, each fitted within 3840×2160 (a turned page keeps its
  shape), and each slide is sent and deleted as soon as it is drawn. A PDF skips LibreOffice and
  has its images measured first (`pdfimages -list`). 10 minutes per job, and the whole process
  group dies at the deadline or when the caller hangs up.
- **Fonts** (`fonts.py`): `font_missing` warnings name each font the deck uses that the image
  lacks (for a PDF, each font it does not embed), the substitute and the slides.
- **Socket protocol:** `server.py`'s docstring. Requests have 60 seconds to arrive; pings are
  answered while a deck renders; renders run one at a time.
- **For the screen module (#224):** treat the `render-socket` volume as hostile, since the renderer
  can write to it: use only the socket, never follow a link or read a file there.

## Checks
In the image, against the real LibreOffice and poppler: `./check`, which builds the image's `test`
target and runs it with `--network none`. CI runs the same in the `module (screen-render)` job
([docs/ci.md](../../docs/ci.md#modules)).

Outside the image, `pip install -e ".[dev]" && ruff check . && mypy && pytest` runs everything but
the real-deck tests, which skip without `soffice`.
