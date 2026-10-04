import { debounce } from 'lodash-es';
import { derived, get, writable, type Readable, type Writable } from 'svelte/store';
import type {
  Analysis,
  AnalysisActivityRef,
  AnalysisSlim,
  AnalysisSimulationDataset,
  AnalysisSourceBinding,
  AnalysisSourceRevision,
  AnalysisSourceTarget,
} from '../types/analysis';
import type { User } from '../types/app';
import type { TimeRange } from '../types/timeline';
import type { TimelineSourceRegistry } from '../types/timelineSource';
import {
  createAnalysisSources,
  getAnalysisTimeRanges,
  getNextAnalysisSourceId,
  importedActivityToSpan,
  isSameAnalysisSource,
  removeSourceFromTimelines,
  simulationSpanToActivity,
} from '../utilities/analysis';
import effects from '../utilities/effects';
import gql from '../utilities/gql';
import { featurePermissions } from '../utilities/permissions';
import { applyViewDefinitionMigrations } from '../utilities/view';
import {
  createLoadedActivitySubscription,
  getRevisionActivities,
  getSimulationDatasetSpans,
} from './analysisActivities';
import { createImportedResourceSubscription, getSourceQuery } from './importedResource';
import { viewTimeRange } from './plan';
import { createProfileSubscription } from './profile';
import { gqlSubscribable } from './subscribable';
import { initializeView, view } from './views';

/*
 * State of the one Analysis page that is open. The timeline, its editor and the Sources browser read the analysis's
 * sources through the timeline sources context; the view state lives in the shared `view` store, as on a Plan page,
 * so the existing timeline and editor code works on it unchanged.
 */

export const analyses = gqlSubscribable<AnalysisSlim[]>(gql.SUB_ANALYSES, {}, []);

export const analysis: Writable<Analysis | null> = writable(null);
export const analysisSourceBindings: Writable<AnalysisSourceBinding[]> = writable([]);
export const analysisSourceRevisions: Writable<AnalysisSourceRevision[]> = writable([]);
export const analysisSimulationDatasets: Writable<AnalysisSimulationDataset[]> = writable([]);
export const analysisSourcesLoading: Writable<boolean> = writable(false);
/** Span types and counts per simulation dataset id, from its spans. */
export const analysisSimulationTypeCounts: Writable<Record<number, { count: number; name: string }[]>> = writable({});
/** Everything the analysis's sources cover: how far the timeline can zoom out. */
export const analysisMaxTimeRange: Writable<TimeRange> = writable({ end: 0, start: 0 });
export const selectedAnalysisActivity: Writable<AnalysisActivityRef | null> = writable(null);
/** 'conflict': someone else saved the analysis since it was opened; saving stops until it is reloaded. */
export const analysisSaveStatus: Writable<'conflict' | 'error' | 'saved' | 'saving' | 'unsaved'> = writable('saved');

export const analysisTimelineSources: Readable<TimelineSourceRegistry> = derived(
  [
    analysisSourceBindings,
    analysisSourceRevisions,
    analysisSimulationDatasets,
    analysisSimulationTypeCounts,
    analysisSourcesLoading,
  ],
  ([$bindings, $revisions, $datasets, $typeCounts, $loading]) => ({
    loading: $loading,
    sources: createAnalysisSources({
      bindings: $bindings,
      loading: $loading,
      revisions: $revisions,
      simulationDatasets: $datasets,
      simulationTypeCounts: $typeCounts,
      subscribeImportedActivities: (binding, revision, request, { user }) =>
        createLoadedActivitySubscription(() =>
          getRevisionActivities(
            revision.id,
            request.types,
            activity => importedActivityToSpan(binding.id, activity),
            user,
          ),
        ),
      subscribeImportedResource: (_binding, revision, resource, { user }) =>
        createImportedResourceSubscription({
          coverage: {
            end: Date.parse(revision.coverage_end ?? ''),
            start: Date.parse(revision.coverage_start ?? ''),
          },
          interpolation: resource.interpolation,
          key: resource.key,
          numeric: resource.numeric,
          query: getSourceQuery({ revisionId: revision.id }, user),
          resourceType: { name: resource.key, schema: resource.schema },
          target: { revisionId: revision.id },
        }),
      subscribeSimulationActivities: (binding, dataset, { user }) =>
        createLoadedActivitySubscription(async () =>
          (await getSimulationDatasetSpans(dataset, user)).map(span => simulationSpanToActivity(binding.id, span)),
        ),
      subscribeSimulationProfile: (_binding, dataset, name, { user }) =>
        createProfileSubscription(dataset.dataset_id, name, dataset.simulation_start_time ?? '', user),
    }),
  }),
);

let sourceDetailsRequest = 0;

/**
 * Loads what the bound revisions and simulation datasets are, and the time they cover. Resolves to `undefined` when a
 * later call superseded this one.
 */
