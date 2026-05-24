import { describe, expect, test } from 'vitest';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { startPreview } from '../src/cli.js';

function hasCommand(command) {
  try {
    execFileSync('which', [command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function run(command, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    execFile(command, args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || error.message));
        return;
      }
      resolvePromise({ stdout, stderr });
    });
  });
}

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    if (!/Executable doesn't exist/.test(error.message)) {
      throw error;
    }
    return chromium.launch({ headless: true, channel: 'chrome' });
  }
}

function tex(iteration) {
  return String.raw`\documentclass{article}
\usepackage[margin=1in]{geometry}
\title{latexview live compile ${iteration}}
\begin{document}
\maketitle
\section{Iteration ${iteration}}
This PDF is rebuilt by latexmk while latexview is serving a cached PDF.
\newpage
Second page marker ${iteration}.
\newpage
Third page marker ${Date.now()}.
\end{document}
`;
}

const maybeTest = hasCommand('latexmk') ? test : test.skip;

describe('real LaTeX compilation preview', () => {
  maybeTest('keeps the browser alive while latexmk rewrites the served PDF', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'latexview-latexmk-'));
    const texPath = join(dir, 'main.tex');
    const pdfPath = join(dir, 'main.pdf');
    let browser;
    let preview;
    let crashed = false;
    const pageErrors = [];
    const consoleErrors = [];

    try {
      await writeFile(texPath, tex(0));
      await run('latexmk', ['-pdf', '-interaction=nonstopmode', '-halt-on-error', 'main.tex'], dir);

      preview = await startPreview({
        pdfPath,
        host: '127.0.0.1',
        port: 0,
        page: 2,
        requestedPort: true
      });

      browser = await launchBrowser();
      const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
      page.on('crash', () => {
        crashed = true;
      });
      page.on('pageerror', (error) => {
        pageErrors.push(error.message);
      });
      page.on('console', (message) => {
        if (message.type() === 'error') {
          consoleErrors.push(message.text());
        }
      });

      await page.goto(preview.url, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => {
        const canvas = document.getElementById('pdf-canvas');
        const status = document.getElementById('status');
        return canvas?.width > 0 && canvas?.height > 0 && status?.textContent === 'live';
      }, null, { timeout: 10000 });

      for (let iteration = 1; iteration <= 2; iteration += 1) {
        const previousVersion = await page.evaluate(() => document.documentElement.dataset.latexviewVersion);
        await writeFile(texPath, tex(iteration));
        await run('latexmk', ['-pdf', '-interaction=nonstopmode', '-halt-on-error', 'main.tex'], dir);
        await page.waitForFunction((oldVersion) => {
          const canvas = document.getElementById('pdf-canvas');
          const status = document.getElementById('status');
          return document.documentElement.dataset.latexviewVersion !== oldVersion
            && canvas?.width > 0
            && canvas?.height > 0
            && status?.textContent === 'live';
        }, previousVersion, { timeout: 15000 });
      }

      expect(crashed).toBe(false);
      expect(pageErrors).toEqual([]);
      expect(consoleErrors).toEqual([]);
    } finally {
      await browser?.close();
      await preview?.close();
      await rm(dir, { recursive: true, force: true });
    }
  }, 30000);
});
