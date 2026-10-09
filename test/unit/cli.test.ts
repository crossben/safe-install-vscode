import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { CliError, packageArg, run, runJSON, type CliCommand } from '../../src/cli';

const fake: CliCommand = {
  file: process.execPath,
  prefix: [path.resolve(__dirname, '../../../test/fixtures/cli/fake-cli.js')],
};
const opts = { cwd: __dirname, timeoutMs: 10_000 };

function withMode<T>(mode: string, fn: () => Promise<T>): Promise<T> {
  process.env.FAKE_CLI_MODE = mode;
  return fn().finally(() => {
    delete process.env.FAKE_CLI_MODE;
  });
}

async function rejectsWith(p: Promise<unknown>, kind: CliError['kind']): Promise<void> {
  await assert.rejects(p, (e: unknown) => e instanceof CliError && e.kind === kind);
}

describe('cli.run', () => {
  it('passes arguments verbatim, without a shell, and turns the update check off', async () => {
    const res = await withMode('echo', () => run(fake, ['why', '$(touch pwned)', 'a;b', '`x`'], opts));
    assert.deepEqual(JSON.parse(res.stdout), { args: ['why', '$(touch pwned)', 'a;b', '`x`'], update: '1' });
  });

  it('treats exit 1 as a result and parses JSON', async () => {
    const res = await run(fake, ['check', '--format', 'json'], opts);
    assert.equal(res.code, 1);
    assert.ok((await runJSON(fake, ['check', '--format', 'json'], opts)) !== null);
  });

  it('reports exit 3 with the CLI message', async () => {
    await assert.rejects(
      withMode('tool-error', () => runJSON(fake, ['check'], opts)),
      (e: unknown) => e instanceof CliError && e.kind === 'tool-error' && e.message === 'registry metadata could not be fetched',
    );
  });

  it('kills a hung CLI at the timeout', async () => {
    await rejectsWith(withMode('hang', () => run(fake, [], { ...opts, timeoutMs: 300 })), 'timeout');
  });

  it('can be cancelled', async () => {
    const ac = new AbortController();
    const p = withMode('hang', () => run(fake, [], { ...opts, signal: ac.signal }));
    setTimeout(() => {
      ac.abort();
    }, 100);
    await rejectsWith(p, 'cancelled');
  });

  it('caps the output size', async () => {
    await rejectsWith(withMode('flood', () => run(fake, [], { ...opts, maxBytes: 1024 })), 'too-large');
  });

  it('rejects output that is not JSON', async () => {
    await rejectsWith(withMode('not-json', () => runJSON(fake, [], opts)), 'bad-output');
  });

  it('reports a missing executable', async () => {
    await rejectsWith(run({ file: '/nonexistent/safe-install' }, [], opts), 'not-found');
  });
});

describe('packageArg', () => {
  it('accepts names and specs', () => {
    for (const ok of ['ms', 'ms@2.1.3', '@types/node', '@scope/pkg@1.0.0-beta.1']) {
      assert.equal(packageArg(ok), ok);
    }
  });

  it('never lets a name become a flag or carry whitespace', () => {
    for (const bad of ['--force', '-y', '', 'a b', 'a\nb', 'x'.repeat(301)]) {
      assert.throws(() => packageArg(bad), CliError, bad);
    }
  });
});
