/**
 * Text from packages (names, finding messages) is untrusted: a package must not
 * be able to add links, images, HTML or command URIs to a hover. Untrusted text
 * only ever goes into code spans, after this.
 */
export function codeSpan(s: string, max = 300): string {
  const clean = Array.from(s.slice(0, max))
    .map((c) => (c === '`' ? "'" : isControl(c) ? ' ' : c))
    .join('')
    .trim();
  return '`' + (clean === '' ? ' ' : clean) + (s.length > max ? '…' : '') + '`';
}

function isControl(c: string): boolean {
  const n = c.charCodeAt(0);
  return n < 0x20 || n === 0x7f || n === 0x2028 || n === 0x2029;
}

/** Quick pick labels render `$(icon)` syntax; package text must not. */
export function plain(s: string): string {
  return s.replace(/\$\(/g, '$\u200b(').replace(/[\r\n]+/g, ' ');
}
