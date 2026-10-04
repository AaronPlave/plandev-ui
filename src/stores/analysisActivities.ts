import { derived, writable } from 'svelte/store';
import type { AnalysisPlanDirective, AnalysisSimulationDataset, AnalysisSourceBinding } from '../types/analysis';
import type { User } from '../types/app';
import type { Span } from '../types/simulation';
import type { GqlSubscribable } from '../types/subscribable';
import type { TimelineActivityState, TimelineActivitySubscription, TimelineSourceId } from '../types/timelineSource';
import { planDirectiveToSpan } from '../utilities/analysis';
import effects from '../utilities/effects';
import gql from '../utilities/gql';
import { gqlSubscribable } from './subscribable';

/** The activities a row shows, loaded whole once. */
export function createLoadedActivitySubscription(load: () => Promise<Span[]>): TimelineActivitySubscription {
  const state = writable<TimelineActivityState>({ error: '', loading: true, spans: [] });
  let disposed = false;
  load()
    .then(spans => !disposed && state.set({ error: '', loading: false, spans }))
    .catch(e => !disposed && state.set({ error: (e as Error).message, loading: false, spans: [] }));
  return {
    store: { subscribe: state.subscribe },
    unsubscribe: () => {
      disposed = true;
    },
  };
}

const planDirectives = new Map<number, GqlSubscribable<AnalysisPlanDirective[]>>();

/**
 * A plan's current directives, live: one subscription per plan, shared by its rows, the Sources browser, the
 * histogram and the inspector. It is only open while something reads it.
 */
export function getPlanDirectives(planId: number): GqlSubscribable<AnalysisPlanDirective[]> {
  let directives = planDirectives.get(planId);
  if (!directives) {
    directives = gqlSubscribable<AnalysisPlanDirective[]>(gql.SUB_ANALYSIS_PLAN_DIRECTIVES, { planId }, []);
    planDirectives.set(planId, directives);
  }
  return directives;
}

/** A row's view of a plan's current directives, as activities of the analysis source that reads the plan. */
export function createPlanActivitySubscription(
  sourceId: TimelineSourceId,
  planId: number,
): TimelineActivitySubscription {
  const directives = getPlanDirectives(planId);
  return {
    store: derived([directives, directives.loading, directives.error], ([$directives, $loading, $error]) => ({
      error: $error,
      loading: $loading,
      spans: ($directives ?? []).map(directive => planDirectiveToSpan(sourceId, directive)),
    })),
    unsubscribe: () => {},
  };
}

const simulationSpans = new WeakMap<User, Map<number, Promise<Span[]>>>();
const revisionActivities = new WeakMap<User, Map<string, Promise<Span[]>>>();

/**
 * Every activity of one imported revision of the given types (all, for null), fetched once per session and shared
 * by the rows asking for the same types. Revisions are immutable, so what was fetched stays right.
 *
 * ponytail: whole loads, no windowing or LOD. Fine at hundreds of thousands of activities; page by time if a
 * revision outgrows what the browser holds.
 */
export function getRevisionActivities(
  revisionId: number,
  types: string[] | null,
  toSpan: (activity: Awaited<ReturnType<typeof effects.getSourceActivities>>[number]) => Span,
  user: User | null,
): Promise<Span[]> {
  if (!user) {
    return Promise.resolve([]);
  }
  const byKey = revisionActivities.get(user) ?? new Map<string, Promise<Span[]>>();
  revisionActivities.set(user, byKey);
  const key = `${revisionId}:${types ? [...types].sort().join(',') : '*'}`;
  let spans = byKey.get(key);
  if (!spans) {
    spans = effects.getSourceActivities(revisionId, types, user).then(activities => activities.map(toSpan));
    spans.catch(() => byKey.delete(key));
    byKey.set(key, spans);
  }
  return spans;
}

/**
 * Every span of one simulation dataset, at absolute times, fetched once per session and shared by every row, the
 * Sources browser and the table. Offsets are from the simulation's own start: the analysis has no plan to use.
 */
export function getSimulationDatasetSpans(
  dataset: { dataset_id: number; id: number; simulation_start_time: string | null },
  user: User | null,
): Promise<Span[]> {
  if (!user || !dataset.simulation_start_time) {
    return Promise.resolve([]);
  }
  const byDataset = simulationSpans.get(user) ?? new Map<number, Promise<Span[]>>();
  simulationSpans.set(user, byDataset);
  let spans = byDataset.get(dataset.id);
  if (!spans) {
    spans = effects.getSpans(dataset.dataset_id, dataset.simulation_start_time, user);
    byDataset.set(dataset.id, spans);
  }
  return spans;
}

const revisionActivityTimes = new WeakMap<User, Map<number, Promise<Pick<Span, 'durationMs' | 'startMs'>[]>>>();

/**
 * When every activity of the bound imported revisions and simulations is, for the timeline's histogram. Fetched once
 * per revision per session. Plans are live and are added from their subscriptions.
 *
 * ponytail: ships each imported activity's times to the browser (~60 MB for 670k). Bin in the database if
 * revisions grow much past that.
 */
export async function getAnalysisActivityTimes(
  bindings: AnalysisSourceBinding[],
  datasets: AnalysisSimulationDataset[],
  user: User | null,
): Promise<Pick<Span, 'durationMs' | 'startMs'>[]> {
  if (!user) {
    return [];
  }
  const byRevision =
    revisionActivityTimes.get(user) ?? new Map<number, Promise<Pick<Span, 'durationMs' | 'startMs'>[]>>();
  revisionActivityTimes.set(user, byRevision);
  const perSource = await Promise.all(
    bindings.map(binding => {
      if (binding.kind === 'simulation') {
        const dataset = datasets.find(({ id }) => id === binding.simulationDatasetId);
        return dataset ? getSimulationDatasetSpans(dataset, user) : [];
      }
      if (binding.kind === 'plan') {
        // Live: the histogram reads a plan's directives from its subscription instead (analysisPlanDirectives).
        return [];
      }
      let times = byRevision.get(binding.revisionId);
      if (!times) {
        times = effects.getSourceActivityTimes(binding.revisionId, user);
        times.catch(() => byRevision.delete(binding.revisionId));
        byRevision.set(binding.revisionId, times);
      }
      return times;
    }),
  );
  return perSource.flat();
}
