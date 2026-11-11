import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Analysis } from '../types/analysis';
import type { User } from '../types/app';
import { createAnalysisDefinition } from '../utilities/analysis';

const effects = vi.hoisted(() => ({
  getAnalysisPlans: vi.fn(async () => []),
  getAnalysisSimulationDatasets: vi.fn(async () => []),
  getAnalysisSourceRecovery: vi.fn(async () => ({})),
  getAnalysisSourceRevisions: vi.fn(),
  importSourceRevision: vi.fn(),
}));
const toasts = vi.hoisted(() => ({ showFailureToast: vi.fn(), showSuccessToast: vi.fn() }));
vi.mock('$env/dynamic/public', () => ({ env: {} }));
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('../utilities/effects', () => ({ default: effects }));
vi.mock('../utilities/toast', () => toasts);

/** The Sources library, set by the test, that counts its subscribers so a leaked subscription shows. */
const library = vi.hoisted(() => ({ count: (): number => 0 }));
vi.mock('./sources', async () => {
  const { writable } = await import('svelte/store');
  const store = writable<unknown[]>([]);
  const loading = writable(false);
  let subscribers: number = 0;
  const counted = {
    loading,
    set: store.set,
    subscribe: (run: (value: unknown[]) => void) => {
      subscribers++;
      const stop = store.subscribe(run);
      return () => {
        subscribers--;
        stop();
      };
    },
  };
  library.count = () => subscribers;
  return { analysisSourceUsage: writable([]), setLibrary: store.set, sources: counted };
});
vi.mock('./subscribable', () => {
  const store = <T>(value: T) => ({ subscribe: (run: (value: T) => void) => (run(value), () => {}) });
  return { gqlSubscribable: () => ({ ...store([]), error: store(''), loading: store(false) }) };
});

const {
  addAnalysisSource,
  addAnalysisSourceWhenImported,
  analysisSourceBindings,
  closeAnalysis,
  dismissAnalysisImport,
  openAnalysis,
  pendingAnalysisImports,
  retryAnalysisImport,
} = await import('./analysis');
const { setLibrary } = (await import('./sources')) as unknown as { setLibrary: (value: unknown[]) => void };

const user = { activeRole: 'user', id: 'test', permissibleQueries: {}, token: 't' } as unknown as User;
const file = new File(['<xml/>'], 'tour.tol.xml');

function revision(id: number, status: string, error: { message: string } | null = null) {
  return {
    activity_types: [],
    coverage_end: '2034-09-03T00:00:00Z',
    coverage_start: '2030-04-27T00:00:00Z',
    error,
    id,
    metadata: {},
    requested_at: '2026-10-03T12:00:00Z',
    resources: [],
    source: { id: 5, latest: [], name: 'Demo tour', source_type: 'xml_tol' },
    status,
  };
}

/** Puts revision `id` in the library with `status`. */
function listed(id: number, status: string, error: { message: string } | null = null) {
  setLibrary([{ id: 5, name: 'Demo tour', revisions: [{ error, id, status }] }]);
}

const analysis: Analysis = {
  created_at: '',
  definition: createAnalysisDefinition(),
  id: 4,
  name: 'A',
  owner: 'test',
  updated_at: '',
};

