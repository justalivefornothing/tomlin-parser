import { ParseError, type Position } from './errors.js';

/** True for characters TOML forbids raw in strings and comments (tab excepted). */
export function isControl(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return (c < 0x20 && c !== 0x09) || c === 0x7f;
}

export function isBareKeyChar(ch: string): boolean {
  return /^[A-Za-z0-9_-]$/.test(ch);
}

/**
 * A position cursor over the source. All syntax characters TOML cares about
 * are ASCII, so lookahead works in code units, while `next()` consumes whole
 * code points so that columns count characters rather than surrogate halves.
 */
export class Scanner {
  offset = 0;
  line = 1;
  column = 1;

  constructor(readonly src: string) {}

  get done(): boolean {
    return this.offset >= this.src.length;
  }

  peek(ahead = 0): string {
    return this.src[this.offset + ahead] ?? '';
  }

  startsWith(text: string): boolean {
    return this.src.startsWith(text, this.offset);
  }

  /** Consume and return one code point ('' at end of input). */
  next(): string {
    const code = this.src.codePointAt(this.offset);
    if (code === undefined) return '';
    const ch = String.fromCodePoint(code);
    this.offset += ch.length;
    if (ch === '\n') {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return ch;
  }

  /** Consume `count` characters known to be single-column ASCII. */
  skip(count: number): void {
    this.offset += count;
    this.column += count;
  }

  /** Consume spaces and tabs. */
  skipWhitespace(): void {
    while (this.peek() === ' ' || this.peek() === '\t') this.skip(1);
  }

  /** Consume `\n` or `\r\n`. Returns false (consuming nothing) if not at a line break. */
  eatNewline(): boolean {
    if (this.peek() === '\n') {
      this.next();
      return true;
    }
    if (this.peek() === '\r' && this.peek(1) === '\n') {
      this.skip(1);
      this.next();
      return true;
    }
    return false;
  }

  /** Consume a `# comment` up to (not including) the line break. */
  skipComment(): void {
    if (this.peek() !== '#') return;
    while (!this.done) {
      const ch = this.peek();
      if (ch === '\n' || (ch === '\r' && this.peek(1) === '\n')) return;
      if (isControl(ch)) throw this.error(`Control character U+${hex(ch)} in comment`);
      this.next();
    }
  }

  /**
   * Consume optional whitespace and a comment, then require a line break or
   * end of input. This is what makes the parser line-oriented.
   */
  endOfLine(): void {
    this.skipWhitespace();
    this.skipComment();
    if (this.done || this.eatNewline()) return;
    throw this.unexpected('end of line');
  }

  expect(text: string): void {
    if (!this.startsWith(text)) throw this.unexpected(`"${text}"`);
    this.skip(text.length);
  }

  position(): Position {
    return { offset: this.offset, line: this.line, column: this.column };
  }

  error(reason: string, at: Position = this.position()): ParseError {
    return new ParseError(reason, at, this.src);
  }

  /** `Unexpected <what is here>, expected <expected>` at the current position. */
  unexpected(expected: string): ParseError {
    return this.error(`Unexpected ${this.describeHere()}, expected ${expected}`);
  }

  private describeHere(): string {
    const ch = this.peek();
    if (ch === '') return 'end of input';
    if (ch === '\n' || (ch === '\r' && this.peek(1) === '\n')) return 'end of line';
    if (isControl(ch)) return `control character U+${hex(ch)}`;
    return `"${String.fromCodePoint(this.src.codePointAt(this.offset)!)}"`;
  }
}

function hex(ch: string): string {
  return ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
}
