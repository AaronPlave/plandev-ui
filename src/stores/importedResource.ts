import { writable } from 'svelte/store';
import type { User } from '../types/app';
import type { ResourceType } from '../types/simulation';
import type { TimelineResourceSubscription, TimelineViewport } from '../types/timelineSource';
import effects from '../utilities/effects';
import {
  composeSeries,
  coversViewport,
  isCompleteRaw,
  planViewportQuery,
  seriesToValues,
  toLoadedWindow,
  toMicros,
  type LoadedWindow,
  type SourceQuery,
  type SourceQueryResult,
  type SourceTarget,
} from '../utilities/importedResource';
import {
  acquireTimelineResource,
  releaseTimelineResource,
  setTimelineResourceState,
  type TimelineResourceState,
} from './timelineResourceStatus';

/** Asks for one resource under one query; requests issued in the same tick share an HTTP request. */
export type ImportedResourceQuery = (query: SourceQuery, key: string) => Promise<SourceQueryResult>;

export type ImportedResourceOptions = {
  /** The revision's coverage, in ms: the overview spans it, and the last sample holds until its end. */
  coverage: { end: number; start: number };
  interpolation: 'linear' | 'constant';
  key: string;
  numeric: boolean;
  query: ImportedResourceQuery;
  resourceType: ResourceType;
  target: SourceTarget;
};

/** Points in the whole-coverage overview that is drawn wherever no finer window is held. */
const OVERVIEW_BUDGET = 2000;
/** How long the viewport must be still before a request is made; during a drag, held data is redrawn. */
export const SETTLE_MS = 150;
/** Finer windows kept per resource, so returning to a recent viewport needs no request. */
const CACHE_SIZE = 8;

/**
 * A live view of one imported resource that follows the timeline viewport. It draws, in order of preference, a
 * held window that covers the viewport finely enough, else the whole-coverage overview while a finer window is
 * fetched. Responses to viewports that have since moved on are discarded, so a slow early request never
 * replaces a newer one.
 */
export function createImportedResourceSubscription(options: ImportedResourceOptions): TimelineResourceSubscription {
  const { coverage, key, query, resourceType, target } = options;
  const [statusId, statusKind] =
    'planSourceId' in target
      ? [target.planSourceId, 'imported' as const]
      : [target.revisionId, 'importedRevision' as const];
  acquireTimelineResource(statusId, key, statusKind);
  const state = writable<TimelineResourceState>({ error: '', loading: true, resource: null });

  let overview: SourceQueryResult | null = null;
  let overviewWindow: LoadedWindow | null = null;
  let detail: LoadedWindow | null = null;
  const cache: LoadedWindow[] = [];
  let error = '';
  let disposed = false;
  let viewport: TimelineViewport | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped per request; only the latest request's response is applied. */
  let latest = 0;

  function emit() {
    if (disposed) {
      return;
    }
    const series = composeSeries(overview, detail?.result ?? null, options.numeric);
    const next: TimelineResourceState = {
      error,
      loading: overview === null && !error,
      resource:
        overview || detail
          ? {
              name: resourceType.name,
              schema: resourceType.schema,
              values: seriesToValues(series, {
                holdUntil: coverage.end,
                interpolation: options.interpolation,
                numeric: options.numeric,
              }),
            }
          : null,
    };
    state.set(next);
    setTimelineResourceState(statusId, key, statusKind, next);
  }

  async function fetchViewport() {
    timer = null;
    if (!viewport || disposed) {
      return;
    }
    // The overview may have arrived since the viewport changed, and may be all this viewport needs.
    if (useHeld(viewport)) {
      return;
    }
    const planned = planViewportQuery(viewport, viewport.pixels);
    const id = ++latest;
    try {
      const result = await query(planned, key);
      if (disposed) {
        return;
      }
      if (!result.error) {
        cache.unshift(toLoadedWindow(planned, result));
        cache.length = Math.min(cache.length, CACHE_SIZE);
      }
      if (id !== latest) {
        return; // stale: the viewport moved on while this was in flight; keep it cached, but do not draw it
      }
      error = result.error ?? '';
      if (!result.error) {
        detail = cache[0];
      }
    } catch (e) {
      if (disposed || id !== latest) {
        return;
      }
      error = (e as Error).message || 'Imported resource query failed';
    }
    emit();
  }

  /** Draws a held window that serves `next`, if there is one. */
  function useHeld(next: TimelineViewport): boolean {
    const held =
      cache.find(window => coversViewport(window, next, next.pixels)) ??
      (overviewWindow && coversViewport(overviewWindow, next, next.pixels) ? overviewWindow : null);
    if (!held) {
      return false;
    }
    latest++; // a request still in flight is for a viewport we no longer show
    if (held !== detail) {
      detail = held;
      emit();
    }
    return true;
  }

  function setViewport(next: TimelineViewport) {
    if (disposed || next.end <= next.start || next.pixels <= 0) {
      return;
    }
    if (viewport && viewport.start === next.start && viewport.end === next.end && viewport.pixels === next.pixels) {
      return;
    }
    viewport = next;
    if (useHeld(next)) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      return;
    }
    // Keep drawing what is held; ask for better once the viewport settles.
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(fetchViewport, SETTLE_MS);
  }

  // The overview is fetched once and never replaced: it is what keeps a row drawn anywhere in the coverage.
  (async () => {
    try {
      const result = await query(
        {
          end: toMicros(coverage.end) + 1,
          fidelity: 'display',
          pointBudget: OVERVIEW_BUDGET,
          start: toMicros(coverage.start),
        },
        key,
      );
      if (disposed) {
        return;
      }
      if (result.error) {
        error = result.error;
      } else {
        overview = result;
        // Nothing exists outside the coverage, so the overview serves any viewport its resolution suffices for.
        overviewWindow = {
          complete: isCompleteRaw(result),
          end: Infinity,
          resolution: (coverage.end - coverage.start) / OVERVIEW_BUDGET,
          result,
          start: -Infinity,
        };
      }
    } catch (e) {
      if (disposed) {
        return;
      }
      error = (e as Error).message || 'Imported resource query failed';
    }
    emit();
  })();

  emit();

  return {
    setViewport,
    store: { subscribe: state.subscribe },
    unsubscribe: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      if (timer) {
        clearTimeout(timer);
      }
      releaseTimelineResource(statusId, key, statusKind);
    },
  };
}

