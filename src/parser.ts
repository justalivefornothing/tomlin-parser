import { TomlDateTime } from './datetime.js';
import { ParseError, type Position } from './errors.js';
import { parseNumberOrDateTime } from './numbers.js';
import { Scanner, isBareKeyChar } from './scanner.js';
import { parseString } from './strings.js';
import { isTable, type TomlArray, type TomlTable, type TomlValue } from './types.js';

/**
 * Parse a TOML 1.0 document into a plain object.
 * Throws `ParseError` (and nothing else) on invalid input.
 */
export function parse<T = TomlTable>(source: string): T {
  if (typeof source !== 'string') {
    // Untyped callers can pass anything; keep the "ParseError only" promise even then.
    const got =
      source === null || source === undefined ? String(source) : Array.isArray(source) ? 'an array' : `a ${typeof source}`;
    throw new ParseError(`Expected a TOML source string, got ${got}`, { offset: 0, line: 1, column: 1 }, '');
  }
  const parser = new Parser(source);
  try {
    return parser.document() as unknown as T;
  } catch (error) {
    if (error instanceof ParseError) throw error;
    // Anything else (say, a stack overflow on absurd nesting) still surfaces as a ParseError.
    const detail = error instanceof Error ? error.message : String(error);
    throw parser.scanner.error(`Internal error: ${detail}`);
  }
}

interface Key {
  parts: string[];
  positions: Position[];
}

/**
 * The document parser is line-oriented: each line is a `[table]` header, an
 * `[[array]]` header, a `key = value` pair, a comment or blank. Redefinition
 * rules are enforced by tracking table identities in a few sets rather than
 * by re-walking paths.
 */
class Parser {
  readonly scanner: Scanner;
  private readonly root: TomlTable = {};
  private current: TomlTable = this.root;
  private currentPath: string[] = [];
  /** Tables declared by a `[header]`, plus dotted-key tables from finished sections. */
  private readonly sealed = new Set<TomlTable>();
  /** Tables created by dotted keys in the current section; sealed when the section ends. */
  private readonly pending = new Set<TomlTable>();
  /** Inline tables and static arrays: nothing under them may ever be extended. */
  private readonly frozen = new Set<object>();
  /** Arrays created by `[[header]]`; they only grow through further headers. */
  private readonly tableArrays = new Set<TomlArray>();

  constructor(source: string) {
    // A byte-order mark is not part of the document.
    this.scanner = new Scanner(source.charCodeAt(0) === 0xfeff ? source.slice(1) : source);
  }

  document(): TomlTable {
    const s = this.scanner;
    while (true) {
      s.skipWhitespace();
      if (s.done) break;
      const ch = s.peek();
      if (ch === '[') this.header();
      else if (ch !== '#' && ch !== '\n' && ch !== '\r') this.keyValue(this.current, this.pending, this.currentPath);
      s.endOfLine();
    }
    return this.root;
  }

  // ---------------------------------------------------------------- headers

  private header(): void {
    const s = this.scanner;
    const isArray = s.peek(1) === '[';
    // Dotted-key tables from the section that just ended can no longer be extended.
    for (const table of this.pending) this.sealed.add(table);
    this.pending.clear();

    s.skip(isArray ? 2 : 1);
    s.skipWhitespace();
    const key = this.key();
    s.skipWhitespace();
    s.expect(isArray ? ']]' : ']');

    let table = this.root;
    for (let i = 0; i < key.parts.length - 1; i++) {
      table = this.descend(table, key.parts[i]!, key.parts.slice(0, i + 1), key.positions[i]!);
    }
    const name = key.parts.at(-1)!;
    const at = key.positions.at(-1)!;
    const path = formatPath(key.parts);
    const existing = get(table, name);

    if (isArray) {
      let array: TomlArray;
      if (existing === undefined) {
        array = [];
        set(table, name, array);
        this.tableArrays.add(array);
      } else if (Array.isArray(existing) && this.tableArrays.has(existing)) {
        array = existing;
      } else {
        throw s.error(`Cannot append to ${path}: it is ${this.what(existing)}`, at);
      }
      const element: TomlTable = {};
      array.push(element);
      this.current = element;
    } else if (existing === undefined) {
      this.current = {};
      set(table, name, this.current);
      this.sealed.add(this.current);
    } else if (isTable(existing) && !this.sealed.has(existing) && !this.frozen.has(existing)) {
      // Created implicitly by a deeper header such as `[a.b]`; may be declared once.
      this.current = existing;
      this.sealed.add(existing);
    } else if (isTable(existing) && this.sealed.has(existing)) {
      throw s.error(`Cannot declare table ${path} twice`, at);
    } else {
      throw s.error(`Cannot declare table ${path}: it is ${this.what(existing)}`, at);
    }
    this.currentPath = key.parts;
  }

  /** Step into `name` while resolving a header path, creating implicit tables as needed. */
  private descend(table: TomlTable, name: string, path: string[], at: Position): TomlTable {
    const existing = get(table, name);
    if (existing === undefined) {
      const created: TomlTable = {};
      set(table, name, created);
      return created;
    }
    if (typeof existing === 'object' && !this.frozen.has(existing)) {
      if (Array.isArray(existing)) return existing.at(-1) as TomlTable; // an array of tables
      if (isTable(existing)) return existing;
    }
    throw this.scanner.error(`Cannot extend ${formatPath(path)}: it is ${this.what(existing)}`, at);
  }

