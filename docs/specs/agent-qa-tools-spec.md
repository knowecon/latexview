# latexview Agent QA Tools Spec

Status: Implementation spec after Auditor loop
Date: 2026-05-24
Owner: latexview

## 1. Goal

Turn `latexview` from a PDF preview CLI into an agent-native LaTeX PDF inspection toolkit.

The next iteration must let a coding agent:

- Start and manage preview servers without leaking processes.
- Discover active viewers and stop them safely.
- Inspect PDF quality across selected pages with stable JSON output.
- Capture exactly one page as WebP for visual evidence.
- Locate rendered text and jump to unique matches.
- Use the same tool surface from the CLI, Codex MCP plugin, Pi extension, and skill docs.

The work is not a SyncTeX replacement. It is a practical QA and debugging layer for LaTeX-generated PDFs, especially inside agent apps that can view browser pages and image artifacts.

## 2. Current Baseline

Existing CLI:

```bash
latexview <pdf>
latexview --page 12 <pdf>
latexview find [--json] [--url <viewer-url>] <pdf> <text>
latexview jump [--url <viewer-url>] <page>
latexview capture [--out <image.webp>] [--dpi <dpi>] <pdf> <page>
```

Existing wrappers expose:

- `latexview_serve`
- `latexview_find`
- `latexview_jump`
- `latexview_capture`
- `latexview_help`

Existing strengths:

- Page-based browser viewer with hot reload.
- Virtualized thumbnail rail.
- WebP capture through `pdftoppm` and `cwebp`.
- Basic PDF text lookup through pdf.js.
- Tests for args, CLI, server, MCP, package metadata, and PDF search.

Known gaps this spec must address:

- Wrapper `serve` always passes `--port`, defeating CLI port fallback.
- Pi `serve` passes the agent abort signal to a detached preview process.
- There is no lifecycle registry, `list`, `status`, or `stop`.
- `find --json --url` drops jump URLs.
- `find` snippets are generated from normalized lowercase text.
- Pi compatibility aliases duplicate logic and include dead delegation.
- There is no automated selected-page QA command.
- Skill docs do not describe the agent QA workflow.

## 3. Non-Goals

- No editor-to-PDF SyncTeX forward/inverse search in this iteration.
- No cloud service, authentication, or multi-user server.
- No browser UI redesign beyond minimal states needed for lifecycle/status visibility.
- No bundled LaTeX compiler integration.
- No hard dependency on ImageMagick for the core workflow.
- No multi-page image export in this iteration. In particular, no `capture-range` command and no contact-sheet composition.
- No default full-document image generation for large PDFs. Agents inspect one captured page image at a time.

## 4. Command Surface

Output mode:

- Human-facing CLI output is concise text by default.
- Human text output is for people and is not a compatibility contract unless a command section explicitly says otherwise.
- Every command that returns structured data supports `--json`.
- Codex MCP and Pi wrappers must call CLI subcommands with `--json` whenever the command has structured output, then return both human text and structured details.
- JSON fields named `schemaVersion` describe a response or registry schema. JSON fields named `version` describe the PDF document version used by the viewer for hot reload and may change whenever the PDF file changes.

### 4.1 Serve

```bash
latexview [serve] [--host <host>] [--port <port>] [--page <page>] [--open|--no-open] <pdf>
```

`serve` may remain implicit for backward compatibility.

Rules:

- If `--port` is omitted, the CLI starts at default `4545` and falls back up to 25 ports on `EADDRINUSE`.
- If `--port` is provided, including `0`, it is explicit and no incremental fallback is attempted. `0` asks the OS for an available port.
- The startup message includes the actual URL and pid.
- On successful startup, the server writes a registry entry.
- On graceful shutdown through `SIGINT` or `SIGTERM`, the server removes its own registry entry.

Wrapper rule:

- Codex MCP and Pi wrappers must pass `--port` only when the caller explicitly provided `port`.
- Pi `serve` must not pass the tool-call abort signal to the detached server process.

### 4.2 Info

