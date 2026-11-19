/**
 * Build provenance a build Action records on its artifact (`user.fprimeBuild`, written by the F Prime
 * compile Action): what went in, with content hashes, and what came out. Read here, never inferred.
 */
export type BuildProvenance = {
  builtAt: string;
  /** Artifact size in bytes; absent on artifacts built before it was recorded. */
  bytes?: number;
  dictionary: { mission: string; sha256: string; version: string };
  /** Every file sent to the toolchain, relative to the project folder. */
  inputs: { path: string; sha256: string }[];
  /** SHA-256 of the artifact bytes as written. */
  sha256: string;
  source: string;
  sourceRevision: string | null;
  sourceSha256: string;
  toolchain: Record<string, unknown> & { patches?: { name: string; sha256: string }[] };
  verify?: { ok: boolean; totalBytes: number | null } | null;
};

export const BUILD_PROVENANCE_KEY = 'fprimeBuild';

export function getBuildProvenance(user: Record<string, unknown> | null | undefined): BuildProvenance | null {
  const value = user?.[BUILD_PROVENANCE_KEY] as Partial<BuildProvenance> | undefined;
  return value &&
    typeof value.source === 'string' &&
    typeof value.sha256 === 'string' &&
    typeof value.sourceSha256 === 'string' &&
    Array.isArray(value.inputs)
    ? (value as BuildProvenance)
    : null;
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

export async function sha256Hex(data: string | ArrayBuffer): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
