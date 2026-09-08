export type DateTimeKind = 'offset-datetime' | 'local-datetime' | 'local-date' | 'local-time';

/**
 * TOML has four date/time flavours and JavaScript's `Date` can faithfully hold
 * only one of them, so `parse` produces these tagged objects instead. Being a
 * class (rather than a plain `{ kind }` object) means a table that happens to
 * contain a `kind` key can never be mistaken for a date.
 *
 * Components are normalised: `T` separator, upper-case `Z`, fraction kept as
 * written. `toString()` yields canonical TOML, which is what `stringify` emits.
 */
export class TomlDateTime {
  /** `YYYY-MM-DD`, or `''` for a local time. */
  readonly date: string;
  /** `HH:MM:SS` with optional `.fraction`, or `''` for a local date. */
  readonly time: string;
  /** `Z` or `±HH:MM`; `''` unless `kind` is `offset-datetime`. */
  readonly offset: string;

  constructor(
    readonly kind: DateTimeKind,
    parts: { date?: string; time?: string; offset?: string },
  ) {
    this.date = parts.date ?? '';
    this.time = parts.time ?? '';
    this.offset = parts.offset ?? '';
  }

  static offsetDateTime(date: string, time: string, offset: string): TomlDateTime {
    return new TomlDateTime('offset-datetime', { date, time, offset });
  }
  static localDateTime(date: string, time: string): TomlDateTime {
    return new TomlDateTime('local-datetime', { date, time });
  }
  static localDate(date: string): TomlDateTime {
    return new TomlDateTime('local-date', { date });
  }
  static localTime(time: string): TomlDateTime {
    return new TomlDateTime('local-time', { time });
  }

  /** Wrap a JavaScript `Date` as an offset date-time in UTC. */
  static fromDate(date: Date): TomlDateTime {
    const iso = date.toISOString();
    return TomlDateTime.offsetDateTime(iso.slice(0, 10), iso.slice(11, 23), 'Z');
  }

  /**
   * Convert to a JavaScript `Date`. Local date-times and dates are interpreted
   * in the host time zone; a local time has no date to anchor to and throws.
   */
  toDate(): Date {
    if (this.kind === 'local-time') {
      throw new TypeError('A local time has no date and cannot become a Date');
    }
    return new Date(`${this.date}T${this.time || '00:00:00'}${this.offset}`);
  }

  /** Canonical TOML text, e.g. `1979-05-27T07:32:00Z`. */
  toString(): string {
    const sep = this.date && this.time ? 'T' : '';
    return `${this.date}${sep}${this.time}${this.offset}`;
  }

  toJSON(): string {
    return this.toString();
  }
}
