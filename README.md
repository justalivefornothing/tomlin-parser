# Tomlin

A dependency-free TOML parser and serializer covering tables, arrays of tables,
inline tables, dotted keys, all string forms, and dates, with positioned errors.

```js
import { parse, stringify } from 'tomlin-parser';

const config = parse(`
title = "Tomlin"

[server]
host = "127.0.0.1"
ports = [ 8000, 8001 ]
started = 1979-05-27T07:32:00Z

[[bin]]
name = "tomlin"
path = "src/main.rs"
`);

config.server.ports;            // [8000, 8001]
config.bin[0].name;             // "tomlin"
String(config.server.started);  // "1979-05-27T07:32:00Z"

stringify({ package: { name: 'demo' }, bin: [{ name: 'a' }, { name: 'b' }] });
// [package]
// name = "demo"
//
// [[bin]]
// name = "a"
//
// [[bin]]
// name = "b"
```

And when something is wrong, exactly one kind of error comes back, and it
knows where it happened:

```
ParseError: Duplicate key "name" at 4:1
4 | name = "b"
  | ^
```

## Install

```sh
npm install tomlin-parser
```

ESM only, TypeScript types included, zero runtime dependencies. Works on
Node 18+ and anywhere else with ES2022 (no Node APIs are used).

## Features

- Full key grammar: bare, quoted (`"a b"`, `'c.d'`) and dotted keys, with
  whitespace around the dots, in both `key = value` lines and `[headers]`
- All four string forms: basic and literal, single- and multi-line, with every
  escape (`\n`, `\uXXXX`, `\UXXXXXXXX`, ...), first-newline trimming and the
  line-ending backslash
- Integers with underscores and `0x` / `0o` / `0b` prefixes, floats with
  fraction and exponent, `inf` / `nan` with signs, booleans
- Tables `[a.b]`, arrays of tables `[[a]]`, inline tables `{ k = v }`, and the
  complete set of TOML redefinition rules (duplicate keys, re-declared tables,
  extending inline tables or static arrays, dotted keys into header tables)
- Offset date-time, local date-time, local date and local time as tagged
  `TomlDateTime` objects that print as canonical TOML and convert to `Date`
- `ParseError` with `line`, `column`, `reason` and a caret `snippet`; `parse`
  never throws anything else
- `stringify` emits canonical TOML that parses back to a deeply-equal object:
  pairs first, then `[sub.tables]`, then `[[arrays.of.tables]]`
- Typed API: `parse<T>(src): T` and a `TomlValue` union
- Hostile keys such as `__proto__` and `constructor` are ordinary keys and never
  touch the prototype

## Usage

### Typed parsing

`parse` is generic. It does not validate against the type; it just lets you
declare the shape you expect. Without a type argument you get `TomlTable`,
whose values are the `TomlValue` union.

```ts
import { readFileSync } from 'node:fs';
import { parse } from 'tomlin-parser';

interface Manifest {
  package: { name: string; version: string };
  bin: Array<{ name: string; path: string }>;
}

const manifest = parse<Manifest>(readFileSync('Cargo.toml', 'utf8'));
manifest.bin.map((b) => b.name);
```

### Handling errors

```ts
import { parse, ParseError } from 'tomlin-parser';

try {
  parse(source);
} catch (error) {
  if (error instanceof ParseError) {
    error.reason;   // 'Duplicate key "name"'
    error.line;     // 4
    error.column;   // 1
    error.snippet;  // '4 | name = "b"\n  | ^'
    error.message;  // reason + position + snippet
  }
}
```

### Dates

TOML has four date/time flavours and `Date` can only faithfully hold one of
them, so they come back as tagged objects.

```ts
import { parse, stringify, TomlDateTime } from 'tomlin-parser';

const { released, nightly } = parse<Record<string, TomlDateTime>>(`
released = 2024-03-01T09:30:00+01:00
nightly = 03:00:00
`);

released.kind;                  // 'offset-datetime'
released.date;                  // '2024-03-01'
released.offset;                // '+01:00'
released.toDate().toISOString() // '2024-03-01T08:30:00.000Z'
String(nightly);                // '03:00:00'

stringify({ when: new Date(0) }); // when = 1970-01-01T00:00:00.000Z
stringify({ day: TomlDateTime.localDate('2024-03-01') }); // day = 2024-03-01
```

### Serialising

```ts
stringify({
  title: 'demo',
  owner: { name: 'Jafn', tags: ['a', 'b'] },
  bin: [{ name: 'one' }, { name: 'two', extra: { deep: true } }],
});
```

