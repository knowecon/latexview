---
name: latexview
description: "Use when Pi is working with LaTeX PDFs and should call latexview tools for page lookup or WebP page capture."
---

# latexview

Use the bundled extension tools before hand-rolling PDF inspection scripts.

## Tools

- `latexview_serve`: starts the preview server and returns the viewer URL and pid.
- `latexview_find`: wraps `latexview find`.
- `latexview_jump`: wraps `latexview jump`.
- `latexview_capture`: wraps `latexview capture` and always returns WebP output.
- `latexview_help`: wraps `latexview --help`.
- `latexview_find_text` and `latexview_capture_page`: compatibility aliases.

## Workflow

1. Use long rendered text snippets for page lookup.
2. Capture a page as WebP when visual layout matters or when an agent needs to inspect the rendered page.
3. Use the returned page numbers and image paths in the answer so the user can jump directly to the relevant PDF page.
