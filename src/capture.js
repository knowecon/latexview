import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';

function execFilePromise(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function captureError(error) {
  if (error.code === 'ENOENT') {
    return new Error(`${error.commandName} is required for capture. Install it and try again.`);
  }

  const detail = error.stderr?.trim() || error.message;
  return new Error(`Failed to capture PDF page: ${detail}`);
}

async function runCaptureCommand(command, args) {
  try {
    await execFilePromise(command, args);
  } catch (error) {
    error.commandName = command;
    throw error;
  }
}

export async function capturePageImage({ pdfPath, page, outPath, dpi = 216 }) {
  await mkdir(dirname(outPath), { recursive: true });
  const tempDir = await mkdtemp(join(dirname(outPath), '.latexview-capture-'));
  const prefix = join(tempDir, 'page');
  const generatedPath = `${prefix}.png`;

  try {
    await runCaptureCommand('pdftoppm', [
      '-f',
      String(page),
      '-l',
      String(page),
      '-singlefile',
      '-png',
      '-r',
      String(dpi),
      pdfPath,
      prefix
    ]);
    await runCaptureCommand('cwebp', [
      '-quiet',
      '-q',
      '92',
      '-sharp_yuv',
      generatedPath,
      '-o',
      outPath
    ]);
  } catch (error) {
    throw captureError(error);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  return {
    pdfPath,
    page,
    outPath,
    dpi
  };
}