```bash
latexview info [--json] <pdf>
```

Purpose: static PDF metadata, no server side effects.

JSON shape:

```json
{
  "pdfPath": "/abs/main.pdf",
  "file": {
    "size": 123456,
    "mtimeMs": 1770000000000
  },
  "pdf": {
    "numPages": 370,
    "fingerprint": "optional",
    "metadata": {
      "Title": "optional"
    },
    "pages": [
      {
        "page": 1,
        "width": 1733.39,
        "height": 657.64,
        "rotation": 0
      }
    ]
  }
}
```

Default text output should be concise:

```text
main.pdf
Pages: 370
Page 1: 1733.39 x 657.64 pt
Size: 4.6 MB
Modified: 2026-05-21 13:00:51
```

Implementation:

- Use pdf.js for page count and page dimensions.
- Use `fs.stat` for file size and mtime.
- Do not render pages.

### 4.3 Status

```bash
latexview status [--url <viewer-url>] [--json]
```

Purpose: check a running viewer.

Rules:

- Default URL is `http://127.0.0.1:4545`.
- Accept full viewer URLs (`/?page=70`) or origins.
- Call `/health`.
- Return non-zero if the viewer is unreachable or `health.app !== "latexview"`.
- When no registry entry matches the URL, `registry` is `{ "found": false }` and omits `pid`, `pdfPath`, and `startedAt`.

JSON shape:

```json
{
  "ok": true,
  "url": "http://127.0.0.1:4550",
  "health": {
    "ok": true,
    "app": "latexview",
    "schemaVersion": 2,
    "version": 1770000000000,
    "pdfName": "main.pdf"
  },
  "registry": {
    "found": true,
    "pid": 12345,
    "pdfPath": "/abs/main.pdf",
    "startedAt": "2026-05-24T10:00:00.000Z"
  }
}
```

Failure JSON shape:

```json
{
  "ok": false,
  "url": "http://127.0.0.1:4550",
  "health": null,
  "registry": {
    "found": false
  },
  "error": "Viewer is unreachable"
}
```

### 4.4 List

```bash
latexview list [--json]
```

Purpose: list known running latexview servers.

Rules:

- Read registry entries from a temp-state directory.
- Probe each entry through `/health`.
- Remove stale entries whose process is gone or whose health check fails.
- Return live entries sorted by `startedAt` descending.

JSON shape:

```json
{
  "servers": [
    {
      "pid": 12345,
      "host": "127.0.0.1",
      "port": 4550,
      "url": "http://127.0.0.1:4550/?page=1",
      "origin": "http://127.0.0.1:4550",
      "pdfPath": "/abs/main.pdf",
      "pdfName": "main.pdf",
      "startedAt": "2026-05-24T10:00:00.000Z",
      "health": {
        "ok": true,
        "app": "latexview",
        "schemaVersion": 2,
        "version": 1770000000000
      }
    }
  ]
}
```

### 4.5 Stop

```bash
latexview stop [--url <viewer-url> | --port <port> | --pid <pid> | --all] [--json]
```

Purpose: stop latexview servers without killing unrelated processes.

Safety rules:

- `stop` requires exactly one target selector: `--url`, `--port`, `--pid`, or `--all`. Calling `latexview stop` with no target, or with multiple target selectors, is a usage error and exits non-zero.
- `stop` must validate each target through the registry and `/health` before sending a signal.
- A health response validates only when `health.app === "latexview"`.
- `--pid` is allowed only if that pid appears in a live registry entry. This avoids pid reuse mistakes.
- `--all` stops all live registry entries that pass `/health`.
- If the target selector matches no registry entries, return `"results": []` in JSON and exit non-zero.
- Stop sends `SIGTERM`, then removes the registry entry if the process exits or the health check fails afterward.
- Stop waits up to 1500 ms after signaling, polling `/health` every 100 ms.
- On Windows, use Node's `process.kill(pid, "SIGTERM")` as the first attempt and verify by re-probing `/health`; success is defined by the viewer becoming unreachable, not by POSIX signal semantics.
- If a registry entry is stale, remove it and report it as `stale`, not `stopped`.

