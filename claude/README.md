# latexview Claude Code Plugin

This folder is a local Claude Code marketplace root for the `latexview` plugin.

## Layout

- `.claude-plugin/marketplace.json` exposes the local marketplace.
- `plugins/latexview/.claude-plugin/plugin.json` is the plugin manifest.
- `plugins/latexview/skills/latexview/SKILL.md` contains the workflow skill.
- `plugins/latexview/scripts/latexview-tools.js` implements the tool handlers.
- `plugins/latexview/.mcp.json` registers the MCP server.
- `plugins/latexview/mcp/latexview-mcp.js` exposes the script-backed tools to Claude Code.

## Tools

- `latexview_serve`
- `latexview_info`
- `latexview_status`
- `latexview_list`
- `latexview_stop`
- `latexview_inspect`
- `latexview_find`
- `latexview_jump`
- `latexview_capture`
- `latexview_help`

## Install Locally

From the `latexview` project root:

```bash
claude plugin marketplace add ./claude
claude plugin install latexview@latexview-local
```

Restart Claude Code or run `/reload-plugins` after installing.
