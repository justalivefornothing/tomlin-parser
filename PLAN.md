# Tomlin — plan

A dependency-free TOML 1.0 parser and serializer for Node/TypeScript.

## Goal

Feed it a realistic Cargo-style config (nested `[[bin]]` tables, multi-line
strings, dotted keys) and get back a perfectly shaped object. Feed it a
malformed document and get back one `ParseError` with a line, a column and a
snippet, e.g. `Duplicate key "name" at 12:1`. Then take any plain object and
turn it back into canonical TOML that round-trips through `parse`.

## Features

- Keys: bare, quoted (basic + literal), dotted, with whitespace around dots
- Strings: basic, literal, multi-line basic, multi-line literal; all escapes
  incl. `\uXXXX` / `\UXXXXXXXX`; first-newline trimming and line-ending `\`
- Numbers: decimal integers with `_`, `0x` / `0o` / `0b` prefixes, floats with
  fraction and/or exponent, `inf` / `nan` with signs; booleans
- Tables `[a.b]`, arrays of tables `[[a]]`, inline tables `{ k = v }`
- TOML redefinition rules: duplicate keys, re-declared tables, extending
  inline tables / static arrays, dotted keys into header-defined tables
- Date/time: offset datetime, local datetime, local date, local time, each a
  tagged object (`{ kind: 'local-date', date: '1979-05-27' }`)
- `ParseError` is the only thing `parse` ever throws
- `stringify(value)` producing canonical TOML: scalars and inline arrays first,
  then `[sub.tables]`, then `[[arrays.of.tables]]`
- Typed API: `parse<T>(src)`, `stringify(value)`, `TomlValue` union
- Vitest suite with a fixture table of valid and invalid documents

## Architecture

```
src/
  index.ts       public API re-exports
  types.ts       TomlValue, TomlTable, TomlDateTime
  errors.ts      ParseError (line, column, snippet)
  scanner.ts     cursor over the source: offset / line / col, peek, next
  strings.ts     the four string forms + escape handling
  numbers.ts     integers, floats, inf/nan, date-time classification
  parser.ts      line-oriented document parser + value dispatch + namespace rules
  stringify.ts   object -> canonical TOML
  *.test.ts      vitest
```

The parser is line-oriented at the top: each line is a table header, an array
of tables header, a key/value pair, a comment or blank. Values dispatch on the
first character (`"` `'` `[` `{` `t` `f` sign/digit). Redefinition rules are
enforced with sets of table identities: header-declared, dotted-key-created
(pending for the current section, then sealed) and frozen (inline tables and
arrays).

## Milestones

1. Plan, license, scaffold
2. Scanner, errors, strings, numbers with tests
3. Document parser: headers, dotted keys, arrays, inline tables, namespace rules
4. Date/time values
5. Serializer with round-trip tests
6. Fixture-driven suite, README, publish
