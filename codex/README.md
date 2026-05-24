# latexview Codex Plugin

This folder is a local Codex marketplace root for the `latexview` plugin.

## Layout

- `.agents/plugins/marketplace.json` exposes the local marketplace.
- `plugins/latexview/.codex-plugin/plugin.json` is the plugin manifest.
- `plugins/latexview/skills/latexview/SKILL.md` contains the workflow skill.
- `plugins/latexview/.mcp.json` registers the MCP server.
- `plugins/latexview/mcp/latexview-mcp.js` wraps the full CLI tool surface.

## Tools

- `latexview_serve`
- `latexview_find`
- `latexview_jump`
- `latexview_capture`
- `latexview_help`

## Install Locally

From the `latexview` project root:

```bash
codex plugin marketplace add ./codex
```

Restart Codex, open Plugins, choose `latexview Local`, and install `latexview`.