```toml
title = "demo"

[owner]
name = "Jafn"
tags = ["a", "b"]

[[bin]]
name = "one"

[[bin]]
name = "two"

[bin.extra]
deep = true
```

Strings pick the most readable form (`'C:\Users'` for backslash-heavy content,
`"""` blocks for multi-line text), long arrays wrap one element per line,
`undefined` values are skipped, and `null` or functions throw a `TypeError`
naming the offending key path.

## API

| Export | Signature | Notes |
| --- | --- | --- |
| `parse` | `parse<T = TomlTable>(source: string): T` | Throws `ParseError` only. Strips a leading BOM; accepts LF or CRLF. |
| `stringify` | `stringify(value: object): string` | Canonical TOML ending in a newline (`''` for `{}`). |
| `ParseError` | `class extends Error` | `reason`, `line`, `column`, `snippet`; `message` combines them. |
| `TomlDateTime` | `class` | `kind`, `date`, `time`, `offset`; `toDate()`, `toString()`, `toJSON()`; static `offsetDateTime`, `localDateTime`, `localDate`, `localTime`, `fromDate`. |
| `isTable` | `(value: unknown) => value is TomlTable` | Plain table, i.e. not an array or date-time. |
| `TomlValue` | `string \| number \| boolean \| TomlDateTime \| TomlValue[] \| TomlTable` | Also `TomlTable`, `TomlArray`, `DateTimeKind`, `Position` types. |

Integers are returned as JavaScript numbers; values beyond 2^53 lose precision.

## How it works

Everything sits on a small `Scanner`: a cursor over the source that tracks
offset, line and column (in code points, so an emoji is one column). The
document parser is line-oriented. It peeks at the first significant character
of a line and decides between a `[table]` header, an `[[array]]` header, a
`key = value` pair, or a comment, then insists on a line break afterwards. A
value parser dispatches on the first character of the value: `"` or `'` go to
the string module, `[` to an array, `{` to an inline table, `t`/`f` to
booleans, and any digit, sign, `i` or `n` to a shared number/date-time routine
that reads one greedy token and classifies it with a handful of anchored
regular expressions before checking calendar and clock ranges.

```
[a.b]        a implied, b declared                     sealed = { a.b }
x.y = 1      x created under a.b by a dotted key       pending = { a.b.x }
[[srv]]      pending drains; new element is current    sealed += a.b.x   tableArrays = { srv }
x = 1        lives in the srv element: no conflict
[a.b.x]      a.b.x is sealed                           ParseError: Cannot declare table "a.b.x" twice at 5:6
```

TOML's redefinition rules are the hard part, and they are enforced without
re-walking paths by remembering table identities in three sets. `sealed`
holds tables declared by a header and tables built by dotted keys in earlier
sections; a header may not declare them again, and dotted keys may not reach
into them. `pending` holds tables created by dotted keys in the current
section, so `a.b = 1` followed by `a.c = 2` is fine; when the next header
appears, `pending` drains into `sealed`. `frozen` holds inline tables and
static arrays: nothing beneath them can ever be extended, which a single
membership test on the way down catches. Arrays created by `[[header]]` are
tracked separately so a header can step into their last element while a
static array in the same spot is rejected. Multi-line strings handle the two
special cases the spec calls out: a newline directly after the opening
delimiter is dropped, and a backslash at the end of a line swallows all
whitespace and newlines up to the next visible character.

The serializer is the mirror image. For each table it partitions entries into
scalars and inline arrays, sub-tables, and arrays of tables (arrays whose
elements are all objects), then emits them in that order so that every
key/value line belongs unambiguously to the header above it. Headers are only
written for tables that hold values of their own (or are empty), which is why
`{ a: { b: { c: 1 } } }` becomes just `[a.b]`. Because the output follows the
same grammar the parser enforces, `parse(stringify(x))` is deep-equal to `x`
for any object made of TOML-representable values.

## Development

```sh
npm install
npm test          # vitest: 98 tests across parser, fixtures, Cargo manifest, serializer
npm run typecheck # tsc over sources and tests
npm run build     # emits dist/ with .d.ts
```

Tests are driven from small tables of valid and invalid documents
(`src/fixtures.test.ts`), plus a realistic Cargo manifest in
`examples/Cargo.toml` that must parse to an exact shape and round-trip
through `stringify`.

## Tech

TypeScript 7 (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`),
Vitest 5, ESM output with declaration maps. No runtime dependencies.

## License

MIT. Copyright 2026 Jafn.