Result statuses:

- `stopped`: a live latexview server was signaled and became unreachable.
- `stale`: the registry entry was already dead or no longer responded as latexview, and was pruned.
- `failed`: the target still responds with `health.app === "latexview"` after the stop attempt.

Exit codes:

- Exit 0 when every targeted entry is `stopped` or `stale`.
- Exit 1 when any targeted entry is `failed`, when no target matches, or when the invocation is a usage error.

JSON shape:

```json
{
  "results": [
    {
      "pid": 12345,
      "url": "http://127.0.0.1:4550",
      "status": "stopped"
    }
  ]
}
```

### 4.6 Inspect

```bash
latexview inspect [--json] [--pages <spec> | --range <from-to> | --from <n> --to <n> | --all] \
  [--capture] [--dpi <dpi>] [--max-pages <n>] <pdf>
```

Purpose: agent QA across selected pages.

Page selection:

- Page source flags are mutually exclusive: `--pages`, `--range`, `--from`/`--to`, and `--all`. Supplying more than one source exits non-zero with a usage error.
- `--pages` accepts comma-separated page atoms. Each atom may be a page number, `first`, `last`, `middle`, or a range such as `1-5`, `first-middle`, or `middle-last`.
- `--range` accepts one range atom with the same endpoint grammar as `--pages`.
- `--from` and `--to` must be supplied together and accept the same endpoint grammar as range endpoints.
- If omitted, default pages are `first,middle,last`.
- `middle` resolves to `Math.floor((numPages + 1) / 2)`.
- `--all` requires an explicit `--max-pages` if the PDF has more than 50 pages.
- Duplicate pages are removed and final page list is sorted ascending.
- Page selection parsing belongs to `inspect`; future selected-page commands must reuse the same parser rather than create a second grammar.
- Invalid inputs include page 0, negative pages, non-integer pages, reversed ranges, out-of-range pages, missing `--to`, missing `--from`, and unknown aliases. Invalid inputs exit non-zero before doing any rendering or capture work.

Capture behavior:

- If `--capture` is enabled, `inspect` may render selected pages for pixel sampling only.
- `inspect` must not persist or return multiple page images. It may use temporary render files, but it must clean them before exit.
- For visual evidence, call the single-page `capture` command on one page chosen from the `inspect` result.

Signals collected per page:

- Page dimensions in points.
- Extracted text length and normalized text length.
- Optional pixel coverage if capture is enabled.
- Warnings.

Warning categories:

- `blank`: no meaningful text and pixel coverage below the blank threshold.
- `near-blank`: capture-backed evidence suggests the page has very little visible content.
- `text-extraction-empty`: no extractable text, but pixel coverage suggests visible content, usually an image-only or scanned page.
- `oversize-page`: page dimensions differ from the document median by more than 20%.
- `render-failed`: capture or pixel inspection failed.
- `page-out-of-range`: requested page does not exist.

Blank-page policy:

- Without `--capture`, do not emit `blank`, `near-blank`, or `text-extraction-empty`; set `pixelCoverage` to `null` and treat textless pages as inconclusive rather than faulty.
- With `--capture`, `blank` requires both low text length and low non-white pixel coverage.
- With `--capture`, `text-extraction-empty` requires `normalizedTextLength === 0` and `pixelCoverage >= 0.02`.
- Pixel sampling should render at the requested DPI and inspect a downsampled grid to avoid loading huge image buffers.

Thresholds:

