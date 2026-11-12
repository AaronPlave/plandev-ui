import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../types/app';
import type { SourceQuery, SourceQueryResult } from '../utilities/importedResource';
import {
  createImportedResourceSubscription,
  getSourceQuery,
  SETTLE_MS,
  type ImportedResourceQuery,
} from './importedResource';

const { querySourceResources } = vi.hoisted(() => ({ querySourceResources: vi.fn() }));
vi.mock('../utilities/effects', () => ({ default: { querySourceResources } }));

function result(t: number[], v: number[], extra: Partial<SourceQueryResult> = {}): SourceQueryResult {
  return {
    after: null,
    approximate: true,
    before: null,
    bucketWidth: 1,
    next: null,
    representation: 'summary',
    resource: 'r',
    series: { t, v },
    ...extra,
  };
}

/** A query function whose responses the test releases by hand, in any order. */
function controlledQuery() {
  const calls: { query: SourceQuery; resolve: (r: SourceQueryResult) => void }[] = [];
  const query: ImportedResourceQuery = q => new Promise(resolve => calls.push({ query: q, resolve }));
  return { calls, query };
}

const flush = () => new Promise<void>(resolve => queueMicrotask(resolve));

describe('createImportedResourceSubscription', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function subscribe(query: ImportedResourceQuery) {
    return createImportedResourceSubscription({
      coverage: { end: 100_000, start: 0 },
      interpolation: 'linear',
      key: 'r',
      numeric: true,
      query,
      resourceType: { name: 'r', schema: { type: 'real' } },
      target: { planSourceId: 1 },
    });
  }

  it('draws the overview, then refines once the viewport settles, without a request per change', async () => {
    const { calls, query } = controlledQuery();
    const sub = subscribe(query);
    expect(calls).toHaveLength(1); // the overview
    calls[0].resolve(result([0, 50_000_000], [0, 5]));
    await flush();
    expect(get(sub.store).resource?.values.map(v => v.y)).toEqual([0, 5]);

    for (let i = 0; i < 10; i++) {
      sub.setViewport!({ end: 20_000 + i, pixels: 500, start: 10_000 + i });
    }
    expect(calls).toHaveLength(1);
    vi.advanceTimersByTime(SETTLE_MS);
    expect(calls).toHaveLength(2);
    expect(calls[1].query.pointBudget).toBeLessThanOrEqual(8000);
    sub.unsubscribe();
  });

  it('a stale response never replaces the newer viewport', async () => {
    const { calls, query } = controlledQuery();
    const sub = subscribe(query);
    calls[0].resolve(result([], []));
    await flush();

    sub.setViewport!({ end: 20_000, pixels: 500, start: 10_000 }); // A
    vi.advanceTimersByTime(SETTLE_MS);
    sub.setViewport!({ end: 80_000, pixels: 500, start: 70_000 }); // B
    vi.advanceTimersByTime(SETTLE_MS);
    const [, a, b] = calls;

    b.resolve(result([75_000_000], [2]));
    await flush();
    a.resolve(result([15_000_000], [1]));
    await flush();
    expect(get(sub.store).resource?.values.map(v => v.y)).toEqual([2]);

    // A's data is still kept: going back to A's viewport needs no request.
    sub.setViewport!({ end: 20_000, pixels: 500, start: 10_000 });
    vi.advanceTimersByTime(SETTLE_MS);
    expect(calls).toHaveLength(3);
    expect(get(sub.store).resource?.values.map(v => v.y)).toEqual([1]);
    sub.unsubscribe();
  });

  it('keeps drawing held data while a finer window loads', async () => {
    const { calls, query } = controlledQuery();
    const sub = subscribe(query);
    calls[0].resolve(result([0, 50_000_000], [0, 5]));
    await flush();
    sub.setViewport!({ end: 20_000, pixels: 500, start: 10_000 });
    vi.advanceTimersByTime(SETTLE_MS);
    expect(get(sub.store).resource?.values).toHaveLength(2);
    expect(get(sub.store).loading).toBe(false);
    sub.unsubscribe();
  });
});

describe('sample provenance by target', () => {
  it('a plan source and an analysis revision mark the same samples, and only from complete raw responses', async () => {
    const marked = async (
      target: { planSourceId: number } | { revisionId: number },
      extra: Partial<SourceQueryResult>,
    ) => {
      const sub = createImportedResourceSubscription({
        coverage: { end: 100_000, start: 0 },
        interpolation: 'linear',
        key: 'r',
        numeric: true,
        query: async () => result([0, 50_000_000], [0, 5], extra),
        resourceType: { name: 'r', schema: { type: 'real' } },
        target,
      });
      await flush();
      await flush();
      const values = get(sub.store).resource?.values.map(v => v.is_sample === true);
      sub.unsubscribe();
      return values;
    };
    const rawComplete = { approximate: false, representation: 'raw' as const };
    expect(await marked({ planSourceId: 1 }, rawComplete)).toEqual([true, true]);
    expect(await marked({ revisionId: 1 }, rawComplete)).toEqual([true, true]);
    expect(await marked({ planSourceId: 1 }, {})).toEqual([false, false]);
    expect(await marked({ revisionId: 1 }, {})).toEqual([false, false]);
  });
});

describe('getSourceQuery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    querySourceResources.mockReset();
    querySourceResources.mockImplementation((_id: number, keys: string[]) =>
      Promise.resolve({ results: keys.map(key => ({ ...result([], []), resource: key })) }),
    );
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const user = (token: string): User => ({ activeRole: 'user', token }) as User;
  const window: SourceQuery = { end: 2, fidelity: 'display', pointBudget: 10, start: 1 };

  it('batches a session’s rows together, and never with another session’s', async () => {
    const alice = user('token-a');
    const aliceAsViewer = { ...alice, activeRole: 'viewer' } as User;
    const planSource = { planSourceId: 1 };
    expect(getSourceQuery(planSource, alice)).toBe(getSourceQuery({ planSourceId: 1 }, alice));
    expect(getSourceQuery(planSource, aliceAsViewer)).not.toBe(getSourceQuery(planSource, alice));

    getSourceQuery(planSource, alice)(window, 'a');
    getSourceQuery(planSource, alice)(window, 'b');
    getSourceQuery(planSource, aliceAsViewer)(window, 'c');
    await vi.advanceTimersByTimeAsync(50);
    expect(querySourceResources).toHaveBeenCalledTimes(2);
    expect(querySourceResources).toHaveBeenCalledWith(planSource, ['a', 'b'], window, alice);
    expect(querySourceResources).toHaveBeenCalledWith(planSource, ['c'], window, aliceAsViewer);
  });

  it('keeps a revision read directly apart from a plan source with the same id', async () => {
    const alice = user('token-a');
    expect(getSourceQuery({ revisionId: 1 }, alice)).not.toBe(getSourceQuery({ planSourceId: 1 }, alice));
    getSourceQuery({ revisionId: 1 }, alice)(window, 'a');
    await vi.advanceTimersByTimeAsync(50);
    expect(querySourceResources).toHaveBeenCalledWith({ revisionId: 1 }, ['a'], window, alice);
  });
});
