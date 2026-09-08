import { TomlDateTime } from './datetime.js';
import type { Scanner } from './scanner.js';

const DEC_INT = /^[+-]?(0|[1-9](_?[0-9])*)$/;
const FLOAT = /^[+-]?(0|[1-9](_?[0-9])*)(\.[0-9](_?[0-9])*)?([eE][+-]?[0-9](_?[0-9])*)?$/;
const PREFIXED: Record<string, { digits: RegExp; radix: number }> = {
  '0x': { digits: /^[0-9A-Fa-f](_?[0-9A-Fa-f])*$/, radix: 16 },
  '0o': { digits: /^[0-7](_?[0-7])*$/, radix: 8 },
  '0b': { digits: /^[01](_?[01])*$/, radix: 2 },
};
const SPECIAL: Record<string, number> = {
  inf: Infinity,
  '+inf': Infinity,
  '-inf': -Infinity,
  nan: NaN,
  '+nan': NaN,
  '-nan': NaN,
};
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{2}):(\d{2}):(\d{2})(\.\d+)?$/;
const DATE_TIME = /^(\d{4}-\d{2}-\d{2})[Tt ](\d{2}:\d{2}:\d{2}(?:\.\d+)?)([Zz]|[+-]\d{2}:\d{2})?$/;

/**
 * Numbers and date/times share an alphabet, so both are read as one greedy
 * token and then classified. The scanner must be on a digit, sign, `i` or `n`.
 */
export function parseNumberOrDateTime(s: Scanner): number | TomlDateTime {
  const at = s.position();
  let token = readToken(s);
  // A local date followed by a space and a time is one value: `1979-05-27 07:32:00`.
  if (DATE.test(token) && s.peek() === ' ' && /[0-9]/.test(s.peek(1))) {
    s.skip(1);
    token += ' ' + readToken(s);
  }
  const fail = (reason: string) => s.error(reason, at);

  const dateTime = token.match(DATE_TIME);
  if (dateTime) {
    const [, date, time, offset] = dateTime as unknown as [string, string, string, string?];
    checkDate(date, fail);
    checkTime(time, fail);
    if (offset === undefined) return TomlDateTime.localDateTime(date, time);
    return TomlDateTime.offsetDateTime(date, time, checkOffset(offset, fail));
  }
  if (DATE.test(token)) {
    checkDate(token, fail);
    return TomlDateTime.localDate(token);
  }
  if (TIME.test(token)) {
    checkTime(token, fail);
    return TomlDateTime.localTime(token);
  }

  const special = SPECIAL[token];
  if (special !== undefined) return special;

  const prefixed = PREFIXED[token.slice(0, 2)];
  if (prefixed) {
    const digits = token.slice(2);
    if (!prefixed.digits.test(digits)) throw fail(`Invalid ${token.slice(0, 2)} integer "${token}"`);
    return parseInt(digits.replaceAll('_', ''), prefixed.radix);
  }
  if (DEC_INT.test(token) || (FLOAT.test(token) && /[.eE]/.test(token))) {
    return Number(token.replaceAll('_', ''));
  }
  throw fail(diagnose(token));
}

function readToken(s: Scanner): string {
  let text = '';
  while (/^[0-9A-Za-z_+\-.:]$/.test(s.peek())) text += s.next();
  return text;
}

function diagnose(token: string): string {
  if (/^[+-]?0[0-9]/.test(token)) return `Leading zeros are not allowed in "${token}"`;
  if (/^_|_$|__|_[^0-9A-Fa-f]|[^0-9A-Fa-f]_/.test(token)) return `Underscores must sit between digits in "${token}"`;
  if (/^[+-]?\.|\.$|\.[eE]|[eE][+-]?\./.test(token)) return `Floats need digits on both sides of the decimal point in "${token}"`;
  if (/^[+-]0[xob]/.test(token)) return `Prefixed integers cannot have a sign in "${token}"`;
  return `Invalid value "${token}"`;
}

type Fail = (reason: string) => Error;

function checkDate(date: string, fail: Fail): void {
  const [, y, m, d] = date.match(DATE)!.map(Number) as [number, number, number, number];
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (m < 1 || m > 12 || d < 1 || d > days[m - 1]!) throw fail(`Invalid calendar date "${date}"`);
}

function checkTime(time: string, fail: Fail): void {
  const [, h, m, sec] = time.match(TIME)!.map(Number) as [number, number, number, number];
  if (h > 23 || m > 59 || sec > 60) throw fail(`Invalid time of day "${time}"`);
}

function checkOffset(offset: string, fail: Fail): string {
  if (offset === 'Z' || offset === 'z') return 'Z';
  const h = Number(offset.slice(1, 3));
  const m = Number(offset.slice(4, 6));
  if (h > 23 || m > 59) throw fail(`Invalid time zone offset "${offset}"`);
  return offset;
}
