import type { WorkspaceFileHistoryEntry } from '../types/workspace';

/**
 * What a producer recorded on an artifact it wrote: what went in, with content hashes, and what came
 * out. The artifact owns it; sources find their artifacts by reading it, never by name matching.
 *
 * Read from `user.build` (the generic key) or `user.fprimeBuild` (written by the F Prime compile
 * Action before the generic key existed; normalized here, not migrated).
 */
export type BuildProvenance = {
  builtAt: string;
  /** Artifact size in bytes; absent on artifacts built before it was recorded. */
  bytes?: number;
  dictionary?: { mission: string; sha256?: string; version: string } | null;
  /** Files the artifact was built from, relative to the project folder (see `projectFolder`). */
  inputs: { path: string; sha256: string }[];
  producer: BuildProducer;
  /** SHA-256 of the artifact bytes as written. */
  sha256: string;
  source: string;
  /** The workspace history commit of the saved source that was built (working-copy builds). */
  sourceCommit?: string | null;
  /** The named revision that was built, when the producer was given one. */
  sourceRevision: string | null;
  sourceSha256: string;
  toolchain?: (Record<string, unknown> & { patches?: { name: string; sha256: string }[] }) | null;
  verify?: { ok: boolean; totalBytes: number | null } | null;
};

export type BuildProducer =
  /** A workspace Action run (remote/toolchain build); failed attempts stay in its run history. */
  | { kind: 'action'; name: string; runId?: number | null }
  /** An adaptation's output format, saved explicitly from the editor. */
  | { kind: 'adaptation-output'; name: string };

export const BUILD_PROVENANCE_KEY = 'build';
const LEGACY_FPRIME_KEY = 'fprimeBuild';

export function getBuildProvenance(user: Record<string, unknown> | null | undefined): BuildProvenance | null {
  const generic = user?.[BUILD_PROVENANCE_KEY] as Partial<BuildProvenance> | undefined;
  const legacy = user?.[LEGACY_FPRIME_KEY] as Partial<BuildProvenance> | undefined;
  const value = isProvenance(generic) ? generic : isProvenance(legacy) ? legacy : null;
  if (!value) {
    return null;
  }
  return {
    ...value,
    producer: value.producer ?? { kind: 'action', name: 'F Prime compile' },
    sourceRevision: value.sourceRevision ?? null,
  } as BuildProvenance;
}

function isProvenance(value: Partial<BuildProvenance> | undefined): value is Partial<BuildProvenance> {
  return (
    !!value &&
    typeof value.source === 'string' &&
    typeof value.sha256 === 'string' &&
    typeof value.sourceSha256 === 'string' &&
    Array.isArray(value.inputs)
  );
}

export type BuildArtifact = { path: string; provenance: BuildProvenance };

/** Artifacts whose recorded provenance names this source, newest build first. */
export function findBuildArtifacts(
  files: { fullPath: string; metadata?: { user?: Record<string, unknown> } | null }[],
  sourcePath: string,
): BuildArtifact[] {
  return files
    .flatMap(file => {
      const provenance = getBuildProvenance(file.metadata?.user);
      return provenance?.source === sourcePath ? [{ path: file.fullPath, provenance }] : [];
    })
    .sort((a, b) => b.provenance.builtAt.localeCompare(a.provenance.builtAt));
}

/**
 * The workspace folder the inputs are relative to: the source's path minus the input naming it
 * (`rust/src/bin/a.rs` with input `src/bin/a.rs` → `rust/`), or null if no input names it.
 */
export function projectFolder(provenance: Pick<BuildProvenance, 'inputs' | 'source'>): string | null {
  const { source } = provenance;
  const own = provenance.inputs.find(({ path }) => source === path || source.endsWith(`/${path}`));
  return own ? source.slice(0, source.length - own.path.length) : null;
}

export type Freshness = {
  /** null: the artifact could not be read. */
  artifactMatches: boolean | null;
  /** Recorded inputs other than the source whose saved content differs now. */
  changed: string[];
  /** Recorded inputs not in the workspace now. */
  missing: string[];
  /** The saved source differs from what was built; null when the source is gone (deleted or moved). */
  sourceChanged: boolean | null;
};

/** Compares the recorded content hashes with the saved files now. `hashOf` returns null for a missing file. */
export async function checkFreshness(
  provenance: BuildProvenance,
  artifactPath: string,
  hashOf: (path: string) => Promise<string | null>,
): Promise<Freshness> {
  const folder = projectFolder(provenance);
  const inputs =
    folder === null ? [] : provenance.inputs.filter(input => `${folder}${input.path}` !== provenance.source);
  const [artifactHash, sourceHash, ...inputHashes] = await Promise.all([
    hashOf(artifactPath),
    hashOf(provenance.source),
    ...inputs.map(input => hashOf(`${folder}${input.path}`)),
  ]);
  return {
    artifactMatches: artifactHash === null ? null : artifactHash === provenance.sha256,
    changed: inputs.filter((input, i) => inputHashes[i] !== null && inputHashes[i] !== input.sha256).map(i => i.path),
    missing: inputs.filter((_, i) => inputHashes[i] === null).map(i => i.path),
    sourceChanged: sourceHash === null ? null : sourceHash !== provenance.sourceSha256,
  };
}

export function isFresh(freshness: Freshness): boolean {
  return freshness.sourceChanged === false && !freshness.changed.length && freshness.artifactMatches !== false;
}

/**
 * Where the built source is in its history, for a comparison: the recorded commit; else (older
 * artifacts) the newest saved version whose content hash is the recorded one. Builds from a named
 * revision use the revision instead (`null` here).
 */
export async function findBuiltSourceCommit(
  provenance: BuildProvenance,
  history: WorkspaceFileHistoryEntry[],
  contentAt: (commit: string) => Promise<string>,
): Promise<{ commit: string | null; found: boolean; searched: number }> {
  if (provenance.sourceRevision) {
    return { commit: null, found: true, searched: 0 };
  }
  if (provenance.sourceCommit && history.some(entry => entry.commit === provenance.sourceCommit)) {
    return { commit: provenance.sourceCommit, found: true, searched: 0 };
  }
  const candidates = history.filter(entry => entry.contentChanged);
  for (const entry of candidates) {
    if ((await sha256Hex(await contentAt(entry.commit))) === provenance.sourceSha256) {
      return { commit: entry.commit, found: true, searched: candidates.length };
    }
  }
  return { commit: null, found: false, searched: candidates.length };
}

export async function sha256Hex(data: string | ArrayBuffer): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
