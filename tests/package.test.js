import { describe, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

async function readProjectFile(path) {
  return readFile(new URL(path, root), 'utf8');
}

describe('package identity', () => {
  test('publishes the latexview command and package name', async () => {
    const pkg = JSON.parse(await readProjectFile('package.json'));

    expect(pkg.name).toBe('latexview');
    expect(pkg.bin).toEqual({
      latexview: './bin/latexview.js'
    });
  });

  test('Codex plugin registers latexview tools backed by plugin scripts', async () => {
    const plugin = JSON.parse(await readProjectFile('codex/plugins/latexview/.codex-plugin/plugin.json'));
    const mcp = JSON.parse(await readProjectFile('codex/plugins/latexview/.mcp.json'));
    const mcpSource = await readProjectFile('codex/plugins/latexview/mcp/latexview-mcp.js');
    const scriptSource = await readProjectFile('codex/plugins/latexview/scripts/latexview-tools.js');

    expect(plugin.skills).toBe('./skills/');
    expect(plugin.mcpServers).toBe('./.mcp.json');
    expect(plugin.interface.capabilities).toEqual(['Read', 'Write', 'Shell']);
    expect(mcp.mcpServers.latexview.command).toBe('node');
    expect(mcp.mcpServers.latexview.args).toContain('./mcp/latexview-mcp.js');
    expect(mcpSource).toContain("from '../scripts/latexview-tools.js'");

    for (const toolName of [
      'latexview_serve',
      'latexview_info',
      'latexview_status',
      'latexview_list',
      'latexview_stop',
      'latexview_inspect',
      'latexview_find',
      'latexview_jump',
      'latexview_capture',
      'latexview_help'
    ]) {
      expect(scriptSource).toContain(`name: '${toolName}'`);
    }
  });

  test('Pi extension wraps every latexview CLI command as a tool', async () => {
    const extensionSource = await readProjectFile('pi/extensions/latexview.js');

    expect(extensionSource).toContain('function latexviewCommand(args)');
    expect(extensionSource).toContain('process.env.LATEXVIEW_CLI');
    expect(extensionSource).toContain("../../bin/latexview.js");

    for (const toolName of [
      'latexview_serve',
      'latexview_find',
      'latexview_jump',
      'latexview_capture',
      'latexview_help'
    ]) {
      expect(extensionSource).toContain(`name: '${toolName}'`);
    }
  });
});
