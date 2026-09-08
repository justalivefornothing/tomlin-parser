export interface Position {
  /** Zero-based offset into the source, in UTF-16 code units. */
  offset: number;
  /** One-based line number. */
  line: number;
  /** One-based column, counted in code points. */
  column: number;
}

/**
 * The only error `parse` ever throws. `message` reads like
 * `Duplicate key "a" at 2:1` followed by a two-line snippet pointing at the
 * offending column; the parts are also exposed as fields.
 */
export class ParseError extends Error {
  override readonly name = 'ParseError';
  /** The message without position or snippet, e.g. `Duplicate key "a"`. */
  readonly reason: string;
  readonly line: number;
  readonly column: number;
  /** The offending source line with a caret underneath. */
  readonly snippet: string;

  constructor(reason: string, position: Position, source: string) {
    const snippet = makeSnippet(source, position);
    super(`${reason} at ${position.line}:${position.column}\n${snippet}`);
    this.reason = reason;
    this.line = position.line;
    this.column = position.column;
    this.snippet = snippet;
  }
}

function makeSnippet(source: string, { offset, line, column }: Position): string {
  const start = source.lastIndexOf('\n', offset - 1) + 1;
  let end = source.indexOf('\n', offset);
  if (end === -1) end = source.length;
  const text = source.slice(start, end).replace(/\r$/, '');
  // Keep tabs so the caret lines up however the terminal renders them.
  const pad = Array.from(text)
    .slice(0, column - 1)
    .map((ch) => (ch === '\t' ? '\t' : ' '))
    .join('');
  const gutter = String(line);
  return `${gutter} | ${text}\n${' '.repeat(gutter.length)} | ${pad}^`;
}
