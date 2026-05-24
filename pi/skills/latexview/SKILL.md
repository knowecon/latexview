---
name: latexview
description: "Use when Pi is working with LaTeX PDFs and should call latexview tools for page lookup or WebP page capture."
---

# latexview

Use the bundled extension tools before hand-rolling PDF inspection scripts.

## Tools

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
- `latexview_find_text` and `latexview_capture_page`: compatibility aliases.

## Workflow

1. Use `latexview_info` to understand page count and dimensions.
2. Use `latexview_inspect` with `first,middle,last` for quick QA.
3. Use long rendered text snippets for page lookup.
4. Capture exactly one page as WebP when visual layout matters or when an agent needs to inspect the rendered page.
5. Use `latexview_status/list/stop` to clean up long-running viewers.
6. Use the returned page numbers and image paths in the answer so the user can jump directly to the relevant PDF page.
