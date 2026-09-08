import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ParseError, TomlDateTime, parse, stringify } from './index.js';

interface Manifest {
  package: { name: string; description: string; keywords: string[]; metadata: { docs: { rs: { 'all-features': boolean } } } };
  dependencies: Record<string, unknown>;
  bin: Array<{ name: string; path: string; 'required-features'?: string[] }>;
  profile: { release: { lto: string; 'opt-level': number; debug: boolean; panic: string } };
  workspace: { metadata: Record<string, TomlDateTime> };
}

const source = readFileSync(new URL('../examples/Cargo.toml', import.meta.url), 'utf8');

describe('a Cargo-style manifest', () => {
  const manifest = parse<Manifest>(source);

  it('gets the shape exactly right', () => {
    expect(manifest.package.name).toBe('tomlin-demo');
    expect(manifest.package.description).toBe('A tiny CLI that pretty-prints TOML files.');
    expect(manifest.package.keywords).toEqual(['toml', 'cli', 'parser']);
    expect(manifest.package.metadata.docs.rs['all-features']).toBe(true);
    expect(manifest.dependencies).toEqual({
      serde: { version: '1.0', features: ['derive'] },
      clap: { version: '4.5', features: ['derive', 'wrap_help'] },
      'tokio-util': { version: '0.7', optional: true },
    });
    expect(manifest.bin).toEqual([
      { name: 'tomlin', path: 'src/main.rs' },
      { name: 'tomlin-fmt', path: 'src/fmt.rs', 'required-features': ['async'] },
    ]);
    expect(manifest.profile.release).toEqual({ lto: 'thin', 'opt-level': 3, debug: false, panic: 'abort' });
    expect(manifest.workspace.metadata.released?.kind).toBe('offset-datetime');
    expect(manifest.workspace.metadata.released?.toDate().toISOString()).toBe('2024-03-01T08:30:00.000Z');
    expect(String(manifest.workspace.metadata['build-day'])).toBe('2024-03-01');
    expect(manifest.workspace.metadata.nightly?.kind).toBe('local-time');
  });

  it('survives a round trip through stringify', () => {
    expect(parse(stringify(manifest))).toEqual(manifest);
  });

  it('reports a duplicate [[bin]] name with its exact position', () => {
    const broken = [
      '[package]',
      'name = "tomlin-demo"',
      'version = "0.4.1"',
      'edition = "2021"',
      '',
      '[dependencies]',
      'serde = "1"',
      '',
      '[[bin]]',
      'name = "tomlin"',
      'path = "src/main.rs"',
      'name = "tomlin-fmt"',
    ].join('\n');
    let error: ParseError | undefined;
    try {
      parse(broken);
    } catch (e) {
      error = e as ParseError;
    }
    expect(error?.message.split('\n')[0]).toBe('Duplicate key "name" at 12:1');
    expect(error?.snippet).toBe('12 | name = "tomlin-fmt"\n   | ^');
  });
});