- `normalizedTextLength < 16` marks the page as a blank text candidate.
- `pixelCoverage < 0.005` is low visual coverage.
- `blank` requires `normalizedTextLength < 16` and `pixelCoverage < 0.005`.
- `near-blank` requires capture evidence and means either `pixelCoverage < 0.02`, or `0 < normalizedTextLength < 64` and `pixelCoverage < 0.10`, but not both below the stricter `blank` thresholds.
- Warning priority is deterministic: evaluate `blank` first, then `text-extraction-empty`, then `near-blank`. If `normalizedTextLength === 0` and `pixelCoverage >= 0.02`, emit only `text-extraction-empty` among the three blank-related warnings.
- Pixel coverage is measured from a 64 x 64 sample grid over the rendered page, ignoring pixels with alpha <= 16 and treating pixels with RGB values all >= 245 as white.
- Inspect capture default DPI is 72 unless the caller passes `--dpi`.
- `oversize-page` compares page width and height independently against the full-document median width and height. It fires if either dimension differs by more than 20%.
- `oversize-page` is enabled by default. It computes full-document median dimensions from pdf.js page metadata only, without rendering. This metadata pass is allowed even when the inspected page set is small.
- If metadata collection fails, skip `oversize-page`; add `render-failed` only if rendering was attempted and failed.

Summary semantics:

- `summary.checked` is the number of valid pages inspected.
- `summary.warningCount` is the number of inspected pages with one or more warnings.
- `summary.warnings` contains only warning categories that have at least one page.

JSON shape:

```json
{
  "pdfPath": "/abs/main.pdf",
  "numPages": 370,
  "pages": [
    {
      "page": 370,
      "width": 1733.39,
      "height": 657.64,
      "textLength": 0,
      "normalizedTextLength": 0,
      "pixelCoverage": 0.001,
      "warnings": ["blank"]
    }
  ],
  "summary": {
    "checked": 3,
    "warningCount": 1,
    "warnings": {
      "blank": [370]
    }
  }
}
```

### 4.7 Single-Page Capture

```bash
latexview capture [--out <image.webp>] [--dpi <dpi>] [--json] <pdf> <page>
```

Purpose: capture exactly one rendered PDF page as WebP.

Rules:

- Output is always WebP.
- Default output path is `<pdf-stem>-page-<page>.webp`.
- Default DPI is 216 unless the caller passes `--dpi`.
- Page numbers are 1-based.
- If users pass `--out`, extension normalization still forces `.webp`.
- Return exactly one generated image path in JSON.

JSON shape:

```json
{
  "pdfPath": "/abs/main.pdf",
  "page": 1,
  "outPath": "/abs/main-page-1.webp",
  "dpi": 216,
  "ok": true
}
```

### 4.8 Find Enhancements

```bash
latexview find [--json] [--url <viewer-url>] [--jump-if-unique] <pdf> <text>
```

Changes:

- JSON output includes `count`.
- If `--url` is present, each match includes `url`.
- Snippets preserve original case and punctuation.
- Matching handles:
  - NFKC normalization.
  - whitespace differences.
  - soft hyphen `\u00ad`.
  - line-end hyphenation when PDF extraction splits words.
- `--jump-if-unique` calls the jump endpoint only when:
  - exactly one match exists,
  - `--url` is provided,
  - the viewer accepts the jump.
- `find` never captures images. If the agent needs visual evidence, it should choose one match page and call `capture`.
- A single `find` invocation loads the PDF document once and reuses that document for matching and snippet extraction.

JSON shape:

```json
{
  "query": "long rendered text",
  "count": 1,
  "matches": [
    {
      "page": 70,
      "snippet": "... original case snippet ...",
      "url": "http://127.0.0.1:4550/?page=70"
    }
  ],
  "jump": {
    "attempted": true,
    "ok": true,
    "url": "http://127.0.0.1:4550/?page=70"
  }
}
```

If `--jump-if-unique` is omitted, `jump` is still present as `{ "attempted": false }`.

## 5. Registry Design

State directory:

```text
${os.tmpdir()}/latexview/servers/
```

Registry entry path:

```text
${port}.json
```

Entry shape:

```json
{
  "schemaVersion": 1,
  "pid": 12345,
  "host": "127.0.0.1",
  "port": 4550,
  "origin": "http://127.0.0.1:4550",
  "url": "http://127.0.0.1:4550/?page=1",
  "pdfPath": "/abs/main.pdf",
  "pdfName": "main.pdf",
  "startedAt": "2026-05-24T10:00:00.000Z"
}
```

