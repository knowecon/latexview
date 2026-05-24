import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

export function defaultRegistryDir() {
  return join(tmpdir(), 'latexview', 'servers');
}

function registryDir(options = {}) {
  return options.stateDir ?? defaultRegistryDir();
}

function entryPathForPort(port, options = {}) {
  return join(registryDir(options), `${port}.json`);
}

function normalizeOrigin(value) {
  const url = new URL(value);
  return url.origin;
}

export async function writeRegistryEntry(entry, options = {}) {
  const dir = registryDir(options);
  await mkdir(dir, { recursive: true });
  const targetPath = entryPathForPort(entry.port, options);
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(entry, null, 2)}\n`);
  await rename(tempPath, targetPath);
}

export async function removeRegistryEntry(port, options = {}) {
  await rm(entryPathForPort(port, options), { force: true });
}

export async function readRegistryEntries(options = {}) {
  let names;
  try {
    names = await readdir(registryDir(options));
  } catch {
    return [];
  }

  const entries = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const path = join(registryDir(options), name);
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8'));
      entries.push({
        ...parsed,
        registryPath: path
      });
    } catch {
      await rm(path, { force: true });
    }
  }
  return entries;
}

async function fetchJson(url, timeoutMs = 500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      return { ok: false, status: response.status, health: null };
    }
    return { ok: true, status: response.status, health: await response.json() };
  } catch (error) {
    return { ok: false, error, health: null };
  } finally {
    clearTimeout(timeout);
  }
}

export async function probeEntry(entry, options = {}) {
  const origin = entry.origin ?? normalizeOrigin(entry.url);
  const result = await fetchJson(`${origin}/health`, options.timeoutMs ?? 500);
  const live = result.ok && result.health?.app === 'latexview';
  return {
    entry,
    live,
    health: result.health,
    origin,
    error: result.error
  };
}

function publicEntry(entry, health) {
  return {
    pid: entry.pid,
    host: entry.host,
    port: entry.port,
    origin: entry.origin,
    url: entry.url,
    pdfPath: entry.pdfPath,
    pdfName: entry.pdfName,
    startedAt: entry.startedAt,
    health
  };
}

export async function listLiveEntries(options = {}) {
  const entries = await readRegistryEntries(options);
  const liveEntries = [];

  for (const entry of entries) {
    const probe = await probeEntry(entry, options);
    if (probe.live) {
      liveEntries.push(publicEntry(entry, probe.health));
    } else {
      await removeRegistryEntry(entry.port, options);
    }
  }

  return {
    schemaVersion: 1,
    entries: liveEntries
  };
}

export async function getStatus(baseUrl, options = {}) {
  const origin = normalizeOrigin(baseUrl);
  const entries = await readRegistryEntries(options);
  const entry = entries.find((candidate) => (candidate.origin ?? normalizeOrigin(candidate.url)) === origin);
  const result = await fetchJson(`${origin}/health`, options.timeoutMs ?? 500);

  if (!result.ok || result.health?.app !== 'latexview') {
    return {
      ok: false,
      url: origin,
      health: null,
      registry: entry
        ? {
          found: true,
          pid: entry.pid,
          pdfPath: entry.pdfPath,
          startedAt: entry.startedAt
        }
        : { found: false },
      error: result.health?.app && result.health.app !== 'latexview'
        ? 'Viewer is not latexview'
        : 'Viewer is unreachable'
    };
  }

  return {
    ok: true,
    url: origin,
    health: result.health,
    registry: entry
      ? {
        found: true,
        pid: entry.pid,
        pdfPath: entry.pdfPath,
        startedAt: entry.startedAt
      }
      : { found: false }
  };
}

function matchesTarget(entry, target) {
  if (target.type === 'all') return true;
  if (target.type === 'port') return entry.port === target.value;
  if (target.type === 'pid') return entry.pid === target.value;
  if (target.type === 'url') return (entry.origin ?? normalizeOrigin(entry.url)) === normalizeOrigin(target.value);
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitUntilUnreachable(origin, options = {}) {
  const deadline = Date.now() + (options.stopTimeoutMs ?? 1500);
  while (Date.now() < deadline) {
    const result = await fetchJson(`${origin}/health`, 100);
    if (!result.ok || result.health?.app !== 'latexview') return true;
    await sleep(options.pollMs ?? 100);
  }
  return false;
}

export async function stopEntries(target, options = {}) {
  const entries = await readRegistryEntries(options);
  const selected = entries.filter((entry) => matchesTarget(entry, target));
  if (selected.length === 0) {
    return { results: [] };
  }

  const results = [];
  for (const entry of selected) {
    const probe = await probeEntry(entry, options);
    if (!probe.live) {
      await removeRegistryEntry(entry.port, options);
      results.push({ pid: entry.pid, url: entry.url, status: 'stale' });
      continue;
    }

    try {
      process.kill(entry.pid, 'SIGTERM');
    } catch {
      await removeRegistryEntry(entry.port, options);
      results.push({ pid: entry.pid, url: entry.url, status: 'stale' });
      continue;
    }

    const stopped = await waitUntilUnreachable(probe.origin, options);
    if (stopped) {
      await removeRegistryEntry(entry.port, options);
      results.push({ pid: entry.pid, url: entry.url, status: 'stopped' });
    } else {
      results.push({ pid: entry.pid, url: entry.url, status: 'failed' });
    }
  }

  return { results };
}

export function makeRegistryEntry({ preview, config }) {
  const origin = new URL(preview.url).origin;
  return {
    schemaVersion: 1,
    pid: process.pid,
    host: config.host,
    port: preview.port,
    origin,
    url: preview.url,
    pdfPath: preview.pdfPath,
    pdfName: basename(preview.pdfPath),
    startedAt: new Date().toISOString(),
    requestedPort: config.requestedPort
  };
}
