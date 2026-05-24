import { basename, extname, resolve } from 'node:path';

const usage = `Usage: latexview [serve] [options] <file.pdf>
       latexview info [--json] <file.pdf>
       latexview status [--json] [--url <viewer-url>]
       latexview list [--json]
       latexview stop [--json] (--url <viewer-url> | --port <port> | --pid <pid> | --all)
       latexview inspect [--json] [--pages <spec> | --range <from-to> | --from <n> --to <n> | --all] [--capture] [--dpi <dpi>] [--max-pages <n>] <file.pdf>
       latexview find [--json] [--url <viewer-url>] [--jump-if-unique] <file.pdf> <text>
       latexview jump [--url <viewer-url>] <page>
       latexview capture [--json] [--out <image.webp>] [--dpi <dpi>] <file.pdf> <page>

Options:
  --host <host>    Host to bind, default 127.0.0.1
  --port <port>    Port to bind, default 4545
  --page <page>    Initial page, default 1
  --open           Open the viewer in the default browser
  --no-open        Do not open a browser window
  -h, --help       Show help
`;

const defaultBaseUrl = 'http://127.0.0.1:4545';

export function helpText() {
  return usage;
}

function readPositiveInteger(name, value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function readPort(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error('port must be an integer between 0 and 65535.');
  }
  return parsed;
}

function readPid(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('pid must be a positive integer.');
  }
  return parsed;
}

function readRequiredValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`${option} requires a value.\n\n${usage}`);
  }
  return value;
}

export function parseCliArgs(argv, options = {}) {
  const cwd = options.cwd ?? process.cwd();

  if (argv.includes('--help') || argv.includes('-h')) {
    return { command: 'help' };
  }

  const command = argv[0];
  if (command === 'serve') return parseServeArgs(argv.slice(1), cwd);
  if (command === 'info') return parseInfoArgs(argv.slice(1), cwd);
  if (command === 'status') return parseStatusArgs(argv.slice(1));
  if (command === 'list') return parseListArgs(argv.slice(1));
  if (command === 'stop') return parseStopArgs(argv.slice(1));
  if (command === 'inspect') return parseInspectArgs(argv.slice(1), cwd);
  if (command === 'find') return parseFindArgs(argv.slice(1), cwd);
  if (command === 'jump' || command === 'goto') return parseJumpArgs(argv.slice(1));
  if (command === 'capture' || command === 'shot') return parseCaptureArgs(argv.slice(1), cwd);

  return parseServeArgs(argv, cwd);
}

function parseServeArgs(argv, cwd) {
  const parsed = {
    command: 'serve',
    pdfPath: undefined,
    host: '127.0.0.1',
    port: 4545,
    page: 1,
    open: false,
    requestedPort: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--host') {
      parsed.host = readRequiredValue(argv, index, token);
      index += 1;
    } else if (token === '--port') {
      parsed.port = readPort(readRequiredValue(argv, index, token));
      parsed.requestedPort = true;
      index += 1;
    } else if (token === '--page') {
      parsed.page = readPositiveInteger('page', readRequiredValue(argv, index, token));
      index += 1;
    } else if (token === '--open') {
      parsed.open = true;
    } else if (token === '--no-open') {
      parsed.open = false;
    } else if (token.startsWith('-')) {
      throw new Error(`Unknown option: ${token}\n\n${usage}`);
    } else if (!parsed.pdfPath) {
      parsed.pdfPath = resolve(cwd, token);
    } else {
      throw new Error(`Unexpected argument: ${token}\n\n${usage}`);
    }
  }

  if (!parsed.pdfPath) {
    throw new Error(usage);
  }

  return parsed;
}

