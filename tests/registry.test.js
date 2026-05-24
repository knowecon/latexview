import { afterEach, describe, expect, test } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli, startPreview } from '../src/cli.js';
import { makePdf } from './pdf-fixture.js';

const previews = [];
const stateDirs = [];

afterEach(async () => {
  await Promise.all(previews.splice(0).map((preview) => preview.close()));
  await Promise.all(stateDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makePdfFixture() {
  const dir = await mkdtemp(join(tmpdir(), 'latexview-registry-'));
  const pdfPath = join(dir, 'main.pdf');
  await writeFile(pdfPath, makePdf(['registry bytes']));
  return {
    dir,
    pdfPath,
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    }
  };
}

function io() {
  const output = [];
  const errors = [];
  return {
    output,
    errors,
    streams: {
      stdout: { write: (text) => output.push(text) },
      stderr: { write: (text) => errors.push(text) }
    }
  };
}

describe('registry lifecycle commands', () => {
  test('status and list report live registered previews', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'latexview-state-'));
    stateDirs.push(stateDir);
    const fixture = await makePdfFixture();

    try {
      const preview = await startPreview({
        pdfPath: fixture.pdfPath,
        host: '127.0.0.1',
        port: 0,
        page: 2,
        requestedPort: true,
        stateDir
      });
      previews.push(preview);

      const statusIo = io();
      const status = await runCli(['status', '--json', '--url', preview.url], statusIo.streams, {
        keepAlive: false,
        stateDir
      });
      expect(status.exitCode).toBe(0);
      const statusJson = JSON.parse(statusIo.output.join(''));
      expect(statusJson.ok).toBe(true);
      expect(statusJson.health.app).toBe('latexview');
      expect(statusJson.registry.found).toBe(true);
      expect(statusJson.registry.pdfPath).toBe(fixture.pdfPath);

      const listIo = io();
      const listed = await runCli(['list', '--json'], listIo.streams, {
        keepAlive: false,
        stateDir
      });
      expect(listed.exitCode).toBe(0);
      const listJson = JSON.parse(listIo.output.join(''));
      expect(listJson.entries).toHaveLength(1);
      expect(listJson.entries[0].url).toContain('?page=2');
    } finally {
      await fixture.cleanup();
    }
  });

  test('stop refuses unmatched targets with an empty results array', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'latexview-state-'));
    stateDirs.push(stateDir);
    const stopIo = io();

    const result = await runCli(['stop', '--json', '--port', '65000'], stopIo.streams, {
      keepAlive: false,
      stateDir
    });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(stopIo.output.join(''))).toEqual({ results: [] });
  });
});
