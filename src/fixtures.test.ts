import { describe, expect, it } from 'vitest';
import { ParseError, parse } from './index.js';

/** [name, toml, expected object] */
const valid: Array<[string, string, unknown]> = [
  ['empty document', '', {}],
  ['only comments and blanks', '# a\n\n   # b\n', {}],
  ['implicit parent declared later', '[a.b]\nx = 1\n[a]\ny = 2', { a: { b: { x: 1 }, y: 2 } }],
  ['header sub-table of a dotted-key table', '[f]\napple.color = "red"\n[f.apple.texture]\nsmooth = true', {
    f: { apple: { color: 'red', texture: { smooth: true } } },
  }],
  ['dotted keys extend an implicit table', '[a.b.c]\nz = 9\n[a]\nb.d = 1', { a: { b: { c: { z: 9 }, d: 1 } } }],
  ['array of tables then sub-table per element', '[[a]]\n[a.b]\nx = 1\n[[a]]\n[a.b]\nx = 2', {
    a: [{ b: { x: 1 } }, { b: { x: 2 } }],
  }],
  ['array of tables under implicit parent', '[[a.b]]\nx = 1\n[a]\ny = 2', { a: { b: [{ x: 1 }], y: 2 } }],
  ['whitespace around header dots', '[ a . "b" . c ]\nk = 1', { a: { b: { c: { k: 1 } } } }],
  ['quoted empty key', '"" = 1', { '': 1 }],
  ['keys that look like values', 'true = 1\n1979-05-27 = 2\n3.14 = 3', { true: 1, '1979-05-27': 2, 3: { 14: 3 } }],
  ['array of inline tables', 'pts = [ { x = 1 }, { x = 2 } ]', { pts: [{ x: 1 }, { x: 2 }] }],
  ['nested empty arrays', 'a = [[], [[]]]', { a: [[], [[]]] }],
  ['string with unicode and hash', 's = "café # not a comment" # comment', { s: 'café # not a comment' }],
  ['multi-line literal keeps backslashes', "s = '''\nC:\\path\\\n'''", { s: 'C:\\path\\\n' }],
  ['tabs as whitespace', 'a\t=\t1\t# c\n[\tt\t]\nb\t=\t2', { a: 1, t: { b: 2 } }],
  ['no trailing newline', 'a = 1', { a: 1 }],
];

/** [name, toml, expected message pattern] */
const invalid: Array<[string, string, RegExp]> = [
  ['duplicate key', 'a = 1\na = 2', /Duplicate key "a" at 2:1/],
  ['duplicate dotted key', 'a.b = 1\na.b = 2', /Duplicate key "a.b" at 2:3/],
  ['duplicate key in inline table', 'a = { b = 1, b = 2 }', /Duplicate key "b" at 1:14/],
  ['duplicate header', '[a]\n[a]', /Cannot declare table "a" twice at 2:2/],
  ['header after dotted definition', 'a.b = 1\n[a]', /Cannot declare table "a" twice/],
  ['header on dotted-key table from another section', '[f]\napple.color = "red"\n[f.apple]', /Cannot declare table "f.apple" twice/],
  ['header on a value', 'a = 1\n[a]', /Cannot declare table "a": it is a number value/],
  ['header on an inline table', 'a = {}\n[a]', /Cannot declare table "a": it is an inline table/],
  ['sub-header through inline table', 'a = { b = {} }\n[a.b.c]', /Cannot extend "a": it is an inline table/],
  ['table header on array of tables', '[[a]]\n[a]', /Cannot declare table "a": it is an array of tables/],
  ['array header on table', '[a]\n[[a]]', /Cannot append to "a": it is a table/],
  ['array header on static array', 'a = []\n[[a]]', /Cannot append to "a": it is a static array/],
  ['dotted keys into header-defined table', '[a.b.c]\nz = 9\n[a]\nb.c.t = 1', /Cannot extend "a.b.c" with dotted keys: it is a table at 4:3/],
  ['dotted keys into inline table', 'a = { b = 1 }\na.c = 2', /Cannot extend "a" with dotted keys: it is an inline table/],
  ['dotted keys into a value', 'a = 1\na.b = 2', /Cannot extend "a" with dotted keys: it is a number value/],
  ['inline table extended via dotted key inside', 'a = { b = {}, b.c = 1 }', /Cannot extend "b" with dotted keys/],
  ['bare key with space', 'a b = 1', /Unexpected "b", expected "="/],
  ['missing value', 'a =', /Unexpected end of input, expected a value/],
  ['two values on one line', 'a = 1 2', /Unexpected "2", expected end of line at 1:7/],
  ['unclosed header', '[a\nb = 1', /expected "\]"/],
  ['empty header', '[]', /Unexpected "\]", expected a key/],
  ['newline in inline table', 'a = {\nb = 1}', /Unexpected end of line, expected a key/],
  ['trailing comma in inline table', 'a = { b = 1, }', /Unexpected "\}", expected a key/],
  ['invalid escape', 'a = "\\q"', /Invalid escape sequence "\\q" at 1:6/],
  ['surrogate escape', 'a = "\\uD800"', /not a Unicode scalar value/],
  ['short unicode escape', 'a = "\\u12"', /Expected 4 hex digits/],
  ['newline in basic string', 'a = "x\ny"', /Unterminated string at 1:5/],
  ['control character in string', 'a = "x\u0007y"', /Control character U\+0007 in string at 1:7/],
  ['control character in comment', '# bell\u0007', /Control character U\+0007 in comment/],
  ['multi-line string as key', '"""k""" = 1', /Multi-line strings cannot be keys/],
  ['leading zero', 'a = 007', /Leading zeros are not allowed/],
  ['trailing underscore', 'a = 1_', /Underscores must sit between digits/],
  ['underscore after hex prefix', 'a = 0x_1', /Invalid 0x integer/],
  ['signed hex', 'a = -0x1', /Prefixed integers cannot have a sign/],
  ['float without leading digit', 'a = .5', /Unexpected "\.", expected a value/],
  ['float without trailing digit', 'a = 5.', /digits on both sides/],
  ['float exponent without digits', 'a = 1e', /Invalid value "1e"/],
  ['bad boolean', 'a = True', /Unexpected "T", expected a value/],
  ['impossible date', 'a = 2023-02-30', /Invalid calendar date "2023-02-30"/],
  ['impossible time', 'a = 24:00:00', /Invalid time of day "24:00:00"/],
  ['bad offset', 'a = 1979-05-27T00:00:00+25:00', /Invalid time zone offset "\+25:00"/],
  ['date without seconds', 'a = 1979-05-27T07:32Z', /Invalid value/],
  ['lone carriage return', 'a = 1\rb = 2', /expected end of line at 1:6/],
];

describe('valid fixtures', () => {
  it.each(valid)('%s', (_name, toml, expected) => {
    expect(parse(toml)).toEqual(expected);
  });
});

describe('invalid fixtures', () => {
  it.each(invalid)('%s', (_name, toml, pattern) => {
    expect(() => parse(toml)).toThrow(ParseError);
    expect(() => parse(toml)).toThrow(pattern);
  });
});
