import { describe, expect, it } from 'vitest';
import type { WorkspaceFileHistoryEntry } from '../types/workspace';
import {
  checkFreshness,
  findBuildArtifacts,
  findBuiltSourceCommit,
  getBuildProvenance,
  isFresh,
  projectFolder,
  sha256Hex,
  type BuildProvenance,
} from './buildProvenance';

const provenance = (overrides: Partial<BuildProvenance> = {}): BuildProvenance => ({
  builtAt: '2026-11-19T10:00:00Z',
  inputs: [
    { path: 'Cargo.toml', sha256: 'cargo' },
    { path: 'src/helpers.rs', sha256: 'helpers' },
    { path: 'src/bin/a.rs', sha256: 'a' },
  ],
  producer: { kind: 'action', name: 'F Prime compile', runId: 7 },
  sha256: 'artifact',
  source: 'rust/src/bin/a.rs',
  sourceRevision: null,
  sourceSha256: 'a',
  ...overrides,
});

const entry = (commit: string, contentChanged = true): WorkspaceFileHistoryEntry =>
  ({ at: '', author: '', commit, contentChanged, message: '', revisions: [] }) as WorkspaceFileHistoryEntry;

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

  it('reads only well-formed provenance, generic key first, legacy F Prime key normalized', () => {
    expect(getBuildProvenance({ fprimeBuild: { source: 'a' } })).toBeNull();
    expect(getBuildProvenance(null)).toBeNull();
    const { producer: _, ...legacy } = provenance();
    expect(getBuildProvenance({ fprimeBuild: legacy })?.producer).toEqual({ kind: 'action', name: 'F Prime compile' });
    const generic = provenance({ producer: { kind: 'adaptation-output', name: 'SeqJSON' }, source: 'b.seqN.txt' });
    expect(getBuildProvenance({ build: generic, fprimeBuild: legacy })?.source).toBe('b.seqN.txt');
  });

  it('lists the artifacts that name a source, newest first, from their own metadata', () => {
    const files = [
      { fullPath: 'rust/out/a.wasm', metadata: { user: { fprimeBuild: provenance() } } },
      { fullPath: 'rust/out/old.wasm', metadata: { user: { build: provenance({ builtAt: '2026-11-01T00:00:00Z' }) } } },
      { fullPath: 'rust/out/b.wasm', metadata: { user: { build: provenance({ source: 'rust/src/bin/b.rs' }) } } },
      { fullPath: 'rust/src/bin/a.rs', metadata: { user: { generatedFrom: { planId: 1 } } } },
      { fullPath: 'notes.txt', metadata: null },
    ];
    expect(findBuildArtifacts(files, 'rust/src/bin/a.rs').map(a => a.path)).toEqual([
      'rust/out/a.wasm',
      'rust/out/old.wasm',
    ]);
    expect(findBuildArtifacts(files, 'rust/src/bin/c.rs')).toEqual([]);
  });

  it('reports freshness against the saved files, the source on its own', async () => {
    const saved: Record<string, string> = {
      'rust/Cargo.toml': 'cargo',
      'rust/out/a.wasm': 'artifact',
      'rust/src/bin/a.rs': 'a',
      'rust/src/helpers.rs': 'helpers',
    };
    const hashOf = async (path: string) => saved[path] ?? null;
    const fresh = await checkFreshness(provenance(), 'rust/out/a.wasm', hashOf);
    expect(fresh).toEqual({ artifactMatches: true, changed: [], missing: [], sourceChanged: false });
    expect(isFresh(fresh)).toBe(true);

    saved['rust/src/helpers.rs'] = 'helpers v2';
    const helperChanged = await checkFreshness(provenance(), 'rust/out/a.wasm', hashOf);
    expect(helperChanged.changed).toEqual(['src/helpers.rs']);
    expect(helperChanged.sourceChanged).toBe(false);
    expect(isFresh(helperChanged)).toBe(false);

    delete saved['rust/src/bin/a.rs'];
    const sourceGone = await checkFreshness(provenance(), 'rust/out/a.wasm', hashOf);
    expect(sourceGone.sourceChanged).toBeNull();
  });

  it('finds the built source: revision, recorded commit, else by content hash', async () => {
    const contents: Record<string, string> = { c1: 'new', c2: 'built', c3: 'older' };
    const contentAt = async (commit: string) => contents[commit];
    const history = [entry('c1'), entry('m', false), entry('c2'), entry('c3')];

    expect(await findBuiltSourceCommit(provenance({ sourceRevision: '3' }), history, contentAt)).toEqual({
      commit: null,
      found: true,
      searched: 0,
    });
    expect(await findBuiltSourceCommit(provenance({ sourceCommit: 'c3' }), history, contentAt)).toEqual({
      commit: 'c3',
      found: true,
      searched: 0,
    });
    const sourceSha256 = await sha256Hex('built');
    expect((await findBuiltSourceCommit(provenance({ sourceSha256 }), history, contentAt)).commit).toBe('c2');
    expect(await findBuiltSourceCommit(provenance({ sourceSha256: 'nope' }), history, contentAt)).toEqual({
      commit: null,
      found: false,
      searched: 3,
    });
  });

  it('hashes like sha256sum', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
