import * as path from 'node:path';
import { readdirSync } from 'node:fs';
import Mocha from 'mocha';

/** Entry point VS Code calls inside the extension host. */
export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'bdd', color: true, timeout: 20_000 });
  for (const file of readdirSync(__dirname)) {
    if (file.endsWith('.test.js')) mocha.addFile(path.join(__dirname, file));
  }
  return new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) reject(new Error(`${String(failures)} test(s) failed`));
      else resolve();
    });
  });
}
