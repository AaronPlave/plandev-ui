import { describe, expect, it } from 'vitest';
import type { AnalysisSourceUsage, SourceLibraryEntry } from '../types/analysis';
import { getRevisionRows, getSourceRows } from './sources';

type Revision = SourceLibraryEntry['revisions'][number];
const revision = (id: number, status: Revision['status'], extra: Partial<Revision> = {}): Revision => ({
  activity_types_aggregate: { aggregate: { sum: { count: 12 } } },
  adapter: 'xml_tol',
  adapter_version: '1',
  content_hash: null,
  coverage_end: '2030-01-02T00:00:00Z',
  coverage_start: '2030-01-01T00:00:00Z',
  error: null,
  finished_at: null,
  id,
  metadata: { originalFileName: `tour-${id}.xml` },
  original_file: null,
  requested_at: `2030-01-0${id % 9}T10:00:00Z`,
  requested_by: 'me',
  resources_aggregate: { aggregate: { count: 3 } },
  status,
  ...extra,
});
const source = (id: number, revisions: Revision[], owner: string | null = 'me'): SourceLibraryEntry => ({
  created_at: '',
  id,
  name: `Source ${id}`,
  owner,
  revisions,
  source_type: 'xml_tol',
});
const analysis = (id: number, ...revisionIds: number[]): AnalysisSourceUsage => ({
  id,
  name: `Analysis ${id}`,
  owner: 'me',
  sources: revisionIds.map((revisionId, i) => ({ id: `source-${i}`, kind: 'imported' as const, revisionId })),
  updated_at: '',
});

describe('Imported Sources grid rows', () => {
  it('has one row per logical source, with its latest successful revision, status, revision and analysis counts', () => {
    const sources = [
      source(1, [
        revision(3, 'failed', { error: { message: 'bad xml' } }),
        revision(2, 'success'),
        revision(1, 'success'),
      ]),
      source(2, [revision(5, 'incomplete')]),
      source(3, [revision(6, 'failed')], null),
      source(4, [revision(8, 'success')]),
    ];
    const rows = getSourceRows(sources, [analysis(10, 1), analysis(11, 2, 1), analysis(12, 8)]);
    expect(rows.map(row => [row.id, row.status, row.revisions, row.analyses, row.owner])).toEqual([
      [1, 'Ready · newer import failed', 3, 2, 'me'],
      [2, 'Importing', 1, 0, 'me'],
      [3, 'Import failed', 1, 0, 'none'],
      [4, 'Ready', 1, 1, 'me'],
    ]);
    // The latest is the newest *successful* revision (2), not the failed attempt after it.
    expect(rows[0].latest).toBe(getRevisionRows(sources[0], [])[1].version);
    expect(rows[1].latest).toBe('—');
    // Rows keep the entry they came from, for the actions and permission checks.
    expect(rows[0].source).toBe(sources[0]);
  });

  it('has one row per revision of the chosen source, with import state, counts, file, error and its analyses', () => {
    const entry = source(1, [
      revision(3, 'failed', { error: { message: 'bad xml' } }),
      revision(2, 'success'),
      revision(1, 'pending'),
    ]);
    const rows = getRevisionRows(entry, [analysis(10, 2), analysis(11, 2), analysis(12, 1)]);
    expect(rows.map(row => [row.id, row.status, row.isLatest, row.analyses.map(({ id }) => id)])).toEqual([
      [3, 'Failed', false, []],
      [2, 'Success', true, [10, 11]],
      [1, 'Waiting for worker', false, [12]],
    ]);
    expect(rows[0]).toMatchObject({ activities: null, error: 'bad xml', file: 'tour-3.xml', resources: null });
    expect(rows[1]).toMatchObject({
      activities: 12,
      adapter: 'xml_tol 1',
      coverage: 'Jan 1, 2030 – Jan 2, 2030',
      resources: 3,
    });
    expect(getRevisionRows(undefined, [])).toEqual([]);
  });

  it('is stable under a subscription update: the same ids give the same rows', () => {
    const entry = source(1, [revision(2, 'incomplete')]);
    const before = getSourceRows([entry], []);
    const after = getSourceRows([source(1, [revision(2, 'success')])], []);
    expect(after.map(({ id }) => id)).toEqual(before.map(({ id }) => id));
    expect(before[0].status).toBe('Importing');
    expect(after[0].status).toBe('Ready');
  });
});
