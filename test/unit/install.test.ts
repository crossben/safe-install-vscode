import * as assert from 'node:assert/strict';
import { installHint } from '../../src/install';

describe('installHint', () => {
  it('gives the README command per OS', () => {
    assert.match(installHint('darwin', false).command ?? '', /brew install --cask safe-install$/);
    assert.equal(installHint('darwin', true).command, 'brew upgrade --cask safe-install');
    assert.match(installHint('win32', false).command ?? '', /scoop install safe-install$/);
    assert.equal(installHint('win32', true).command, 'scoop update safe-install');
    assert.equal(installHint('linux', false).command, undefined);
    assert.match(installHint('linux', false).how, /\.deb/);
  });
});
