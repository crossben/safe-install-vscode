/**
 * Finds where each dependency is declared in a package.json, by offset, so
 * markers sit on the right key. A small tolerant scanner (no runtime
 * dependency): it reads strings, numbers, literals, objects and arrays, and
 * only records keys directly inside the dependency sections.
 */

export const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;

export interface DeclaredDependency {
  readonly name: string;
  readonly section: (typeof DEPENDENCY_SECTIONS)[number];
  /** Offsets of the key, quotes excluded. */
  readonly start: number;
  readonly end: number;
}

export function declaredDependencies(text: string): DeclaredDependency[] {
  const out: DeclaredDependency[] = [];
  let i = 0;

  const ws = (): void => {
    while (i < text.length) {
      const c = text[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') i++;
      else if (text.startsWith('//', i)) {
        const nl = text.indexOf('\n', i);
        i = nl < 0 ? text.length : nl;
      } else if (text.startsWith('/*', i)) {
        const close = text.indexOf('*/', i + 2);
        i = close < 0 ? text.length : close + 2;
      } else break;
    }
  };

  const str = (): { value: string; start: number; end: number } | undefined => {
    if (text[i] !== '"') return undefined;
    const start = i + 1;
    let value = '';
    i++;
    while (i < text.length && text[i] !== '"') {
      if (text[i] === '\\') {
        const esc = text[i + 1] ?? '';
        value += esc === 'u' ? String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16)) : esc;
        i += esc === 'u' ? 6 : 2;
      } else {
        value += text[i] ?? '';
        i++;
      }
    }
    const end = i;
    i++; // closing quote
    return { value, start, end };
  };

  // section: the dependency section this object is, if any.
  const value = (depth: number, section?: DeclaredDependency['section']): void => {
    ws();
    const c = text[i];
    if (c === '{') {
      i++;
      for (;;) {
        ws();
        if (text[i] === '}') {
          i++;
          return;
        }
        const key = str();
        if (!key) {
          i++; // not valid JSON here: skip a character and keep going
          if (i >= text.length) return;
          continue;
        }
        ws();
        if (text[i] === ':') i++;
        if (section) {
          out.push({ name: key.value, section, start: key.start, end: key.end });
          value(depth + 1);
        } else {
          const next = depth === 0 ? DEPENDENCY_SECTIONS.find((s) => s === key.value) : undefined;
          value(depth + 1, next);
        }
        ws();
        if (text[i] === ',') i++;
        if (i >= text.length) return;
      }
    } else if (c === '[') {
      i++;
      for (;;) {
        ws();
        if (text[i] === ']' || i >= text.length) {
          i++;
          return;
        }
        value(depth + 1);
        ws();
        if (text[i] === ',') i++;
      }
    } else if (c === '"') {
      str();
    } else {
      while (i < text.length && !',}] \t\r\n'.includes(text[i] ?? '')) i++;
    }
  };

  value(0);
  return out;
}