The registry entry `schemaVersion` and the health response `schemaVersion` are independent schema numbers. They may differ and must be interpreted in their own namespaces.

Registry writes:

- Write to a temporary file in the same directory, then rename atomically.
- Create parent directories recursively.
- Registry write failure should warn but not prevent serve startup.

Registry reads:

- Ignore invalid JSON entries and remove them if possible.
- Verify that each entry's port still responds to `/health`.
- Do not trust pid alone.

Health endpoint:

- `/health` returns `{ ok, app: "latexview", schemaVersion: 2, version, pdfName }`.
- `app` is the stable identity marker used by `status`, `list`, and `stop`.
- `schemaVersion` is the health response schema version.
- `version` remains the document version used by the browser for hot reload and may change when the PDF file mtime changes.
- Keep absolute `pdfPath` out of `/health`; it lives only in local registry files and structured CLI outputs that already have local filesystem context.

## 6. Module Plan

New or refactored modules:

- `src/pdf-info.js`
  - `readPdfInfo(pdfPath)`
  - `readPageText(document, pageNumber)`
  - shared pdf.js loading helpers.
- `src/page-selection.js`
  - parse `--pages`, aliases, `--range`, `--from`/`--to`, duplicate removal, bounds checks.
- `src/registry.js`
  - state dir, write, list, probe, prune, stop.
- `src/inspect.js`
  - inspect selected pages and produce warnings.
- `src/tooling.js`
  - shared wrapper helpers used by MCP and Pi if practical.

Existing modules to update:

- `src/args.js`
  - parse new commands and flags.
- `src/cli.js`
  - route new commands.
  - write registry after successful serve.
  - improve find JSON.
- `src/pdf-search.js`
  - preserve original snippets.
  - add URL/jump metadata support.
  - add soft hyphen and hyphenation normalization.
- `src/capture.js`
  - keep single-page WebP capture as the only public image artifact command.
  - expose lower-level render helpers if needed by `inspect` pixel sampling.
- `codex/plugins/latexview/mcp/latexview-mcp.js`
  - expose the full command surface.
  - fix serve port behavior.
- `pi/extensions/latexview.js`
  - expose the full command surface.
  - fix serve port behavior and signal lifetime.
  - remove dead delegation.

## 7. Wrapper Tool Surface

Both Codex MCP and Pi must expose the same primary tools:

- `latexview_serve`
- `latexview_info`
- `latexview_status`
- `latexview_list`
- `latexview_stop`
- `latexview_find`
- `latexview_jump`
- `latexview_capture`
- `latexview_inspect`
- `latexview_help`

Compatibility aliases:

- Pi may keep `latexview_capture_page` and `latexview_find_text`, but they must delegate through shared local functions, not through `pi.getAllTools()`.
- Codex may omit aliases unless needed for marketplace compatibility.

Structured output:

- Every tool should return human text plus structured details.
- Details must include absolute paths for generated files.
- The capture tool must state WebP explicitly and return only one image path per call.

## 8. Skill Docs

Codex and Pi skills should contain the same workflow:

1. Use `latexview_info` to understand page count and dimensions.
2. Use `latexview_serve` to open a viewer.
3. Use `latexview_inspect` with `first,middle,last` for quick QA.
4. Use `latexview_find` with long snippets to locate rendered text.
5. Use `latexview_jump` or `--jump-if-unique` when a match is unique.
6. Use `latexview_capture` on one selected page for visual evidence.
7. Use `latexview_status/list/stop` to clean up long-running viewers.

The docs must warn:

- Do not assume `textLength === 0` means blank.
- Prefer long search snippets.
- Capture output is always WebP.
- Do not request or return multiple page images from a single tool call.

## 9. Testing Plan

Unit tests:

- `args.test.js`
  - all new command parsers.
  - invalid page specs and ranges.
  - explicit vs implicit port.
