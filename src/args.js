import { basename, extname, resolve } from 'node:path';

const usage = `Usage: latexview [options] <file.pdf>
       latexview find [--json] [--url <viewer-url>] <file.pdf> <text>
       latexview jump [--url <viewer-url>] <page>
       latexview capture [--out <image.webp>] [--dpi <dpi>] <file.pdf> <page>

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

export function parseCliArgs(argv, options = {}) {
  const cwd = options.cwd ?? process.cwd();

  if (argv.includes('--help') || argv.includes('-h')) {
    return { command: 'help' };
  }

  if (argv[0] === 'find') {
    return parseFindArgs(argv.slice(1), cwd);
  }

  if (argv[0] === 'jump' || argv[0] === 'goto') {
    return parseJumpArgs(argv.slice(1));
  }

  if (argv[0] === 'capture' || argv[0] === 'shot') {
    return parseCaptureArgs(argv.slice(1), cwd);
  }

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
      parsed.host = argv[index + 1];
      index += 1;
    } else if (token === '--port') {
      parsed.port = readPort(argv[index + 1]);
      parsed.requestedPort = true;
      index += 1;
    } else if (token === '--page') {
      parsed.page = readPositiveInteger('page', argv[index + 1]);
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

function readRequiredValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`${option} requires a value.\n\n${usage}`);
  }
  return value;
}

function parseFindArgs(argv, cwd) {
  const positionals = [];
  let baseUrl;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--url') {
      baseUrl = readRequiredValue(argv, index, token);
      index += 1;
    } else if (token === '--json') {
      json = true;
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
    json
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

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--out' || token === '-o') {
      outPath = normalizeWebpPath(cwd, readRequiredValue(argv, index, token));
      index += 1;
    } else if (token === '--dpi') {
      dpi = readPositiveInteger('dpi', readRequiredValue(argv, index, token));
      index += 1;
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
    dpi
  };
}
