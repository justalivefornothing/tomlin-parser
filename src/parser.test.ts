import { describe, expect, it } from 'vitest';
import { ParseError, TomlDateTime, parse } from './index.js';

describe('spec assertions', () => {
  it('dotted keys and table headers', () => {
    expect(parse('a.b = 1\n[c]\nd = "x"')).toEqual({ a: { b: 1 }, c: { d: 'x' } });
  });

  it('arrays of tables', () => {
    expect(parse('[[p]]\nn=1\n[[p]]\nn=2')).toEqual({ p: [{ n: 1 }, { n: 2 }] });
  });

  it('multi-line string with line-ending backslash', () => {
    expect(parse('s = """\nhello \\\n   world"""').s).toBe('hello world');
  });

  it('duplicate key is a positioned error', () => {
    expect(() => parse('a = 1\na = 2')).toThrow(/Duplicate key "a" at 2:1/);
  });

  it('hex integers and floats with underscores', () => {
    type Doc = { n: number; f: number };
    expect(parse<Doc>('n = 0xFF\nf = 1_000.5').n + parse<Doc>('n = 0xFF\nf = 1_000.5').f).toBe(1255.5);
  });
});

describe('keys', () => {
  it('accepts bare, quoted and dotted keys with whitespace', () => {
    const doc = parse('bare-key_1 = 1\n"quoted key" = 2\n\'lit.eral\' = 3\n a . "b c" . d = 4\n1234 = 5');
    expect(doc).toEqual({ 'bare-key_1': 1, 'quoted key': 2, 'lit.eral': 3, a: { 'b c': { d: 4 } }, 1234: 5 });
  });

  it('lets dotted keys extend a table created by dotted keys in the same section', () => {
    expect(parse('a.b = 1\na.c = 2\n[t]\nx.y = 1\nx.z = 2')).toEqual({ a: { b: 1, c: 2 }, t: { x: { y: 1, z: 2 } } });
  });

  it('does not touch the prototype for hostile keys', () => {
    const doc = parse('__proto__.polluted = 1\nconstructor = 2');
    expect(Object.hasOwn(doc, '__proto__')).toBe(true);
    expect(({} as { polluted?: number }).polluted).toBeUndefined();
    expect(doc.constructor).toBe(2);
    expect(() => parse('constructor = 1\nconstructor = 2')).toThrow(/Duplicate key "constructor"/);
  });
});

describe('strings', () => {
  it('handles every escape in basic strings', () => {
    const doc = parse('s = "tab\\t nl\\n cr\\r ff\\f bs\\b q\\" sl\\\\ u\\u00E9 U\\U0001F600"');
    expect(doc.s).toBe('tab\t nl\n cr\r ff\f bs\b q" sl\\ ué U😀');
  });

  it('keeps literal strings verbatim', () => {
    expect(parse("p = 'C:\\Users\\nodejs'").p).toBe('C:\\Users\\nodejs');
  });

  it('trims the first newline of multi-line strings and allows quotes near the delimiter', () => {
    expect(parse('a = """\r\nline one\nline two"""').a).toBe('line one\nline two');
    expect(parse('b = """He said ""hi"" and left."""').b).toBe('He said ""hi"" and left.');
    expect(parse('c = """"quoted""""').c).toBe('"quoted"');
    expect(parse("d = '''\nraw \\n text\n'''").d).toBe('raw \\n text\n');
    expect(parse("e = ''''that's it'''''").e).toBe("'that's it''");
  });

  it('elides whitespace after a line-ending backslash but keeps ordinary escapes', () => {
    const src = 's = """\n  The quick \\\n\n\n    brown fox\\tjumps."""';
    expect(parse(src).s).toBe('  The quick brown fox\tjumps.');
  });
});

describe('numbers and booleans', () => {
  it('parses every integer form', () => {
    const doc = parse('a = +99\nb = -17\nc = 1_000_000\nd = 0xDEAD_beef\ne = 0o755\nf = 0b1101_0110\ng = 0\nh = -0');
    expect(doc).toEqual({ a: 99, b: -17, c: 1_000_000, d: 0xdeadbeef, e: 0o755, f: 0b11010110, g: 0, h: -0 });
  });

  it('parses floats, exponents and specials', () => {
    const doc = parse('a = 3.14\nb = -2.5e-3\nc = 6.626e+34\nd = 1e06\ne = inf\nf = -inf\ng = +nan\nh = 224_617.445_991_228');
    expect(doc).toEqual({ a: 3.14, b: -0.0025, c: 6.626e34, d: 1e6, e: Infinity, f: -Infinity, g: NaN, h: 224617.445991228 });
  });

  it('parses booleans', () => {
    expect(parse('t = true\nf = false')).toEqual({ t: true, f: false });
  });
});