function parseInfoArgs(argv, cwd) {
  const positionals = [];
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--json') {
      json = true;
    } else if (token.startsWith('-')) {
      throw new Error(`Unknown option: ${token}\n\n${usage}`);
    } else {
      positionals.push(token);
    }
  }

  if (positionals.length !== 1) {
    throw new Error(`info requires exactly one PDF path.\n\n${usage}`);
  }

  return {
    command: 'info',
    pdfPath: resolve(cwd, positionals[0]),
    json
  };
}

function parseStatusArgs(argv) {
  let json = false;
  let baseUrl = defaultBaseUrl;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--json') {
      json = true;
    } else if (token === '--url') {
      baseUrl = readRequiredValue(argv, index, token);
      index += 1;
    } else if (token.startsWith('-')) {
      throw new Error(`Unknown option: ${token}\n\n${usage}`);
    } else {
      throw new Error(`Unexpected argument: ${token}\n\n${usage}`);
    }
  }

  return { command: 'status', baseUrl, json };
}

function parseListArgs(argv) {
  let json = false;
  for (const token of argv) {
    if (token === '--json') json = true;
    else if (token.startsWith('-')) throw new Error(`Unknown option: ${token}\n\n${usage}`);
    else throw new Error(`Unexpected argument: ${token}\n\n${usage}`);
  }
  return { command: 'list', json };
}

function parseStopArgs(argv) {
  let json = false;
  const targets = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--json') {
      json = true;
    } else if (token === '--url') {
      targets.push({ type: 'url', value: readRequiredValue(argv, index, token) });
      index += 1;
    } else if (token === '--port') {
      targets.push({ type: 'port', value: readPort(readRequiredValue(argv, index, token)) });
      index += 1;
    } else if (token === '--pid') {
      targets.push({ type: 'pid', value: readPid(readRequiredValue(argv, index, token)) });
      index += 1;
    } else if (token === '--all') {
      targets.push({ type: 'all', value: true });
    } else if (token.startsWith('-')) {
      throw new Error(`Unknown option: ${token}\n\n${usage}`);
    } else {
      throw new Error(`Unexpected argument: ${token}\n\n${usage}`);
    }
  }

  if (targets.length !== 1) {
    throw new Error(`stop requires exactly one target selector.\n\n${usage}`);
  }

  return { command: 'stop', target: targets[0], json };
}

function parseInspectArgs(argv, cwd) {
  const positionals = [];
  let json = false;
  let capture = false;
  let dpi = 72;
  let maxPages;
  const sources = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--json') {
      json = true;
    } else if (token === '--capture') {
      capture = true;
    } else if (token === '--dpi') {
      dpi = readPositiveInteger('dpi', readRequiredValue(argv, index, token));
      index += 1;
    } else if (token === '--max-pages') {
      maxPages = readPositiveInteger('max-pages', readRequiredValue(argv, index, token));
      index += 1;
    } else if (token === '--pages') {
      sources.push({ type: 'pages', value: readRequiredValue(argv, index, token) });
      index += 1;
    } else if (token === '--range') {
      sources.push({ type: 'range', value: readRequiredValue(argv, index, token) });
      index += 1;
    } else if (token === '--from') {
      sources.push({ type: 'from', value: readRequiredValue(argv, index, token) });
      index += 1;
    } else if (token === '--to') {
      sources.push({ type: 'to', value: readRequiredValue(argv, index, token) });
      index += 1;
    } else if (token === '--all') {
      sources.push({ type: 'all', value: true });
    } else if (token.startsWith('-')) {
      throw new Error(`Unknown option: ${token}\n\n${usage}`);
    } else {
      positionals.push(token);
    }
  }

  if (positionals.length !== 1) {
    throw new Error(`inspect requires exactly one PDF path.\n\n${usage}`);
  }

  const from = sources.find((source) => source.type === 'from');
  const to = sources.find((source) => source.type === 'to');
  const nonFromToSources = sources.filter((source) => source.type !== 'from' && source.type !== 'to');
  let pageSelection;

  if (from || to) {
    if (!from || !to) {
      throw new Error('inspect requires --from and --to to be supplied together.');
    }
    if (nonFromToSources.length > 0) {
      throw new Error('inspect page source flags are mutually exclusive.');
    }
    pageSelection = { type: 'fromTo', from: from.value, to: to.value };
  } else if (nonFromToSources.length === 0) {
    pageSelection = { type: 'default' };
  } else if (nonFromToSources.length === 1) {
    pageSelection = nonFromToSources[0].type === 'all'
      ? { type: 'all' }
      : nonFromToSources[0];
  } else {
    throw new Error('inspect page source flags are mutually exclusive.');
  }

  if (maxPages !== undefined) {
    pageSelection.maxPages = maxPages;
  }

  return {
    command: 'inspect',
    pdfPath: resolve(cwd, positionals[0]),
    json,
    pageSelection,
    capture,
    dpi,
    maxPages
  };
}

