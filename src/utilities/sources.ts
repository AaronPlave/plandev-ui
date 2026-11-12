import type { AnalysisSourceUsage, SourceLibraryEntry } from '../types/analysis';
import {
  formatRange,
  getRevisionUsage,
  getRevisionVersionLabel,
  getSourceUsage,
  splitSourceRevisions,
} from './analysis';

/* Rows of the Imported Sources page's two grids: one per logical source, and one per revision of the selected source. */

type Revision = SourceLibraryEntry['revisions'][number];

export type SourceRow = {
  /** Analyses that use any revision of it. */
  analyses: number;
  id: number;
  /** The latest successful revision, in people's terms, or why there is none. */
  latest: string;
  name: string;
  owner: string;
  revisions: number;
  source: SourceLibraryEntry;
  status: string;
};

export type RevisionRow = {
  activities: number | null;
  adapter: string;
  analyses: AnalysisSourceUsage[];
  coverage: string;
  /** The adapter's error, or empty. */
  error: string;
  file: string;
  id: number;
  isLatest: boolean;
  requestedBy: string;
  resources: number | null;
  revision: Revision;
  status: string;
  version: string;
};

export const REVISION_STATUS_LABELS: Record<Revision['status'], string> = {
  failed: 'Failed',
  incomplete: 'Importing',
  pending: 'Waiting for worker',
  success: 'Success',
};

/** What a source is doing, from its latest attempts: ready, or what its newer imports are up to. */
function getSourceStatus(pending: Revision[], usable: Revision | null): string {
  const failed = pending.some(({ status }) => status === 'failed');
  const importing = pending.some(({ status }) => status !== 'failed');
  if (usable) {
    return !pending.length ? 'Ready' : `Ready · newer import ${importing ? 'in progress' : 'failed'}`;
  }
  return importing ? 'Importing' : failed ? 'Import failed' : 'No revisions';
}

export function getSourceRows(sources: SourceLibraryEntry[], analyses: AnalysisSourceUsage[]): SourceRow[] {
  return sources.map(source => {
    const { pending, usable } = splitSourceRevisions(source.revisions);
    return {
      analyses: getSourceUsage(source, analyses).length,
      id: source.id,
      latest: usable ? getRevisionVersionLabel(usable) : '—',
      name: source.name,
      owner: source.owner ?? 'none',
      revisions: source.revisions.length,
      source,
      status: getSourceStatus(pending, usable),
    };
  });
}

export function getRevisionRows(
  source: SourceLibraryEntry | undefined,
  analyses: AnalysisSourceUsage[],
): RevisionRow[] {
  if (!source) {
    return [];
  }
  const usage = getRevisionUsage(analyses);
  const { usable } = splitSourceRevisions(source.revisions);
  return source.revisions.map(revision => {
    const done = revision.status === 'success';
    return {
      activities: done ? (revision.activity_types_aggregate.aggregate?.sum?.count ?? 0) : null,
      adapter: `${revision.adapter}${revision.adapter_version ? ` ${revision.adapter_version}` : ''}`,
      analyses: usage[revision.id] ?? [],
      coverage: done ? formatRange(revision.coverage_start, revision.coverage_end) : '',
      error: revision.error?.message ?? '',
      file: revision.metadata?.originalFileName ?? revision.original_file?.name ?? 'Read from the server',
      id: revision.id,
      isLatest: revision.id === usable?.id,
      requestedBy: revision.requested_by ?? 'unknown',
      resources: done ? (revision.resources_aggregate.aggregate?.count ?? 0) : null,
      revision,
      status: REVISION_STATUS_LABELS[revision.status],
      version: done
        ? getRevisionVersionLabel(revision)
        : `Requested ${revision.requested_at.slice(0, 16).replace('T', ' ')} UTC`,
    };
  });
}
