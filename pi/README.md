# latexview Pi Package

This folder is a Pi package that exposes `latexview` as extension tools.

## Provides

- `latexview_serve`: start the preview server and return URL/pid.
- `latexview_info`: read page count, dimensions, and file metadata.
- `latexview_status`: check a running viewer.
- `latexview_list`: list live preview servers from the local registry.
- `latexview_stop`: stop registered preview servers safely.
- `latexview_inspect`: inspect selected pages and return QA warnings.
- `latexview_find`: find candidate pages for rendered text.
- `latexview_jump`: jump an open viewer to a page.
- `latexview_capture`: capture a PDF page as WebP.
- `latexview_help`: show CLI help.
- `latexview_capture_page` and `latexview_find_text`: compatibility aliases.
- `skills/latexview/SKILL.md`: lightweight workflow guidance for PDF inspection.

## Try Locally

From the `latexview` project root:

```bash
pi -e ./pi/extensions/latexview.js
```

Install the package locally:

```bash
pi install ./pi
```

Project-local install:

```bash
pi install -l ./pi
```
