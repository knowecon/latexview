---
name: latexview
description: "Use when working with LaTeX-generated PDFs that need browser preview, hot reload checks, rendered-text page lookup, page jumps, or single-page WebP capture through the latexview CLI."
---

# latexview

Use `latexview` when a LaTeX PDF needs to be inspected from an agent-friendly browser or turned into a page image.

## Core Commands

- Start a hot preview server: `latexview <file.pdf>`
- Start at a page: `latexview --page <page> <file.pdf>`
- Read metadata: `latexview info --json <file.pdf>`
- Inspect key pages: `latexview inspect --json --pages first,middle,last <file.pdf>`
- Find rendered text: `latexview find --json <file.pdf> "<long rendered text>"`
- Jump an open viewer: `latexview jump --url <viewer-origin> <page>`
- Capture a page: `latexview capture <file.pdf> <page> --out <page.webp>`
- Clean up viewers: `latexview list --json`, then `latexview stop --all`
- Show help: `latexview --help`

## Plugin Tools

Prefer the registered plugin tools when they are available:

- `latexview_serve`: starts the preview server and returns the viewer URL and pid.
- `latexview_info`: reads PDF page count and dimensions.
- `latexview_status`: checks a running viewer.
- `latexview_list`: lists live preview servers.
- `latexview_stop`: stops registered preview servers safely.
- `latexview_inspect`: returns selected-page QA warnings.
- `latexview_find`: wraps `latexview find`.
- `latexview_jump`: wraps `latexview jump`.
- `latexview_capture`: wraps `latexview capture` and returns exactly one WebP output.
- `latexview_help`: wraps `latexview --help`.

## Workflow

1. Resolve the PDF path from the current project.
2. Use `latexview info` to learn page count and dimensions.
3. Use `latexview inspect --json --pages first,middle,last` for quick QA.
4. Use `latexview find` for text-to-page lookup when source/PDF alignment is fuzzy.
5. Use `latexview_capture` or `latexview capture` for one selected page of visual evidence.
6. Prefer long text snippets for `find`; short repeated phrases can map to many pages.
7. Use `latexview_status/list/stop` or `latexview list --json` and `latexview stop --all` to clean up long-running viewers.
8. When testing hot reload, keep the current page stable and verify the browser canvas changes after the PDF is rewritten.

## Notes

- `capture` always writes WebP, even if the requested output path has another extension.
- Do not request multiple page images from one tool call; inspect first, then capture one page.
- The default capture quality is intended for readable text and compact files.
- The viewer is page-based; use `?page=N` URLs for precise debugging links.
