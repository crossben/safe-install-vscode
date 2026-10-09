import * as assert from 'node:assert/strict';
import { codeSpan } from '../../src/text';

describe('codeSpan', () => {
  it('cannot be closed early or carry line breaks', () => {
    const s = codeSpan('a` [x](command:evil) `b\n# h\u2028<img src=x>');
    assert.equal(s.split('`').length, 3, s); // exactly one opening and one closing backtick
    assert.ok(!/[\n\u2028]/.test(s));
  });

  it('clips long text and never renders empty', () => {
    assert.ok(codeSpan('x'.repeat(1000)).length < 310);
    assert.equal(codeSpan(''), '` `');
  });
});
