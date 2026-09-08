import { TomlDateTime } from './datetime.js';

/** Any value that can appear in a TOML document. */
export type TomlValue = string | number | boolean | TomlDateTime | TomlArray | TomlTable;

export type TomlArray = TomlValue[];

export interface TomlTable {
  [key: string]: TomlValue;
}

/** True for plain tables: objects that are neither arrays nor date/times. */
export function isTable(value: unknown): value is TomlTable {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof TomlDateTime)
  );
}
