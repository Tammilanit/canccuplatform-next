# Reports

One-off reports for a step's checkpoint: screenshot books (every page and screen beside its mockup, `step<n>-…-book.md`), audits and deep reviews. Each Markdown file keeps its images in a folder of the same name next to it.

## A book's page
The product owner reads a book as one page: `scripts/pack-page` builds it with no AI tokens, so the lead only writes the verdict ([#718](https://github.com/Tammilanit/canccuplatform-next/issues/718)).
1. Download the CI artifact `demo-screenshots` of the run the book describes (`gh run download <run> -n demo-screenshots -D shots`), and write a short UX verdict in a Markdown file outside the repo.
2. Build: `scripts/pack-page docs/reports/<name>.md --images shots --verdict verdict.md --out <name>.html`. Each image the book shows is embedded where the book puts it (its tables stay tables); an image is taken from the `--images` folder by file name when it is there, otherwise from the path the book gives (its own folder, or a brief's mockups). The build stops and names any image it finds in neither.
3. When the book shows mockup SVGs, `scripts/pack-page --check <sha> <name>.html` proves they match the files at that commit (only SVGs are checked; the screenshots come from the CI artifact).
4. Publish the file yourself; the script never uploads anything.

The page has the title, the verdict, a contents list and every section, reads at 390 px and 1280 px, and follows the reader's light or dark setting ([briefs: the pack page](../briefs/README.md#the-pack-page)).
