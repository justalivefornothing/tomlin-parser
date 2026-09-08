import { describe, expect, it } from 'vitest';
import { TomlDateTime, parse, stringify } from './index.js';

describe('stringify', () => {
  it('round-trips the spec example', () => {
    expect(parse(stringify({ x: { y: [1, 2], z: 'q' } }))).toEqual({ x: { y: [1, 2], z: 'q' } });
  });

  it('emits pairs first, then sub-tables, then arrays of tables', () => {
    const doc = {
      title: 'demo',
      owner: { name: 'Jafn', tags: ['a', 'b'] },
      bin: [{ name: 'one' }, { name: 'two', extra: { deep: true } }],
      count: 3,
    };
    expect(stringify(doc)).toBe(
      [
        'title = "demo"',
        'count = 3',
        '',
        '[owner]',
        'name = "Jafn"',
        'tags = ["a", "b"]',
        '',
        '[[bin]]',
        'name = "one"',
        '',
        '[[bin]]',
        'name = "two"',
        '',
        '[bin.extra]',
        'deep = true',
        '',
      ].join('\n'),
    );
    expect(parse(stringify(doc))).toEqual(doc);
  });

  it('skips headers for tables that only contain tables, but keeps empty ones', () => {
    expect(stringify({ a: { b: { c: 1 } }, e: {} })).toBe('[a.b]\nc = 1\n\n[e]\n');
    expect(parse(stringify({ a: { b: { c: 1 } }, e: {} }))).toEqual({ a: { b: { c: 1 } }, e: {} });
    expect(stringify({})).toBe('');
  });

  it('quotes keys that are not bare', () => {
    const doc = { 'needs quotes': 1, 'ünï': { 'a.b': 2 }, '': 3 };
    expect(stringify(doc)).toBe('"needs quotes" = 1\n"" = 3\n\n["ünï"]\n"a.b" = 2\n');
    expect(parse(stringify(doc))).toEqual(doc);
  });

  it('formats every number form', () => {
    const doc = { i: 42, neg: -7, f: 3.5, tiny: 1e-7, huge: 2.5e300, inf: Infinity, ninf: -Infinity, nan: NaN, nz: -0 };
    expect(stringify(doc)).toBe(
      'i = 42\nneg = -7\nf = 3.5\ntiny = 1e-7\nhuge = 2.5e+300\ninf = inf\nninf = -inf\nnan = nan\nnz = -0.0\n',
    );
    expect(parse(stringify(doc))).toEqual(doc);
  });

  it('picks the most readable string form and round-trips awkward content', () => {
    expect(stringify({ s: 'plain' })).toBe('s = "plain"\n');
    expect(stringify({ p: 'C:\\Users\\x' })).toBe("p = 'C:\\Users\\x'\n");
    expect(stringify({ q: 'say "hi"' })).toBe(`q = 'say "hi"'\n`);
    expect(stringify({ m: 'line one\nline two' })).toBe('m = """\nline one\nline two"""\n');
    expect(stringify({ c: 'bell\u0007 \u007f' })).toBe('c = "bell\\u0007 \\u007F"\n');
    const awkward = {
      a: 'tab\t "quoted" and \'single\' \\ back',
      b: 'ends with quotes ""',
      c: 'triple """ inside\nand a trailing newline\n',
      d: 'crlf\r\nline',
      e: '\n',
      f: '',
    };
    expect(parse(stringify(awkward))).toEqual(awkward);
  });

  it('writes date-times and JavaScript Dates', () => {
    const doc = {
      odt: TomlDateTime.offsetDateTime('1979-05-27', '07:32:00', 'Z'),
      ld: TomlDateTime.localDate('1979-05-27'),
      lt: TomlDateTime.localTime('07:32:00'),
      js: new Date('2024-02-29T12:00:00.000Z'),
    };
    expect(stringify(doc)).toBe(
      'odt = 1979-05-27T07:32:00Z\nld = 1979-05-27\nlt = 07:32:00\njs = 2024-02-29T12:00:00.000Z\n',
    );
    const back = parse(stringify(doc));
    expect(back.odt).toEqual(doc.odt);
    expect(back.js).toEqual(TomlDateTime.offsetDateTime('2024-02-29', '12:00:00.000', 'Z'));
  });

  it('uses inline tables inside arrays and wraps long arrays', () => {
    const doc = { mixed: [1, { a: 1, b: {} }, [true]], longs: Array.from({ length: 12 }, (_, i) => `item-${i}`) };
    const text = stringify(doc);
    expect(text).toContain('mixed = [1, { a = 1, b = {} }, [true]]');
    expect(text).toContain('longs = [\n  "item-0",\n  "item-1",');
    expect(parse(text)).toEqual(doc);
  });

  it('skips undefined and rejects values TOML cannot express', () => {
    expect(stringify({ a: undefined, b: 1 })).toBe('b = 1\n');
    expect(() => stringify({ a: null })).toThrow(/Cannot stringify null at a/);
    expect(() => stringify({ t: { fn: () => 1 } })).toThrow(/Cannot stringify a function at t.fn/);
    expect(() => stringify({ d: new Date(NaN) })).toThrow(/invalid Date at d/);
    expect(() => stringify([] as unknown as object)).toThrow(TypeError);
  });
});
