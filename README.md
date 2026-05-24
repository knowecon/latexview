# latexview

Tiny local LaTeX PDF preview server with hot reload.

```bash
latexview main.pdf
latexview --page 12 main.pdf
latexview info --json main.pdf
latexview inspect --json --pages first,middle,last main.pdf
latexview find --json --url http://127.0.0.1:4545 main.pdf "long rendered text"
latexview jump --url http://127.0.0.1:4545 12
latexview capture --json main.pdf 12 --out page-12.webp
latexview list --json
latexview status --json --url http://127.0.0.1:4545
latexview stop --all
```

The viewer is page-based, not document-scroll-based. Use `?page=N` in the URL
to jump directly to a page. When the PDF file changes, the browser reloads the
PDF document and keeps the current page number.

`find` extracts text from the PDF and prints every candidate page. JSON output
includes `count`, per-page URLs when `--url` is provided, and original-case
snippets. It is not a full SyncTeX inverse-search replacement; it works best
with long strings copied from rendered text or source text that appears plainly
in the PDF.

`inspect` checks selected pages and returns stable QA warnings. With
`--capture`, it may render temporary images for pixel-backed blank-page
detection, but it does not return multiple page images.

`capture` renders exactly one PDF page to WebP and prints the generated image
path. Output is always `.webp`; paths like `page.png` are normalized to
`page.webp`. Use `--dpi` to control output resolution; the clear default is 216.
It uses Poppler's `pdftoppm` and `cwebp` under the hood.

`list`, `status`, and `stop` use a local lifecycle registry so agents can find
and clean up preview servers without relying on pid alone.

Plugin wrappers live under `codex/` and `pi/`. Both expose the CLI surface as
tools: `serve`, `info`, `status`, `list`, `stop`, `inspect`, `find`, `jump`,
`capture`, and `help`.