async function loadSourceDetails(bindings: AnalysisSourceBinding[], user: User | null) {
  // Sources can change again before this finishes: only the latest request may set the stores.
  const request = ++sourceDetailsRequest;
  analysisSourcesLoading.set(true);
  const revisionIds = bindings.flatMap(binding => (binding.kind === 'imported' ? [binding.revisionId] : []));
  const datasetIds = bindings.flatMap(binding => (binding.kind === 'simulation' ? [binding.simulationDatasetId] : []));
  const [revisions, datasets] = await Promise.all([
    effects.getAnalysisSourceRevisions(revisionIds, user),
    effects.getAnalysisSimulationDatasets(datasetIds, user),
  ]);
  if (request !== sourceDetailsRequest) {
    return undefined;
  }
  analysisSourceRevisions.set(revisions);
  analysisSimulationDatasets.set(datasets);
  analysisSourcesLoading.set(false);
  const ranges = getAnalysisTimeRanges(revisions, datasets);
  if (ranges) {
    analysisMaxTimeRange.set(ranges.max);
  }
  // A simulation's activity types are those present in its spans (it has no type catalog of its own).
  datasets.forEach(async dataset => {
    const spans = await getSimulationDatasetSpans(dataset, user);
    if (request !== sourceDetailsRequest) {
      return;
    }
    const counts = new Map<string, number>();
    spans.forEach(span => counts.set(span.type, (counts.get(span.type) ?? 0) + 1));
    analysisSimulationTypeCounts.update(current => ({
      ...current,
      [dataset.id]: [...counts.entries()]
        .map(([name, count]) => ({ count, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }));
  });
  return ranges;
}

export async function openAnalysis(initial: Analysis, user: User | null) {
  const { migratedViewDefinition } = applyViewDefinitionMigrations(initial.definition.view);
  analysis.set(initial);
  analysisSourceBindings.set(initial.definition.sources);
  selectedAnalysisActivity.set(null);
  initializeView({
    created_at: initial.created_at,
    definition: migratedViewDefinition ?? initial.definition.view,
    id: -1,
    name: initial.name,
    owner: initial.owner,
    updated_at: initial.updated_at,
  });
  analysisSaveStatus.set('saved');
  const ranges = await loadSourceDetails(initial.definition.sources, user);
  if (ranges === undefined) {
    return;
  }
  // The time window is not saved: an analysis opens on its sources' range.
  viewTimeRange.set(ranges?.initial ?? { end: Date.now(), start: Date.now() - 864e5 });
}

export function closeAnalysis() {
  saveSoon.cancel();
  sourceDetailsRequest++;
  analysis.set(null);
  analysisSourceBindings.set([]);
  analysisSourceRevisions.set([]);
  analysisSimulationDatasets.set([]);
  analysisSimulationTypeCounts.set({});
  selectedAnalysisActivity.set(null);
  view.set(null);
}

export async function addAnalysisSource(target: AnalysisSourceTarget, user: User | null) {
  const bindings = get(analysisSourceBindings);
  if (bindings.some(binding => isSameAnalysisSource(binding, target))) {
    return;
  }
  const next = [...bindings, { ...target, id: getNextAnalysisSourceId(bindings) }];
  analysisSourceBindings.set(next);
  const ranges = await loadSourceDetails(next, user);
  // The first source decides where the timeline starts.
  if (!bindings.length && ranges) {
    viewTimeRange.set(ranges.initial);
  }
}

/** Removes a source and every layer bound to it; rows that only showed it go too. */
export async function removeAnalysisSource(sourceId: string, user: User | null) {
  const next = get(analysisSourceBindings).filter(binding => binding.id !== sourceId);
  analysisSourceBindings.set(next);
  view.update(current =>
    current
      ? {
          ...current,
          definition: {
            ...current.definition,
            plan: {
              ...current.definition.plan,
              timelines: removeSourceFromTimelines(current.definition.plan.timelines, sourceId),
            },
          },
        }
      : current,
  );
  if (get(selectedAnalysisActivity)?.sourceId === sourceId) {
    selectedAnalysisActivity.set(null);
  }
  await loadSourceDetails(next, user);
}

/* Saving: the analysis saves itself shortly after anything it persists changes. */

let saveUser: User | null = null;

async function save() {
  const current = get(analysis);
  const currentView = get(view);
  if (!current || !currentView || get(analysisSaveStatus) === 'conflict') {
    return;
  }
  analysisSaveStatus.set('saving');
  const definition = {
    sources: get(analysisSourceBindings),
    version: 1 as const,
    view: currentView.definition,
  };
  const updatedAt = await effects.updateAnalysis(current, { definition }, saveUser);
  if (updatedAt === 'conflict') {
    analysisSaveStatus.set('conflict');
  } else if (updatedAt) {
    analysis.set({ ...current, definition, updated_at: updatedAt });
    analysisSaveStatus.set('saved');
  } else {
    analysisSaveStatus.set('error');
  }
}

const saveSoon = debounce(save, 1000);

/**
 * Saves the analysis whenever its sources or view change. Returns the function that stops it. Does nothing for a user
 * who can't update the analysis: their saves could only fail.
 */
export function autosaveAnalysis(user: User | null): () => void {
  const current = get(analysis);
  if (!user || !current || !featurePermissions.analysis.canUpdate(user, current)) {
    return () => {};
  }
  saveUser = user;
  let first = true;
  const unsubscribe = derived([analysisSourceBindings, view], values => values).subscribe(() => {
    if (first) {
      first = false;
      return;
    }
    if (get(analysis) && get(analysisSaveStatus) !== 'conflict') {
      analysisSaveStatus.set('unsaved');
      saveSoon();
    }
  });
  return () => {
    unsubscribe();
    saveSoon.flush();
  };
}

export async function renameAnalysis(name: string, user: User | null) {
  const current = get(analysis);
  if (current && name && name !== current.name) {
    const updatedAt = await effects.updateAnalysis(current, { name }, user);
    if (updatedAt === 'conflict') {
      analysisSaveStatus.set('conflict');
    } else if (updatedAt) {
      analysis.set({ ...current, name, updated_at: updatedAt });
    }
  }
}