- `page-selection.test.js`
  - aliases, ranges, duplicates, bounds.
- `pdf-info.test.js`
  - page count and dimensions on fixture PDFs.
- `pdf-search.test.js`
  - original-case snippets.
  - URL in JSON.
  - soft hyphen and hyphenation matching.
  - unique jump decision without real network by injecting jump function.
- `inspect.test.js`
  - text-only warning behavior.
  - capture-enabled blank detection.
  - threshold boundary behavior for `blank`, `near-blank`, and `text-extraction-empty`.
  - `normalizedTextLength === 0` and `pixelCoverage` in `[0.02, 0.10)` emits only `text-extraction-empty` among blank-related warnings.
  - capture-enabled inspection does not persist or return multiple image paths.
  - `middle` alias resolution.
  - page-out-of-range warnings.
- `capture.test.js`
  - single-page WebP capture.
  - default output path behavior.
  - WebP extension normalization.
  - invalid and out-of-range page errors.
  - dependency-missing messages.
- `registry.test.js`
  - atomic writes.
  - stale pruning.
  - no pid-only stop.
  - stop timeout and `failed` status after 1500 ms when `/health` remains latexview.

Integration tests:

- `cli.test.js`
  - `info --json`.
  - `inspect --json --pages first,last`.
  - `capture --json`.
  - `find --json --url`.
  - `find --jump-if-unique` against a running preview.
- `mcp.test.js`
  - list all new tools.
  - call `info`, `inspect`, `capture`, `status`.
  - start two servers without explicit ports and assert different URLs.
- Pi extension runtime test:
  - load extension with a fake `pi.registerTool`.
  - verify tool schemas.
  - invoke short-lived tools.
  - verify `serve` command construction omits `--port` when absent.
  - verify aborting the serve signal does not kill the detached server.

Smoke tests:

- Browser smoke remains focused on UI rendering, hot reload, jump, thumbnails.
- Add an optional smoke path for `inspect` + single-page `capture` on the fixture.

Dependency guards:

- Skip capture-dependent tests when `pdftoppm` or `cwebp` is missing.

## 10. Acceptance Criteria

The iteration is complete when:

- `npm test` passes.
- `npm run smoke` passes on a machine with Playwright browser support.
- Starting two wrapper `serve` calls without explicit `port` succeeds and uses different ports.
- Pi `serve` survives aborting the tool-call signal.
- `latexview list` shows live servers and prunes stale entries.
- `latexview status --json <viewer>` returns the stable success shape for a running viewer and the stable failure shape for an unreachable viewer.
- `latexview stop --all` stops live latexview servers without relying on pid alone.
- `latexview info --json <pdf>` returns page count and dimensions.
- `latexview inspect --json --pages first,middle,last <pdf>` returns stable warnings and never calls a textless image page blank unless capture/pixel evidence supports it.
- `latexview capture --json <pdf> <page>` writes exactly one WebP file and returns exactly one absolute `outPath`.
- `latexview find --json --url <viewer> <pdf> <query>` includes `count`, per-match `url`, and original-case snippets.
- Codex MCP and Pi expose the same primary tools.
- Codex and Pi skill docs contain the same agent QA workflow.

## 11. Rollout Order

1. Fix wrapper `serve` behavior and Pi signal lifetime.
2. Add registry, `status`, `list`, and `stop`.
3. Add `info`.
4. Add page selection parser.
5. Add `inspect`.
6. Tighten single-page `capture` JSON and WebP behavior.
7. Enhance `find`.
8. Update MCP wrapper.
9. Update Pi extension and compatibility aliases.
10. Update skills and README.
11. Expand tests and smoke coverage.

## 12. Settled Decisions

- Final product adjustment after Auditor round 05: keep the image artifact surface single-page only.
- Multi-page image export is out of scope for this iteration. `capture-range` and contact-sheet composition are intentionally omitted; agents use `inspect` to choose pages and `capture` to view one page image at a time.
- `/health` does not expose absolute `pdfPath`; registry files retain that path locally.
