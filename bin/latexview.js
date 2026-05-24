#!/usr/bin/env node
import { runCli } from '../src/cli.js';

const result = await runCli(process.argv.slice(2));
const exitCode = typeof result === 'number' ? result : result.exitCode;
if (exitCode !== 0) {
  process.exitCode = exitCode;
}