  // -------------------------------------------------------------- key/value

  /**
   * Parse `key = value` into `target`. Tables that dotted keys create or pass
   * through are recorded in `open` (the section's pending set, or a throwaway
   * for inline tables); `base` is only used for messages.
   */
  private keyValue(target: TomlTable, open: Set<TomlTable>, base: string[]): void {
    const s = this.scanner;
    const key = this.key();
    s.skipWhitespace();
    s.expect('=');
    s.skipWhitespace();
    const value = this.value();

    let table = target;
    for (let i = 0; i < key.parts.length - 1; i++) {
      const part = key.parts[i]!;
      const existing = get(table, part);
      if (existing === undefined) {
        const created: TomlTable = {};
        set(table, part, created);
        open.add(created);
        table = created;
      } else if (isTable(existing) && !this.sealed.has(existing) && !this.frozen.has(existing)) {
        // Either created by dotted keys in this section or implied by a deeper header.
        open.add(existing);
        table = existing;
      } else {
        const path = formatPath([...base, ...key.parts.slice(0, i + 1)]);
        throw s.error(`Cannot extend ${path} with dotted keys: it is ${this.what(existing)}`, key.positions[i]!);
      }
    }
    const name = key.parts.at(-1)!;
    if (Object.hasOwn(table, name)) {
      throw s.error(`Duplicate key ${formatPath(key.parts)}`, key.positions.at(-1)!);
    }
    set(table, name, value);
    if (typeof value === 'object' && !(value instanceof TomlDateTime)) this.frozen.add(value);
  }

  private key(): Key {
    const s = this.scanner;
    const parts: string[] = [];
    const positions: Position[] = [];
    while (true) {
      positions.push(s.position());
      parts.push(this.simpleKey());
      s.skipWhitespace();
      if (s.peek() !== '.') return { parts, positions };
      s.skip(1);
      s.skipWhitespace();
    }
  }

  private simpleKey(): string {
    const s = this.scanner;
    const ch = s.peek();
    if (ch === '"' || ch === "'") {
      if (s.startsWith('"""') || s.startsWith("'''")) throw s.error('Multi-line strings cannot be keys');
      return parseString(s);
    }
    let text = '';
    while (isBareKeyChar(s.peek())) text += s.next();
    if (text === '') throw s.unexpected('a key');
    return text;
  }

  // ----------------------------------------------------------------- values

  private value(): TomlValue {
    const s = this.scanner;
    const ch = s.peek();
    if (ch === '"' || ch === "'") return parseString(s);
    if (ch === '[') return this.array();
    if (ch === '{') return this.inlineTable();
    if (s.startsWith('true')) {
      s.skip(4);
      return true;
    }
    if (s.startsWith('false')) {
      s.skip(5);
      return false;
    }
    if (/^[0-9+\-in]$/.test(ch)) return parseNumberOrDateTime(s);
    throw s.unexpected('a value');
  }

  private array(): TomlArray {
    const s = this.scanner;
    s.skip(1);
    const items: TomlArray = [];
    while (true) {
      this.skipArrayFiller();
      if (s.peek() === ']') break;
      items.push(this.value());
      this.skipArrayFiller();
      if (s.peek() === ',') {
        s.skip(1);
        continue;
      }
      if (s.peek() === ']') break;
      throw s.unexpected('"," or "]"');
    }
    s.skip(1);
    return items;
  }

  /** Arrays may spread over lines and carry comments between elements. */
  private skipArrayFiller(): void {
    const s = this.scanner;
    while (true) {
      s.skipWhitespace();
      if (s.eatNewline()) continue;
      if (s.peek() === '#') {
        s.skipComment();
        continue;
      }
      return;
    }
  }

  private inlineTable(): TomlTable {
    const s = this.scanner;
    s.skip(1);
    const table: TomlTable = {};
    const open = new Set<TomlTable>();
    s.skipWhitespace();
    if (s.peek() === '}') {
      s.skip(1);
      return table;
    }
    while (true) {
      s.skipWhitespace();
      this.keyValue(table, open, []);
      s.skipWhitespace();
      const ch = s.peek();
      if (ch !== ',' && ch !== '}') throw s.unexpected('"," or "}"');
      s.skip(1);
      if (ch === '}') return table;
    }
  }

  private what(value: TomlValue): string {
    if (Array.isArray(value)) return this.tableArrays.has(value) ? 'an array of tables' : 'a static array';
    if (value instanceof TomlDateTime) return 'a date-time value';
    if (isTable(value)) return this.frozen.has(value) ? 'an inline table' : 'a table';
    return `a ${typeof value} value`;
  }
}

// Own-property access only: `constructor` or `__proto__` must behave like any other key.
function get(table: TomlTable, key: string): TomlValue | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

function set(table: TomlTable, key: string, value: TomlValue): void {
  Object.defineProperty(table, key, { value, enumerable: true, writable: true, configurable: true });
}

/**
 * Render a key path for messages: `"a.b"` when every part is bare, otherwise
 * quoting only the parts that need it, as in `a."c d"`.
 */
function formatPath(parts: readonly string[]): string {
  const bare = parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p));
  if (bare) return `"${parts.join('.')}"`;
  return parts.map((p) => (/^[A-Za-z0-9_-]+$/.test(p) ? p : JSON.stringify(p))).join('.');
}
