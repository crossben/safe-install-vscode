#!/usr/bin/env node
// Stands in for the safe-install binary in tests: replays real CLI output
// recorded in this folder, and misbehaves on demand.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const fixture = (name) => fs.readFileSync(path.join(__dirname, name), 'utf8');
const mode = process.env.FAKE_CLI_MODE || '';

if (mode === 'hang') setInterval(() => {}, 1000);
else if (mode === 'flood') process.stdout.write('x'.repeat(4 * 1024 * 1024));
else if (mode === 'tool-error') {
  process.stderr.write('safe-install: registry metadata could not be fetched\n');
  process.exit(3);
} else if (mode === 'not-json') process.stdout.write('hello\n');
else if (mode === 'echo') process.stdout.write(JSON.stringify({ args, update: process.env.SAFE_INSTALL_NO_UPDATE_CHECK ?? null }));
else if (args[0] === '--version') process.stdout.write(`safe-install ${process.env.FAKE_CLI_VERSION || '0.2.3'} (abc, 2026-10-09) linux/amd64\n`);
else if (args[0] === 'check') {
  let out = fixture('check.json');
  if (mode === 'hostile') {
    const report = JSON.parse(out);
    report.packages[0].findings[0].message = 'see [docs](command:workbench.action.terminal.new) `x` <img src=x onerror=alert(1)>';
    out = JSON.stringify(report);
  }
  process.stdout.write(out);
  process.exit(args.includes('--fail-on') ? 0 : 1);
} else if (['scripts', 'explain', 'why'].includes(args[0])) process.stdout.write(fixture(`${args[0]}.json`));
else {
  process.stderr.write(`safe-install: unknown command ${args[0]}\n`);
  process.exit(3);
}
