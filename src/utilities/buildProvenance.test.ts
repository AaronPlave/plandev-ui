import { describe, expect, it } from 'vitest';
import { getBuildProvenance, projectFolder, sha256Hex } from './buildProvenance';

describe('build provenance', () => {
  it('finds the project folder from the input that is the source', () => {
    const inputs = [
      { path: 'Cargo.toml', sha256: '' },
      { path: 'src/bin/a.rs', sha256: '' },
    ];
    expect(projectFolder({ inputs, source: 'rust/src/bin/a.rs' })).toBe('rust/');
    expect(projectFolder({ inputs: [{ path: 'a.seq', sha256: '' }], source: 'a.seq' })).toBe('');
    expect(projectFolder({ inputs, source: 'rust/src/bin/xa.rs' })).toBeNull();
  });

  it('reads only well-formed provenance', () => {
    expect(getBuildProvenance({ fprimeBuild: { source: 'a' } })).toBeNull();
    expect(getBuildProvenance(null)).toBeNull();
  });

  it('hashes like sha256sum', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
