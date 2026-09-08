import { TomlDateTime } from './datetime.js';

/**
 * Serialise a plain object as canonical TOML. Within each table, scalars and
 * arrays come first, then `[sub.tables]`, then `[[arrays.of.tables]]`, so the
 * output always parses back to a deeply-equal object.
 *
 * `undefined` values are skipped like `JSON.stringify` does; `null`, functions
 * and symbols have no TOML representation and throw a `TypeError`.
 */
export function stringify(value: object): string {
  if (!isTableLike(value)) throw new TypeError('stringify expects a plain object at the top level');
  const lines: string[] = [];
  emitTable(value as Record<string, unknown>, [], lines, null);
  return lines.length === 0 ? '' : lines.join('\n') + '\n';
}

type Entry = [string, unknown];

function emitTable(table: Record<string, unknown>, path: string[], lines: string[], header: string | null): void {
  const pairs: Entry[] = [];
  const subTables: Entry[] = [];
  const tableArrays: Entry[] = [];
  for (const entry of Object.entries(table)) {
    const v = entry[1];
    if (v === undefined) continue;
    if (isTableLike(v)) subTables.push(entry);
    else if (Array.isArray(v) && v.length > 0 && v.every(isTableLike)) tableArrays.push(entry);
    else pairs.push(entry);
  }

  // A header is needed when the table holds values of its own, or is empty and
  // would otherwise vanish. `[[array]]` headers are always required.
  const explicit = header?.startsWith('[[') || pairs.length > 0 || (subTables.length === 0 && tableArrays.length === 0);
  if (header !== null && explicit) {
    if (lines.length > 0) lines.push('');
    lines.push(header);
  }
  for (const [key, v] of pairs) {
    lines.push(`${formatKey(key)} = ${formatValue(v, [...path, key], true)}`);
  }
  for (const [key, v] of subTables) {
    const sub = [...path, key];
    emitTable(v as Record<string, unknown>, sub, lines, `[${formatPath(sub)}]`);
  }
  for (const [key, v] of tableArrays) {
    const sub = [...path, key];
    for (const element of v as Record<string, unknown>[]) {
      emitTable(element, sub, lines, `[[${formatPath(sub)}]]`);
    }
  }
}

/** `topLevel` is false inside arrays and inline tables, where multi-line strings would be indented. */
function formatValue(v: unknown, path: string[], topLevel: boolean): string {
  switch (typeof v) {
    case 'string':
      return formatString(v, topLevel);
    case 'number':
      return formatNumber(v);
    case 'bigint':
      return v.toString();
    case 'boolean':
      return String(v);
    case 'object':
      if (v instanceof TomlDateTime) return v.toString();
      if (v instanceof Date) {
        if (Number.isNaN(v.getTime())) throw new TypeError(`Cannot stringify an invalid Date at ${formatPath(path)}`);
        return TomlDateTime.fromDate(v).toString();
      }
      if (Array.isArray(v)) return formatArray(v, path);
      if (v !== null) return formatInlineTable(v as Record<string, unknown>, path);
      break;
  }
  throw new TypeError(`Cannot stringify ${v === null ? 'null' : `a ${typeof v}`} at ${formatPath(path)}`);
}

function formatArray(items: unknown[], path: string[]): string {
  const parts = items.map((item, i) => formatValue(item, [...path, String(i)], false));
  const inline = `[${parts.join(', ')}]`;
  if (inline.length <= 72 && !inline.includes('\n')) return inline;
  // Only nested arrays can contain newlines here, so indenting them is safe.
  const body = parts.map((p) => `  ${p.replaceAll('\n', '\n  ')},`).join('\n');
  return `[\n${body}\n]`;
}

function formatInlineTable(table: Record<string, unknown>, path: string[]): string {
  const parts: string[] = [];
  for (const [key, v] of Object.entries(table)) {
    if (v === undefined) continue;
    parts.push(`${formatKey(key)} = ${formatValue(v, [...path, key], false)}`);
  }
  return parts.length === 0 ? '{}' : `{ ${parts.join(', ')} }`;
}

function formatNumber(n: number): string {
  if (Number.isNaN(n)) return 'nan';
  if (n === Infinity) return 'inf';
  if (n === -Infinity) return '-inf';
  if (Object.is(n, -0)) return '-0.0';
  // Integers print as integers; everything else in JavaScript's shortest
  // round-trip form, which is always a valid TOML float (`1e-7`, `2.5e+300`).
  return String(n);
}

const ESCAPES: Record<string, string> = {
  '\b': '\\b',
  '\t': '\\t',
  '\n': '\\n',
  '\f': '\\f',
  '\r': '\\r',
  '"': '\\"',
  '\\': '\\\\',
};

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000A-\u001F\u007F]/;

function formatString(s: string, allowMultiLine: boolean): string {
  if (allowMultiLine && s.includes('\n') && !/[\u0000-\u0008\u000B-\u001F\u007F]/.test(s)) {
    // Multi-line basic string: newlines and quotes stay literal; only a run of
    // three quotes has to be broken up so it cannot close the string early.
    const body = s.replace(/\\/g, '\\\\').replace(/"""/g, '""\\"');
    return `"""\n${body}"""`;
  }
  // Literal strings keep backslash-heavy content (paths, regexes) readable.
  if (!s.includes("'") && !CONTROL.test(s) && /[\\"]/.test(s)) return `'${s}'`;
  return formatBasic(s);
}

function formatBasic(s: string): string {
  const body = s.replace(/[\u0000-\u001F"\\\u007F]/g, (ch) => {
    return ESCAPES[ch] ?? `\\u${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
  });
  return `"${body}"`;
}

function formatKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : formatBasic(key);
}

function formatPath(path: string[]): string {
  return path.map(formatKey).join('.');
}

function isTableLike(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    !(v instanceof TomlDateTime) &&
    !(v instanceof Date)
  );
}