describe('an import started from an analysis, to be added when it succeeds', () => {
  beforeEach(async () => {
    effects.getAnalysisSourceRevisions.mockImplementation(async (ids: number[]) =>
      ids.map(id => revision(id, 'success')),
    );
    setLibrary([]);
    await openAnalysis(analysis, user);
  });
  afterEach(() => {
    closeAnalysis();
    vi.clearAllMocks();
  });

  const track = (revisionId = 30) =>
    addAnalysisSourceWhenImported({ adapter: 'auto', file, revisionId, sourceId: 5 }, user);
  const bound = () => get(analysisSourceBindings).map(({ id, ...rest }) => rest);

  it('adds nothing while the revision is pending or importing, then adds it, with its source, once it succeeds', async () => {
    track();
    expect(library.count()).toBe(1);
    listed(30, 'pending');
    listed(30, 'incomplete');
    expect(bound()).toEqual([]);
    expect(get(pendingAnalysisImports)).toHaveLength(1);

    listed(30, 'success');
    await vi.waitFor(() =>
      expect(bound()).toEqual([{ kind: 'imported', revisionId: 30, sourceId: 5, sourceName: 'Demo tour' }]),
    );
    expect(get(pendingAnalysisImports)).toEqual([]);
    await vi.waitFor(() => expect(toasts.showSuccessToast).toHaveBeenCalledWith('Added Demo tour to this analysis'));
    expect(library.count()).toBe(0);
  });

  it("doesn't take a revision the library hasn't listed yet for a deleted one", async () => {
    track();
    setLibrary([{ id: 5, name: 'Demo tour', revisions: [] }]); // an older snapshot, from before the insert
    expect(get(pendingAnalysisImports)[0].status).toBe('importing');
    listed(30, 'pending');
    setLibrary([{ id: 5, name: 'Demo tour', revisions: [] }]); // listed, and now gone
    expect(get(pendingAnalysisImports)[0]).toMatchObject({
      error: 'The import was deleted before it finished.',
      status: 'failed',
    });
  });

  it('keeps a failed import, shows its error, adds nothing, and retries into the same source', async () => {
    track();
    listed(30, 'failed', { message: 'Line 412: unexpected end of element' });
    const [failed] = get(pendingAnalysisImports);
    expect(failed).toMatchObject({ error: 'Line 412: unexpected end of element', status: 'failed' });
    expect(bound()).toEqual([]);
    expect(toasts.showFailureToast).toHaveBeenCalled();
    expect(library.count()).toBe(0);

    effects.importSourceRevision.mockResolvedValue({ revisionId: 31, sourceId: 5 });
    await retryAnalysisImport(failed, user);
    expect(effects.importSourceRevision).toHaveBeenCalledWith(file, { sourceId: 5 }, 'auto', user);
    expect(get(pendingAnalysisImports)).toMatchObject([{ revisionId: 31, status: 'importing' }]);
    expect(library.count()).toBe(1);

    setLibrary([
      {
        id: 5,
        name: 'Demo tour',
        revisions: [
          { id: 30, status: 'failed' },
          { id: 31, status: 'success' },
        ],
      },
    ]);
    await vi.waitFor(() => expect(bound()).toMatchObject([{ revisionId: 31 }]));
    await vi.waitFor(() => expect(toasts.showSuccessToast).toHaveBeenCalled()); // settle before the test ends
  });

  it("doesn't bind a revision twice when it was added by hand while it was importing", async () => {
    track();
    listed(30, 'incomplete');
    await addAnalysisSource({ kind: 'imported', revisionId: 30, sourceId: 5 }, user);
    listed(30, 'success');
    await vi.waitFor(() => expect(get(pendingAnalysisImports)).toEqual([]));
    expect(bound()).toHaveLength(1);
    expect(toasts.showSuccessToast).not.toHaveBeenCalled();
  });

  it('stops waiting when dismissed, and drops everything, with its subscription, when the analysis closes', () => {
    track(30);
    track(31);
    dismissAnalysisImport(30);
    expect(get(pendingAnalysisImports).map(({ revisionId }) => revisionId)).toEqual([31]);
    expect(library.count()).toBe(1);
    closeAnalysis();
    expect(get(pendingAnalysisImports)).toEqual([]);
    expect(library.count()).toBe(0);
  });

  it('is dropped when another analysis opens', async () => {
    track();
    await openAnalysis({ ...analysis, id: 5 }, user);
    expect(get(pendingAnalysisImports)).toEqual([]);
    expect(library.count()).toBe(0);
    listed(30, 'success');
    expect(bound()).toEqual([]);
  });
});
