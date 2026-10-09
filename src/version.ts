/** The first CLI release with `scripts --format json` and `explain --format json`. */
export const MIN_CLI_VERSION = '0.2.3';

export type Semver = readonly [number, number, number];

/**
 * Reads `safe-install X.Y.Z (commit, date) os/arch`. Development builds
 * ("dev") return null: they are accepted, there is nothing to compare.
 */
export function parseVersionLine(line: string): Semver | null {
  const m = /^safe-install v?(\d+)\.(\d+)\.(\d+)\b/.exec(line.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function isDevBuild(line: string): boolean {
  return /^safe-install dev\b/.test(line.trim());
}

export function atLeast(v: Semver, min: string): boolean {
  const m = min.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const a = v[i] ?? 0;
    const b = m[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}