function parseFindArgs(argv, cwd) {
  const positionals = [];
  let baseUrl;
  let json = false;
  let jumpIfUnique = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--url') {
      baseUrl = readRequiredValue(argv, index, token);
      index += 1;
    } else if (token === '--json') {
      json = true;
    } else if (token === '--jump-if-unique') {
      jumpIfUnique = true;
    } else if (token.startsWith('-')) {
      throw new Error(`Unknown option: ${token}\n\n${usage}`);
    } else {
      positionals.push(token);
    }
  }

  if (positionals.length < 2) {
    throw new Error(`find requires a PDF path and text query.\n\n${usage}`);
  }

  return {
    command: 'find',
    pdfPath: resolve(cwd, positionals[0]),
    query: positionals.slice(1).join(' '),
    baseUrl,
    json,
    ...(jumpIfUnique ? { jumpIfUnique } : {})
  };
}

function parseJumpArgs(argv) {
  const positionals = [];
  let baseUrl = defaultBaseUrl;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--url') {
      baseUrl = readRequiredValue(argv, index, token);
      index += 1;
    } else if (token.startsWith('-')) {
      throw new Error(`Unknown option: ${token}\n\n${usage}`);
    } else {
      positionals.push(token);
    }
  }

  if (positionals.length !== 1) {
    throw new Error(`jump requires exactly one page number.\n\n${usage}`);
  }

  return {
    command: 'jump',
    page: readPositiveInteger('page', positionals[0]),
    baseUrl
  };
}

function normalizeWebpPath(cwd, value) {
  const outPath = resolve(cwd, value);
  const extension = extname(outPath);
  if (extension.toLowerCase() === '.webp') {
    return outPath;
  }
  return extension ? `${outPath.slice(0, -extension.length)}.webp` : `${outPath}.webp`;
}

function defaultCapturePath(cwd, pdfPath, page) {
  const stem = basename(pdfPath, extname(pdfPath));
  return resolve(cwd, `${stem}-page-${page}.webp`);
}

function parseCaptureArgs(argv, cwd) {
  const positionals = [];
  let outPath;
  let dpi = 216;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--out' || token === '-o') {
      outPath = normalizeWebpPath(cwd, readRequiredValue(argv, index, token));
      index += 1;
    } else if (token === '--dpi') {
      dpi = readPositiveInteger('dpi', readRequiredValue(argv, index, token));
      index += 1;
    } else if (token === '--json') {
      json = true;
    } else if (token.startsWith('-')) {
      throw new Error(`Unknown option: ${token}\n\n${usage}`);
    } else {
      positionals.push(token);
    }
  }

  if (positionals.length !== 2) {
    throw new Error(`capture requires a PDF path and page number.\n\n${usage}`);
  }

  const pdfPath = resolve(cwd, positionals[0]);
  const page = readPositiveInteger('page', positionals[1]);

  return {
    command: 'capture',
    pdfPath,
    page,
    outPath: outPath ?? defaultCapturePath(cwd, pdfPath, page),
    dpi,
    ...(json ? { json } : {})
  };
}
