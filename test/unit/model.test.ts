import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { parseCheck, parseExplanations, parseScripts, parseWhy } from '../../src/model';
import { atLeast, isDevBuild, parseVersionLine } from '../../src/version';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(path.resolve(__dirname, '../../../test/fixtures/cli', name), 'utf8')) as unknown;

describe('model', () => {
  it('reads real check output', () => {
    const r = parseCheck(fixture('check.json'));
    assert.equal(r.worst, 'block');
    const p = r.packages[0];
    assert.equal(p?.id, 'lodahs@1.0.0');
    assert.equal(p.direct, true);
    assert.ok(p.findings.some((f) => f.rule === 'SI-POP-001' && f.severity === 'high'));
  });

  it('reads real scripts, explain and why output', () => {
    const [s] = parseScripts(fixture('scripts.json'));
    assert.equal(s?.id, 'esbuild@0.25.10');
    assert.equal(s.state, 'unapproved');
    assert.deepEqual(s.stages, ['postinstall']);
    assert.equal(s.scripts.postinstall, 'node install.js');
    assert.ok(parseExplanations(fixture('explain.json')).length >= 20);
    assert.deepEqual(parseWhy(fixture('why.json'))[0]?.paths, [['ms@2.1.3']]);
  });

  it('drops or defaults anything malformed', () => {
    const r = parseCheck({
      worst: 'apocalyptic',
      packages: [{ id: 'a@1', name: 'a', level: 7, findings: [{ rule: 'R', severity: 'x' }, 'junk'] }, null, { id: '' }],
      extra: true,
    });
    assert.equal(r.worst, 'none');
    assert.equal(r.packages.length, 1);
    assert.deepEqual(r.packages[0]?.findings, [{ rule: 'R', severity: 'none', message: '' }]);
    assert.throws(() => parseCheck([]));
    const [s] = parseScripts([{ id: 'b@1', name: 'b', state: 'hacked', stages: ['postinstall', 'evil'], scripts: { postinstall: 'x', evil: 1 } }]);
    assert.equal(s?.state, 'unapproved');
    assert.deepEqual(s.stages, ['postinstall']);
  });
});

describe('version', () => {
  it('parses and compares', () => {
    assert.deepEqual(parseVersionLine('safe-install 0.2.3 (abc, d) linux/amd64'), [0, 2, 3]);
    assert.equal(parseVersionLine('safe-install dev (none, unknown) linux/amd64'), null);
    assert.equal(isDevBuild('safe-install dev (none, unknown) linux/amd64'), true);
    assert.equal(atLeast([0, 2, 3], '0.2.3'), true);
    assert.equal(atLeast([0, 10, 0], '0.2.3'), true);
    assert.equal(atLeast([0, 2, 2], '0.2.3'), false);
  });
});
