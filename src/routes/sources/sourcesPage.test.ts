import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { writable } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalysisSourceUsage, SourceLibraryEntry } from '../../types/analysis';

const state = vi.hoisted(() => ({
  analyzeRevision: vi.fn(),
  deleteSource: vi.fn(),
  deleteSourceRevision: vi.fn(),
  goto: vi.fn(),
}));

vi.mock('$env/dynamic/public', () => ({ env: {} }));
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$app/navigation', () => ({ goto: state.goto }));
vi.mock('$app/paths', () => ({ base: '' }));
vi.mock('../../components/app/Nav.svelte', async () => ({
  default: (await import('../../tests/mocks/Stub.svelte')).default,
}));
vi.mock('../../components/app/PageTitle.svelte', async () => ({
  default: (await import('../../tests/mocks/Stub.svelte')).default,
}));
vi.mock('../../components/sources/SourceImportForm.svelte', async () => ({
  default: (await import('../../tests/mocks/Stub.svelte')).default,
}));
vi.mock('../../stores/analysis', () => ({ analyzeRevision: state.analyzeRevision }));
vi.mock('../../stores/user', () => ({
  getUserStore: () =>
    writable({
      activeRole: 'aerie_admin',
      allowedRoles: ['aerie_admin'],
      defaultRole: 'aerie_admin',
      id: 'me',
      permissibleQueries: {},
      token: 't',
    }),
}));
vi.mock('../../utilities/effects', () => ({
  default: {
    deleteSource: state.deleteSource,
    deleteSourceRevision: state.deleteSourceRevision,
    renameSource: vi.fn(),
  },
}));
vi.mock('../../stores/sources', async () => {
  const { writable } = await import('svelte/store');
  const library = Object.assign(writable<SourceLibraryEntry[]>([]), { loading: writable(false) });
  return {
    analysisSourceUsage: writable<AnalysisSourceUsage[]>([]),
    setLibrary: library.set,
    sources: library,
  };
});

const { default: Page } = await import('./+page.svelte');
const { setLibrary } = (await import('../../stores/sources')) as unknown as {
  setLibrary: (v: SourceLibraryEntry[]) => void;
};

vi.stubGlobal(
  'ResizeObserver',
  vi.fn(() => ({ disconnect: vi.fn(), observe: vi.fn(), unobserve: vi.fn() })),
);

const revision = (id: number, status: 'failed' | 'success', file: string, error: string | null = null) =>
  ({
    activity_types_aggregate: { aggregate: { sum: { count: 4 } } },
    adapter: 'xml_tol',
    adapter_version: '1',
    content_hash: null,
    coverage_end: '2030-01-02T00:00:00Z',
    coverage_start: '2030-01-01T00:00:00Z',
    error: error ? { message: error } : null,
    finished_at: null,
    id,
    metadata: { originalFileName: file },
    original_file: null,
    requested_at: '2030-01-01T10:00:00Z',
    requested_by: 'me',
    resources_aggregate: { aggregate: { count: 2 } },
    status,
  }) as SourceLibraryEntry['revisions'][number];
const entry = (id: number, name: string, revisions: SourceLibraryEntry['revisions']): SourceLibraryEntry => ({
  created_at: '',
  id,
  name,
  owner: 'me',
  revisions,
  source_type: 'xml_tol',
});

describe('the Imported Sources page', () => {
  beforeEach(() => {
    setLibrary([
      entry(1, 'Demo tour', [
        revision(12, 'failed', 'tour-v2.xml', 'Line 4: unexpected end'),
        revision(11, 'success', 'tour-v1.xml'),
      ]),
      entry(2, 'Other', [revision(20, 'success', 'other.xml')]),
    ]);
  });
  afterEach(() => cleanup());

  it('lists one row per source, and shows the revisions of the one selected, kept through an update', async () => {
    const { container, getByText, queryByText } = render(Page);
    await waitFor(() => expect(container.querySelectorAll('.ag-center-cols-container .ag-row')).toHaveLength(2));
    expect(getByText('Demo tour')).toBeTruthy();
    expect(getByText('Ready · newer import failed')).toBeTruthy();
    expect(queryByText('tour-v1.xml')).toBeNull(); // no source chosen: no revisions

    await fireEvent.click(getByText('Demo tour'));
    await waitFor(() => expect(getByText('tour-v1.xml')).toBeTruthy());
    expect(getByText('Line 4: unexpected end')).toBeTruthy();
    expect(getByText('Revisions of "Demo tour"')).toBeTruthy();

    // A subscription update (the failed import is cleared): the chosen source stays chosen.
    setLibrary([
      entry(1, 'Demo tour', [revision(11, 'success', 'tour-v1.xml')]),
      entry(2, 'Other', [revision(20, 'success', 'other.xml')]),
    ]);
    await waitFor(() => expect(queryByText('Line 4: unexpected end')).toBeNull());
    expect(getByText('Revisions of "Demo tour"')).toBeTruthy();
    expect(getByText('tour-v1.xml')).toBeTruthy();

    // The chosen source is deleted: its revisions are no longer shown.
    setLibrary([entry(2, 'Other', [revision(20, 'success', 'other.xml')])]);
    await waitFor(() => expect(queryByText('Revisions of "Demo tour"')).toBeNull());
  });

  it('analyzes a source or revision, deletes either with the analyses that use it, and offers no Analyze on a failed import', async () => {
    state.analyzeRevision.mockResolvedValue(7);
    const { container, getByText } = render(Page);
    await waitFor(() => expect(container.querySelectorAll('.ag-center-cols-container .ag-row')).toHaveLength(2));
    const buttons = (row: Element) => [...row.querySelectorAll<HTMLButtonElement>('.actions-cell button')];
    const [demo] = [...container.querySelectorAll('.ag-center-cols-container .ag-row')];
    await waitFor(() => expect(buttons(demo).length).toBeGreaterThan(0)); // cell renderers draw a moment after the rows
    // A source row: Analyze (the latest successful revision, 11), Rename, Delete.
    expect(buttons(demo)).toHaveLength(3);
    await fireEvent.click(buttons(demo)[0]);
    await waitFor(() => expect(state.analyzeRevision).toHaveBeenCalled());
    expect(state.analyzeRevision.mock.calls[0][1]).toMatchObject({ id: 11, status: 'success' });
    await waitFor(() => expect(state.goto).toHaveBeenCalledWith('/analyses/7'));
    await fireEvent.click(buttons(demo)[2]);
    expect(state.deleteSource).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), [], expect.anything());

    // Its revisions: the failed one can only be deleted, the successful one analyzed or deleted.
    await fireEvent.click(getByText('Demo tour'));
    await waitFor(() => expect(getByText('tour-v1.xml')).toBeTruthy());
    await waitFor(() => expect(container.querySelectorAll('.actions-cell button').length).toBeGreaterThan(6));
    const revisionRows = [...container.querySelectorAll('.ag-center-cols-container .ag-row')].filter(row =>
      row.textContent?.includes('tour-v'),
    );
    expect(revisionRows.map(row => buttons(row).length)).toEqual([1, 2]);
    await fireEvent.click(buttons(revisionRows[0])[0]);
    expect(state.deleteSourceRevision).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      12,
      [],
      expect.anything(),
    );
  });
});
