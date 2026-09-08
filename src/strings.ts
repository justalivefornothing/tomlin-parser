import type { Position } from './errors.js';
import { Scanner, isControl } from './scanner.js';

/** Parse any of the four string forms; the scanner must be on `"` or `'`. */
export function parseString(s: Scanner): string {
  if (s.startsWith('"""')) return multiLine(s, '"');
  if (s.startsWith("'''")) return multiLine(s, "'");
  return singleLine(s, s.peek() as '"' | "'");
}

function singleLine(s: Scanner, quote: '"' | "'"): string {
  const start = s.position();
  s.skip(1);
  let out = '';
  for (;;) {
    const ch = s.peek();
    if (ch === quote) {
      s.skip(1);
      return out;
    }
    if (ch === '' || ch === '\n' || ch === '\r') throw s.error('Unterminated string', start);
    if (ch === '\\' && quote === '"') {
      out += escape(s);
      continue;
    }
    if (isControl(ch)) throw s.error(`Control character U+${hex(ch)} in string`);
    out += s.next();
  }
}

/**
 * Multi-line strings: a newline right after the opening delimiter is dropped,
 * up to two extra quotes may sit against the closing delimiter, and (basic
 * form only) a backslash at the end of a line swallows all whitespace up to
 * the next non-blank character.
 */
function multiLine(s: Scanner, quote: '"' | "'"): string {
  const start = s.position();
  s.skip(3);
  s.eatNewline();
  let out = '';
  for (;;) {
    const ch = s.peek();
    if (ch === '') throw s.error('Unterminated multi-line string', start);
    if (ch === quote) {
      let run = 0;
      while (s.peek(run) === quote) run++;
      if (run >= 3) {
        if (run > 5) throw s.error('Too many quotes closing a multi-line string');
        s.skip(run);
        return out + quote.repeat(run - 3);
      }
      s.skip(run);
      out += quote.repeat(run);
      continue;
    }
    if (ch === '\\' && quote === '"') {
      if (isLineEndingBackslash(s)) {
        s.skip(1);
        while (s.eatNewline() || eatBlank(s)) {
          /* elide whitespace and line breaks */
        }
        continue;
      }
      out += escape(s);
      continue;
    }
    if (ch === '\n' || (ch === '\r' && s.peek(1) === '\n')) {
      out += ch === '\r' ? '\r\n' : '\n';
      s.eatNewline();
      continue;
    }
    if (isControl(ch)) throw s.error(`Control character U+${hex(ch)} in string`);
    out += s.next();
  }
}

function isLineEndingBackslash(s: Scanner): boolean {
  let i = 1;
  while (s.peek(i) === ' ' || s.peek(i) === '\t') i++;
  return s.peek(i) === '\n' || (s.peek(i) === '\r' && s.peek(i + 1) === '\n');
}

function eatBlank(s: Scanner): boolean {
  if (s.peek() !== ' ' && s.peek() !== '\t') return false;
  s.skip(1);
  return true;
}

const SIMPLE_ESCAPES: Record<string, string> = {
  b: '\b',
  t: '\t',
  n: '\n',
  f: '\f',
  r: '\r',
  '"': '"',
  '\\': '\\',
};

function escape(s: Scanner): string {
  const at = s.position();
  s.skip(1);
  const ch = s.next();
  const simple = SIMPLE_ESCAPES[ch];
  if (simple !== undefined) return simple;
  if (ch === 'u') return unicodeEscape(s, 4, at);
  if (ch === 'U') return unicodeEscape(s, 8, at);
  throw s.error(`Invalid escape sequence "\\${ch}"`, at);
}

function unicodeEscape(s: Scanner, digits: number, at: Position): string {
  let text = '';
  for (let i = 0; i < digits; i++) {
    const ch = s.peek();
    if (!/^[0-9A-Fa-f]$/.test(ch)) {
      throw s.error(`Expected ${digits} hex digits in unicode escape`, at);
    }
    text += ch;
    s.skip(1);
  }
  const code = parseInt(text, 16);
  if (code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
    throw s.error(`Escape \\${digits === 4 ? 'u' : 'U'}${text} is not a Unicode scalar value`, at);
  }
  return String.fromCodePoint(code);
}

function hex(ch: string): string {
  return ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
}