describe('tables, arrays and inline tables', () => {
  it('handles nested headers, implicit tables and later declaration of an implicit parent', () => {
    const doc = parse('[a.b.c]\nx = 1\n[a]\ny = 2\n[a.d]\nz = 3');
    expect(doc).toEqual({ a: { b: { c: { x: 1 } }, y: 2, d: { z: 3 } } });
  });

  it('parses multi-line arrays with comments, trailing commas and mixed types', () => {
    const doc = parse('arr = [\n  1, # one\n  "two",\n  [3.0, 4],\n  { five = 5 },\n]\nempty = []');
    expect(doc).toEqual({ arr: [1, 'two', [3, 4], { five: 5 }], empty: [] });
  });

  it('parses inline tables with dotted keys and nesting', () => {
    const doc = parse('point = { x = 1, y.z = 2, y.w = 3, inner = { deep = true } }\nnone = {}');
    expect(doc).toEqual({ point: { x: 1, y: { z: 2, w: 3 }, inner: { deep: true } }, none: {} });
  });

  it('nests arrays of tables and sub-tables of array elements', () => {
    const src = `
[[fruits]]
name = "apple"

[fruits.physical]
color = "red"

[[fruits.varieties]]
name = "red delicious"

[[fruits.varieties]]
name = "granny smith"

[[fruits]]
name = "banana"

[[fruits.varieties]]
name = "plantain"
`;
    expect(parse(src)).toEqual({
      fruits: [
        { name: 'apple', physical: { color: 'red' }, varieties: [{ name: 'red delicious' }, { name: 'granny smith' }] },
        { name: 'banana', varieties: [{ name: 'plantain' }] },
      ],
    });
  });

  it('tolerates comments, blank lines, CRLF and a byte order mark', () => {
    const doc = parse('\uFEFF# top\r\n\r\nkey = "v" # trailing\r\n[t] # header comment\r\n  n = 1\r\n');
    expect(doc).toEqual({ key: 'v', t: { n: 1 } });
  });
});

describe('date-times', () => {
  it('produces tagged objects for the four flavours', () => {
    const doc = parse<Record<string, TomlDateTime>>(
      'odt = 1979-05-27T07:32:00Z\nodt2 = 1979-05-27 00:32:00.999-07:00\nldt = 1979-05-27T07:32:00\nld = 1979-05-27\nlt = 07:32:00.5',
    );
    expect(doc.odt).toEqual(TomlDateTime.offsetDateTime('1979-05-27', '07:32:00', 'Z'));
    expect(doc.odt2).toEqual(TomlDateTime.offsetDateTime('1979-05-27', '00:32:00.999', '-07:00'));
    expect(doc.ldt).toEqual(TomlDateTime.localDateTime('1979-05-27', '07:32:00'));
    expect(doc.ld).toEqual(TomlDateTime.localDate('1979-05-27'));
    expect(doc.lt).toEqual(TomlDateTime.localTime('07:32:00.5'));
    expect(doc.odt2!.kind).toBe('offset-datetime');
    expect(String(doc.odt2)).toBe('1979-05-27T00:32:00.999-07:00');
    expect(doc.odt!.toDate().toISOString()).toBe('1979-05-27T07:32:00.000Z');
    expect(() => doc.lt!.toDate()).toThrow(TypeError);
  });

  it('does not mistake a table with a kind key for a date', () => {
    const doc = parse('[x]\nkind = "local-date"\ndate = "1979-05-27"');
    expect(doc.x).not.toBeInstanceOf(TomlDateTime);
  });
});

describe('ParseError', () => {
  it('carries line, column, reason and a snippet with a caret', () => {
    let caught: unknown;
    try {
      parse('[server]\nport = 8080\nport = 9090\n');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ParseError);
    const err = caught as ParseError;
    expect(err.reason).toBe('Duplicate key "port"');
    expect(err.line).toBe(3);
    expect(err.column).toBe(1);
    expect(err.snippet).toBe('3 | port = 9090\n  | ^');
    expect(err.message).toBe('Duplicate key "port" at 3:1\n3 | port = 9090\n  | ^');
  });

  it('points at the exact column and counts code points', () => {
    expect(() => parse('name = "héllo" trailing')).toThrow(/expected end of line at 1:16/);
    expect(() => parse('k = "😀"x')).toThrow(/at 1:8/);
    expect(() => parse('a.b = 1\na.b.c = 2')).toThrow(/Cannot extend "a.b" with dotted keys: it is a number value at 2:3/);
  });

  it('is the only thing ever thrown', () => {
    const deep = '['.repeat(200_000) + ']'.repeat(200_000);
    expect(() => parse(`a = ${deep}`)).toThrow(ParseError);
  });

  it('is thrown even for non-string input from untyped callers', () => {
    const loose = parse as unknown as (source: unknown) => unknown;
    expect(() => loose(123)).toThrow(ParseError);
    expect(() => loose(null)).toThrow(/Expected a TOML source string, got null at 1:1/);
    expect(() => loose(['a = 1'])).toThrow(/got an array/);
    expect(() => loose(undefined)).toThrow(/got undefined/);
  });
});
