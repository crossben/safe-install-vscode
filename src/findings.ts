/**
 * Turns a check report into per-dependency results for one package.json.
 * Pure (no `vscode`), so it is unit tested; diagnostics.ts renders it.
 */
import type { CheckReport, CheckedPackage, Level } from './model';
import { levelRank } from './model';

export interface DependencyResult {
  /** The package as declared in package.json. */
  readonly name: string;
  readonly level: Level;
  /** Its own findings, when the direct package itself is risky. */
  readonly own: CheckedPackage | undefined;
  /** Risky packages it brings in, with the chain that leads to each. */
  readonly via: readonly { readonly pkg: CheckedPackage; readonly path: readonly string[] }[];
}

/** First chain from the project to each package: package id -> [direct id, …, package id]. */
export type Chains = ReadonlyMap<string, readonly string[]>;

/** Max transitive packages looked up per check (each needs a `why`). */
export const MAX_TRANSITIVE = 20;

export function risky(report: CheckReport, min: Level): CheckedPackage[] {
  return report.packages.filter((p) => p.error === '' && p.findings.length > 0 && levelRank(p.level) >= levelRank(min) && p.level !== 'none');
}

export const nameOf = (id: string): string => id.slice(0, id.lastIndexOf('@') > 0 ? id.lastIndexOf('@') : id.length);

export function byDependency(report: CheckReport, min: Level, chains: Chains): Map<string, DependencyResult> {
  const out = new Map<string, { level: Level; own: CheckedPackage | undefined; via: DependencyResult['via'][number][] }>();
  const entry = (name: string) => {
    let e = out.get(name);
    if (!e) {
      e = { level: 'none', own: undefined, via: [] };
      out.set(name, e);
    }
    return e;
  };
  const raise = (e: { level: Level }, l: Level): void => {
    if (levelRank(l) > levelRank(e.level)) e.level = l;
  };
  for (const pkg of risky(report, min)) {
    if (pkg.direct) {
      const e = entry(pkg.name);
      e.own = pkg;
      raise(e, pkg.level);
      continue;
    }
    const chain = chains.get(pkg.id);
    const head = chain?.[0];
    if (!chain || !head) continue;
    const e = entry(nameOf(head));
    e.via.push({ pkg, path: chain });
    raise(e, pkg.level);
  }
  return new Map([...out].map(([name, e]) => [name, { name, ...e }]));
}
