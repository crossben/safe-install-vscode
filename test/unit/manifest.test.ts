import * as assert from 'node:assert/strict';
import { declaredDependencies } from '../../src/manifest';
import { byDependency, nameOf } from '../../src/findings';
import type { CheckReport } from '../../src/model';

describe('declaredDependencies', () => {
  it('finds keys in the three install sections only', () => {
    const text = `{
  "name": "x",
  "scripts": { "lodash": "not a dep" },
  "dependencies": { "ms": "2.1.3", "@scope/pkg": "^1.0.0" },
  // jsonc comments are tolerated
  "devDependencies": { "vitest": "3" },
  "peerDependencies": { "react": "*" },
  "nested": { "dependencies": { "nope": "1" } },
  "optionalDependencies": { "fsevents": "2" }
}`;
    const deps = declaredDependencies(text);
    assert.deepEqual(
      deps.map((d) => `${d.section}:${d.name}`),
      ['dependencies:ms', 'dependencies:@scope/pkg', 'devDependencies:vitest', 'optionalDependencies:fsevents'],
    );
    for (const d of deps) assert.equal(text.slice(d.start, d.end), d.name);
  });

  it('survives broken or hostile input', () => {
    for (const bad of ['', '{', '{"dependencies": {"a": ', '[1,2', '{"dependencies": {"a\\"b": "1"}}', '\u0000{}', '{"a": tru']) {
      assert.doesNotThrow(() => declaredDependencies(bad));
    }
    assert.deepEqual(declaredDependencies('{"dependencies": {"a\\"b": "1"}}').map((d) => d.name), ['a"b']);
  });
});

describe('byDependency', () => {
  const pkg = (id: string, direct: boolean, level: 'low' | 'medium' | 'high' | 'block') => ({
    id, name: nameOf(id), version: id.split('@').pop() ?? '', direct, dev: false, score: 50, level,
    findings: [{ rule: 'SI-X', severity: level, message: 'm' }], error: '',
  });
  const report: CheckReport = {
    lockfile: 'package-lock.json', worst: 'block', skipped: 0, failed: 0, warnings: [], diffBase: '',
    packages: [
      pkg('lodahs@1.0.0', true, 'block'),
      pkg('debug@4.4.3', false, 'high'),
      pkg('tiny@1.0.0', false, 'low'),
      { ...pkg('@scope/a@2.0.0', true, 'medium') },
    ],
  };
  const chains = new Map([
    ['debug@4.4.3', ['express@5.2.1', 'debug@4.4.3']],
    ['tiny@1.0.0', ['express@5.2.1', 'tiny@1.0.0']],
  ]);

  it('puts direct findings on the package and transitive ones on what brings them in', () => {
    const r = byDependency(report, 'medium', chains);
    assert.equal(r.get('lodahs')?.level, 'block');
    assert.equal(r.get('@scope/a')?.level, 'medium');
    assert.equal(r.get('express')?.level, 'high');
    assert.deepEqual(r.get('express')?.via.map((v) => v.pkg.id), ['debug@4.4.3']); // tiny is below medium
  });

  it('handles scoped names', () => {
    assert.equal(nameOf('@scope/a@2.0.0'), '@scope/a');
    assert.equal(nameOf('ms@2.1.3'), 'ms');
  });
});
