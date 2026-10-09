/**
 * Typed views of the CLI's JSON output. Parsing is defensive: unknown fields
 * are ignored, missing ones get safe defaults, and anything that is not the
 * expected shape is dropped rather than trusted.
 */

export type Level = 'none' | 'low' | 'medium' | 'high' | 'block';
export type ApprovalState = 'unapproved' | 'approved' | 'changed' | 'expired' | 'provenance';

const LEVELS: readonly Level[] = ['none', 'low', 'medium', 'high', 'block'];
const STATES: readonly ApprovalState[] = ['unapproved', 'approved', 'changed', 'expired', 'provenance'];

export interface Finding {
  readonly rule: string;
  readonly severity: Level;
  readonly message: string;
}

export interface CheckedPackage {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly direct: boolean;
  readonly dev: boolean;
  readonly score: number;
  readonly level: Level;
  readonly findings: readonly Finding[];
  readonly error: string;
}

export interface CheckReport {
  readonly lockfile: string;
  readonly worst: Level;
  readonly skipped: number;
  readonly failed: number;
  readonly warnings: readonly string[];
  readonly diffBase: string;
  readonly packages: readonly CheckedPackage[];
}

export interface ScriptPackage {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly direct: boolean;
  readonly dir: string;
  readonly scripts: Readonly<Record<string, string>>;
  readonly stages: readonly string[];
  readonly implicit: boolean;
  readonly level: Level;
  readonly state: ApprovalState;
  readonly findings: readonly Finding[];
}

export interface Explanation {
  readonly id: string;
  readonly title: string;
  readonly why: string;
  readonly fix: string;
}

export interface WhyResult {
  readonly id: string;
  readonly direct: boolean;
  readonly paths: readonly (readonly string[])[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const bool = (v: unknown): boolean => v === true;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const level = (v: unknown): Level => (LEVELS.includes(v as Level) ? (v as Level) : 'none');

export function levelRank(l: Level): number {
  return LEVELS.indexOf(l);
}

function findings(v: unknown): Finding[] {
  return arr(v)
    .filter(isObj)
    .map((f) => ({ rule: str(f.rule), severity: level(f.severity), message: str(f.message) }))
    .filter((f) => f.rule !== '');
}

export function parseCheck(v: unknown): CheckReport {
  if (!isObj(v)) throw new Error('check: expected an object');
  const diff = isObj(v.diff) ? v.diff : {};
  return {
    lockfile: str(v.lockfile),
    worst: level(v.worst),
    skipped: num(v.skipped),
    failed: num(v.failed),
    warnings: arr(v.warnings).map(str).filter(Boolean),
    diffBase: str(diff.base),
    packages: arr(v.packages)
      .filter(isObj)
      .map((p) => ({
        id: str(p.id),
        name: str(p.name),
        version: str(p.version),
        direct: bool(p.direct),
        dev: bool(p.dev),
        score: num(p.score),
        level: level(p.level),
        findings: findings(p.findings),
        error: str(p.error),
      }))
      .filter((p) => p.id !== '' && p.name !== ''),
  };
}

export function parseScripts(v: unknown): ScriptPackage[] {
  return arr(v)
    .filter(isObj)
    .map((p) => {
      const scripts: Record<string, string> = {};
      if (isObj(p.scripts)) {
        for (const [stage, cmd] of Object.entries(p.scripts)) {
          if (typeof cmd === 'string') scripts[stage] = cmd;
        }
      }
      const state = STATES.includes(p.state as ApprovalState) ? (p.state as ApprovalState) : 'unapproved';
      return {
        id: str(p.id),
        name: str(p.name),
        version: str(p.version),
        direct: bool(p.direct),
        dir: str(p.dir),
        scripts,
        stages: arr(p.stages).map(str).filter((s) => s in scripts),
        implicit: bool(p.implicit),
        level: level(p.level),
        state,
        findings: findings(p.findings),
      };
    })
    .filter((p) => p.id !== '' && p.name !== '');
}

function explanation(e: Obj): Explanation {
  return { id: str(e.id), title: str(e.title), why: str(e.why), fix: str(e.fix) };
}

export function parseExplanations(v: unknown): Explanation[] {
  return (Array.isArray(v) ? v : [v]).filter(isObj).map(explanation).filter((e) => e.id !== '');
}

export function parseWhy(v: unknown): WhyResult[] {
  return arr(v)
    .filter(isObj)
    .map((w) => ({
      id: str(w.id),
      direct: bool(w.direct),
      paths: arr(w.paths).map((p) => arr(p).map(str)),
    }))
    .filter((w) => w.id !== '');
}