/** Resources per HTTP request; the gateway accepts up to 200. */
const BATCH_LIMIT = 100;
/** Rows settle on a viewport within a few ms of each other (each has its own settle timer); wait for all of them. */
const BATCH_WINDOW_MS = 10;

/**
 * A query function for one revision (or plan source) that coalesces the requests made within BATCH_WINDOW_MS with the
 * same window and budget into one gateway request: every row in a view settles on the same viewport at once.
 */
export function createBatchedSourceQuery(target: SourceTarget, user: User | null): ImportedResourceQuery {
  type Pending = { key: string; reject: (e: Error) => void; resolve: (r: SourceQueryResult) => void };
  const groups = new Map<string, { pending: Pending[]; query: SourceQuery }>();
  let scheduled = false;

  function flush() {
    scheduled = false;
    const batches = [...groups.values()];
    groups.clear();
    batches.forEach(({ pending, query }) => {
      for (let i = 0; i < pending.length; i += BATCH_LIMIT) {
        const slice = pending.slice(i, i + BATCH_LIMIT);
        const keys = [...new Set(slice.map(p => p.key))];
        effects
          .querySourceResources(target, keys, query, user)
          .then(response => {
            const byKey = new Map(response.results.map(r => [r.resource, r]));
            slice.forEach(p => {
              const r = byKey.get(p.key);
              if (r) {
                p.resolve(r);
              } else {
                p.reject(new Error(`No result for ${p.key}`));
              }
            });
          })
          .catch((e: Error) => slice.forEach(p => p.reject(e)));
      }
    });
  }

  return (query, key) =>
    new Promise((resolve, reject) => {
      const groupKey = `${query.start}|${query.end}|${query.pointBudget}|${query.fidelity}`;
      const group = groups.get(groupKey) ?? { pending: [], query };
      group.pending.push({ key, reject, resolve });
      groups.set(groupKey, group);
      if (!scheduled) {
        scheduled = true;
        setTimeout(flush, BATCH_WINDOW_MS);
      }
    });
}

const sourceQueries = new WeakMap<User, Map<string, ImportedResourceQuery>>();
/**
 * The batching query function for one revision (or plan source) and session, shared so every row's requests for a
 * viewport share a request. Held per user object, which is replaced on login and on role change: a new session never
 * joins a batch of the old one, and the old session's functions, and its token, are collected with it.
 */
export function getSourceQuery(target: SourceTarget, user: User | null): ImportedResourceQuery {
  if (!user) {
    return createBatchedSourceQuery(target, null);
  }
  const byTarget = sourceQueries.get(user) ?? new Map<string, ImportedResourceQuery>();
  sourceQueries.set(user, byTarget);
  const key = 'planSourceId' in target ? `plan-source:${target.planSourceId}` : `revision:${target.revisionId}`;
  let query = byTarget.get(key);
  if (!query) {
    query = createBatchedSourceQuery(target, user);
    byTarget.set(key, query);
  }
  return query;
}
