---
name: latexview
description: "Use when working with LaTeX-generated PDFs that need browser preview, hot reload checks, rendered-text page lookup, page jumps, or single-page WebP capture through the latexview CLI."
---

# latexview

Use `latexview` when a LaTeX PDF needs to be inspected from an agent-friendly browser or turned into a page image.

## Core Commands

- Start a hot preview server: `latexview <file.pdf>`
- Start at a page: `latexview --page <page> <file.pdf>`
- Find rendered text: `latexview find <file.pdf> "<long rendered text>"`
- Jump an open viewer: `latexview jump --url <viewer-origin> <page>`
- Capture a page: `latexview capture <file.pdf> <page> --out <page.webp>`
- Show help: `latexview --help`

## Plugin Tools

- `latexview_serve`: starts the preview server and returns the viewer URL and pid.
- `latexview_find`: wraps `latexview find`.
- `latexview_jump`: wraps `latexview jump`.
- `latexview_capture`: wraps `latexview capture` and always returns WebP output.
- `latexview_help`: wraps `latexview --help`.

## Workflow

1. Resolve the PDF path from the current project.
2. Use `latexview find` for text-to-page lookup when source/PDF alignment is fuzzy.
3. Use `latexview capture` or `latexview_capture` for agent vision, debugging, or compact page artifacts.
4. Prefer long text snippets for `find`; short repeated phrases can map to many pages.
5. When testing hot reload, keep the current page stable and verify the browser canvas changes after the PDF is rewritten.

## Notes

- `capture` always writes WebP, even if the requested output path has another extension.
- The default capture quality is intended for readable text and compact files.
- The viewer is page-based; use `?page=N` URLs for precise debugging links.
