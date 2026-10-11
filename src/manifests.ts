/**
 * Where a project declares its dependencies, per ecosystem, and where each
 * one is (offsets, for markers). Pure: no `vscode` import, unit tested.
 */
import { declaredDependencies, type DeclaredDependency } from './manifest';

/** Lockfile -> the manifest whose dependencies get the markers. */
export const MANIFEST_FOR: Readonly<Record<string, string>> = {
  'package-lock.json': 'package.json',
  'npm-shrinkwrap.json': 'package.json',
  'pnpm-lock.yaml': 'package.json',
  'yarn.lock': 'package.json',
  'bun.lock': 'package.json',
  'bun.lockb': 'package.json',
  'uv.lock': 'pyproject.toml',
  'poetry.lock': 'pyproject.toml',
  'Pipfile.lock': 'Pipfile',
  'requirements.txt': 'requirements.txt',
  'composer.lock': 'composer.json',
};

export const LOCKFILES = Object.keys(MANIFEST_FOR);
export const MANIFESTS = [...new Set(Object.values(MANIFEST_FOR))];

export function pythonName(n: string): string {
  return n.toLowerCase().replace(/[-_.]+/g, '-');
}

const COMPOSER_PLATFORM = /^(php|php-64bit|hhvm|composer|composer-plugin-api|composer-runtime-api|ext-.+|lib-.+)$/i;

/** The dependencies a manifest declares, by its file name. */
export function manifestDependencies(fileName: string, text: string): DeclaredDependency[] {
  switch (fileName) {
    case 'package.json':
      return declaredDependencies(text);
    case 'composer.json':
      return declaredDependencies(text, ['require', 'require-dev'])
        .filter((d) => !COMPOSER_PLATFORM.test(d.name))
        .map((d) => ({ ...d, name: d.name.toLowerCase() }));
    case 'pyproject.toml':
    case 'Pipfile':
      return tomlDependencies(text);
    case 'requirements.txt':
      return requirementsDependencies(text);
  }
  return [];
}

const REQ_NAME = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/;

function requirementsDependencies(text: string): DeclaredDependency[] {
  const out: DeclaredDependency[] = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    const m = REQ_NAME.exec(line);
    if (m?.[1] && trimmed !== '' && !trimmed.startsWith('#') && !trimmed.startsWith('-')) {
      const start = offset + line.indexOf(m[1]);
      out.push({ name: pythonName(m[1]), section: 'requirements', start, end: start + m[1].length });
    }
    offset += line.length + 1;
  }
  return out;
}

/**
 * pyproject.toml (PEP 621 arrays, [dependency-groups], Poetry tables) and
 * Pipfile ([packages], [dev-packages]). A line-based reader: enough for
 * where dependencies are declared, without a TOML library.
 */
function tomlDependencies(text: string): DeclaredDependency[] {
  const out: DeclaredDependency[] = [];
  let table = '';
  let inArray = false;
  let offset = 0;
  const arrayKeys = (t: string, key: string): boolean =>
    (t === 'project' && key === 'dependencies') || t === 'project.optional-dependencies' || t === 'dependency-groups';
  const keyTables = /^(tool\.poetry\.(dev-)?dependencies|tool\.poetry\.group\.[^.]+\.dependencies|packages|dev-packages)$/;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    const header = /^\[\s*([^\]]+?)\s*\]$/.exec(trimmed);
    if (header?.[1] && !trimmed.startsWith('[[')) {
      table = header[1].replace(/\s+/g, '');
      inArray = false;
    } else if (!trimmed.startsWith('#')) {
      const assign = /^([A-Za-z0-9_.-]+|"[^"]+")\s*=\s*(.*)$/.exec(trimmed);
      let scan = '';
      let scanFrom = 0;
      if (inArray) {
        scan = line;
      } else if (assign?.[1] && assign[2] !== undefined) {
        const key = assign[1].replace(/"/g, '');
        if (arrayKeys(table, key) && assign[2].startsWith('[')) {
          inArray = true;
          scanFrom = line.indexOf('[');
          scan = line;
        } else if (keyTables.test(table) && key.toLowerCase() !== 'python') {
          const start = offset + line.indexOf(key);
          out.push({ name: pythonName(key), section: table, start, end: start + key.length });
        }
      }
      if (inArray) {
        // Each quoted string (either quote style, which may contain the
        // other) is one requirement; its name is at the start.
        const strings = /"([^"]*)"|'([^']*)'/g;
        strings.lastIndex = scanFrom;
        for (let m = strings.exec(scan); m; m = strings.exec(scan)) {
          const name = REQ_NAME.exec(m[1] ?? m[2] ?? '')?.[1];
          if (!name) continue;
          const start = offset + m.index + 1;
          out.push({ name: pythonName(name), section: table, start, end: start + name.length });
        }
        if (scan.slice(scanFrom).includes(']')) inArray = false;
      }
    }
    offset += line.length + 1;
  }
  return out;
}
