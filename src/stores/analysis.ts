import { debounce, isEqual } from 'lodash-es';
import { SearchParameters } from '../enums/searchParameters';
import { derived, get, writable, type Readable, type Writable } from 'svelte/store';
import type {
  Analysis,
  AnalysisActivityRef,
  AnalysisPlan,
  AnalysisPlanDirective,
  AnalysisSlim,
  AnalysisSimulationDataset,
  AnalysisSourceBinding,
  AnalysisSourceRevision,
  AnalysisSourceTarget,
  SourceRecovery,
} from '../types/analysis';
import type { User, UserId } from '../types/app';
import type { Row, TimeRange, Timeline } from '../types/timeline';
import type { TimelineSourceRegistry } from '../types/timelineSource';
import {
  bindViewToAnalysisSources,
  createAnalysisDefinition,
  createAnalysisSources,
  createSourceActivityRow,
  findActivityTypeRow,
  findAnalysisToReopen,
  getAnalysisTimeRanges,
  getImportOutcome,
  getNextAnalysisSourceId,
  importedActivityToSpan,
  INITIAL_ACTIVITY_ROW_LIMIT,
  isSameAnalysisSource,
  removeSourceFromTimelines,
  simulationSpanToActivity,
  withSourceIdentity,
} from '../utilities/analysis';
import type { WatchedResource } from '../utilities/analysisAtTime';
import { getImportedPlanSourceIds, type ViewImportPlanSource } from '../utilities/analysisViewImport';
import effects from '../utilities/effects';
import gql from '../utilities/gql';
import { featurePermissions } from '../utilities/permissions';
import { showFailureToast, showSuccessToast } from '../utilities/toast';
import { getSource, toIntervalType } from '../utilities/timelineSources';
import { applyViewDefinitionMigrations } from '../utilities/view';
import {
  createLoadedActivitySubscription,
  createPlanActivitySubscription,
  getPlanDirectives,
  getRevisionActivities,
  getSimulationDatasetSpans,
} from './analysisActivities';
import { createImportedResourceSubscription, getSourceQuery } from './importedResource';
import { timeCursorCompareMs, timeCursorMs, viewTimeRange } from './plan';
import { createProfileSubscription } from './profile';
import { gqlSubscribable } from './subscribable';
import { sources } from './sources';
import { planSources } from './timelineSources';
import {
  initializeView,
  selectedLayerId,
  selectedSectionId,
  view,
  viewAddFilterToRow,
  viewSetSelectedRow,
  viewUpdateTimeline,
} from './views';

/*
 * State of the one Analysis page that is open. The timeline, its editor and the Sources browser read the analysis's
 * sources through the timeline sources context; the view state lives in the shared `view` store, as on a Plan page,
 * so the existing timeline and editor code works on it unchanged.
 */

export const analyses = gqlSubscribable<AnalysisSlim[]>(gql.SUB_ANALYSES, {}, []);

export const analysis: Writable<Analysis | null> = writable(null);
export const analysisSourceBindings: Writable<AnalysisSourceBinding[]> = writable([]);
export const analysisSourceRevisions: Writable<AnalysisSourceRevision[]> = writable([]);
/** What is left of each source (by id) whose bound revision was deleted; null when the source is gone too. */
export const analysisSourceRecovery: Writable<Record<number, SourceRecovery | null>> = writable({});
export const analysisSimulationDatasets: Writable<AnalysisSimulationDataset[]> = writable([]);
export const analysisSourcesLoading: Writable<boolean> = writable(false);
/** Span types and counts per simulation dataset id, from its spans. */
export const analysisSimulationTypeCounts: Writable<Record<number, { count: number; name: string }[]>> = writable({});
/** Everything the analysis's sources cover: how far the timeline can zoom out. */
export const analysisMaxTimeRange: Writable<TimeRange> = writable({ end: 0, start: 0 });
export const selectedAnalysisActivity: Writable<AnalysisActivityRef | null> = writable(null);
/**
 * Resources the At Time inspector was asked to watch, each of one source (by the analysis's own binding id) and its
 * name: the same name in two sources is two entries. Page state, not saved with the analysis; it lives here because the
 * inspector's tab unmounts when another tab is shown. Entries of a source that is removed or pointed at other data are
 * dropped, never redirected.
 */
export const analysisWatchedResources: Writable<WatchedResource[]> = writable([]);
/** 'conflict': someone else saved the analysis since it was opened; saving stops until it is reloaded. */
export const analysisSaveStatus: Writable<'conflict' | 'error' | 'saved' | 'saving' | 'unsaved'> = writable('saved');

/** The plans whose current activities the analysis reads. Changes only when that set does. */
export const analysisPlanIds: Readable<number[]> = (() => {
  let current: number[] = [];
  return derived(
    analysisSourceBindings,
    ($bindings, set) => {
      const ids = [...new Set($bindings.flatMap(binding => (binding.kind === 'plan' ? [binding.planId] : [])))];
      if (!isEqual(ids, current)) {
        current = ids;
        set(ids);
      }
    },
    current,
  );
})();

/** The bound plans, live: their names and revisions follow the plans. */
export const analysisPlans = gqlSubscribable<AnalysisPlan[]>(gql.SUB_ANALYSIS_PLANS, { planIds: analysisPlanIds }, []);

/** Each bound plan's current directives, live, by plan id. */
export const analysisPlanDirectives: Readable<Record<number, AnalysisPlanDirective[]>> = derived(
  analysisPlanIds,
  ($planIds, set) => {
    const byPlan: Record<number, AnalysisPlanDirective[]> = {};
    set(byPlan);
    const unsubscribers = $planIds.map(planId =>
      getPlanDirectives(planId).subscribe(directives => {
        byPlan[planId] = directives ?? [];
        set({ ...byPlan });
      }),
    );
    return () => unsubscribers.forEach(unsubscribe => unsubscribe());
  },
  {},
);

export const analysisTimelineSources: Readable<TimelineSourceRegistry> = derived(
  [
    analysisSourceBindings,
    analysisSourceRevisions,
    analysisSimulationDatasets,
    analysisSimulationTypeCounts,
    analysisSourceRecovery,
    analysisSourcesLoading,
    analysisPlans,
    analysisPlans.loading,
    analysisPlanDirectives,
  ],
  ([$bindings, $revisions, $datasets, $typeCounts, $recovery, $loading, $plans, $plansLoading, $planDirectives]) => ({
    loading: $loading,
    sources: createAnalysisSources({
      bindings: $bindings,
      loading: $loading,
      planTypeCounts: Object.fromEntries(
        Object.entries($planDirectives).map(([planId, directives]) => [planId, countTypes(directives)]),
      ),
      plans: $plans ?? [],
      plansLoading: $plansLoading,
      revisions: $revisions,
      simulationDatasets: $datasets,
      simulationTypeCounts: $typeCounts,
      sourceRecovery: $recovery,
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
      subscribePlanActivities: (binding, plan) => createPlanActivitySubscription(binding.id, plan.id),
      subscribeSimulationActivities: (binding, dataset, { user }) =>
        createLoadedActivitySubscription(async () =>
          (await getSimulationDatasetSpans(dataset, user)).map(span => simulationSpanToActivity(binding.id, span)),
        ),
      subscribeSimulationProfile: (_binding, dataset, name, { user }) =>
        createProfileSubscription(dataset.dataset_id, name, dataset.simulation_start_time ?? '', user),
    }),
  }),
);

/** Each type present among `activities`, with how many there are, by name. */
function countTypes(activities: { type: string }[]): { count: number; name: string }[] {
  const counts = new Map<string, number>();
  activities.forEach(activity => counts.set(activity.type, (counts.get(activity.type) ?? 0) + 1));
  return [...counts.entries()].map(([name, count]) => ({ count, name })).sort((a, b) => a.name.localeCompare(b.name));
}

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
  const planIds = bindings.flatMap(binding => (binding.kind === 'plan' ? [binding.planId] : []));
  // Plans are subscribed to (analysisPlans); this read is only for the time they cover.
  const [revisionsRead, datasets, plans] = await Promise.all([
    effects.getAnalysisSourceRevisions(revisionIds, user),
    effects.getAnalysisSimulationDatasets(datasetIds, user),
    effects.getAnalysisPlans(planIds, user),
  ]);
  if (request !== sourceDetailsRequest) {
    return undefined;
  }
  // A failed read says nothing about deletion: keep what was known, and offer no recovery for revisions not read.
  const revisions = revisionsRead ?? get(analysisSourceRevisions);
  // A revision missing from a successful read is deleted; what is left of its source decides what can be offered.
  const lostSourceIds = [
    ...new Set(
      (revisionsRead ? bindings : []).flatMap(binding =>
        binding.kind === 'imported' &&
        binding.sourceId !== undefined &&
        !revisions.some(revision => revision.id === binding.revisionId)
          ? [binding.sourceId]
          : [],
      ),
    ),
  ];
  const recovery = await effects.getAnalysisSourceRecovery(lostSourceIds, user);
  if (request !== sourceDetailsRequest) {
    return undefined;
  }
  if (revisionsRead) {
    analysisSourceRecovery.set(recovery);
  }
  // Bindings saved before they recorded their source gain it here (saved with the analysis's next save).
  const identified = withSourceIdentity(get(analysisSourceBindings), revisions);
  if (identified !== get(analysisSourceBindings)) {
    analysisSourceBindings.set(identified);
  }
  analysisSourceRevisions.set(revisions);
  analysisSimulationDatasets.set(datasets);
  analysisSourcesLoading.set(false);
  // A revision still importing (one just imported from here) becomes usable without a reload.
  // ponytail: polls every 5 s while any bound revision is importing; a revision status subscription if this grows.
  if (revisions.some(revision => revision.status === 'pending' || revision.status === 'incomplete')) {
    setTimeout(() => request === sourceDetailsRequest && loadSourceDetails(get(analysisSourceBindings), user), 5000);
  }
  const ranges = getAnalysisTimeRanges(revisions, datasets, plans);
  if (ranges) {
    analysisMaxTimeRange.set(ranges.max);
  }
  // A simulation's activity types are those present in its spans (it has no type catalog of its own).
  datasets.forEach(async dataset => {
    const spans = await getSimulationDatasetSpans(dataset, user);
    if (request !== sourceDetailsRequest) {
      return;
    }
    analysisSimulationTypeCounts.update(current => ({ ...current, [dataset.id]: countTypes(spans) }));
  });
  return ranges;
}

export async function openAnalysis(initial: Analysis, user: User | null) {
  clearAnalysisImports();
  const { migratedViewDefinition } = applyViewDefinitionMigrations(initial.definition.view);
  analysis.set(initial);
  analysisSourceBindings.set(initial.definition.sources);
  selectedAnalysisActivity.set(null);
  analysisWatchedResources.set([]);
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
  // The time window is not saved: an analysis opens on its sources' range, or, with none yet, the last day.
  const lastDay = { end: Date.now(), start: Date.now() - 864e5 };
  if (!ranges) {
    analysisMaxTimeRange.set(lastDay);
  }
  viewTimeRange.set(ranges?.initial ?? lastDay);
}

export function closeAnalysis() {
  saveSoon.cancel();
  sourceDetailsRequest++;
  analysis.set(null);
  analysisSourceBindings.set([]);
  analysisSourceRevisions.set([]);
  analysisSourceRecovery.set({});
  analysisSimulationDatasets.set([]);
  analysisSimulationTypeCounts.set({});
  selectedAnalysisActivity.set(null);
  analysisWatchedResources.set([]);
  clearAnalysisImports();
  // The time cursors are page state of whichever page is open.
  timeCursorCompareMs.set(null);
  timeCursorMs.set(null);
  view.set(null);
}

/** Adds a source unless the analysis already has it. Returns whether it was added. */
export async function addAnalysisSource(target: AnalysisSourceTarget, user: User | null): Promise<boolean> {
  const bindings = get(analysisSourceBindings);
  if (bindings.some(binding => isSameAnalysisSource(binding, target))) {
    return false;
  }
  const next = [...bindings, { ...target, id: getNextAnalysisSourceId(bindings) }];
  analysisSourceBindings.set(next);
  const ranges = await loadSourceDetails(next, user);
  // The first source decides where the timeline starts.
  if (!bindings.length && ranges) {
    viewTimeRange.set(ranges.initial);
  }
  return true;
}

/*
 * Imports started from Add Source with "Add it to this analysis". The analysis adds the revision once it has
 * succeeded (a revision still importing can't be read, as the ordinary source list also doesn't allow), and says
 * so if it fails. The intent belongs to the analysis that was open: it is dropped when another opens or this closes.
 */

export type PendingAnalysisImport = {
  adapter: string;
  error?: string;
  /** Kept so a failed import can be tried again. */
  file: File;
  /** The source's owner, which decides whether the user may import into it again. */
  owner: UserId | null;
  revisionId: number;
  /** The Sources library has listed the revision; one listed and then gone was deleted. */
  seen?: boolean;
  sourceId: number;
  status: 'failed' | 'importing';
};

export const pendingAnalysisImports: Writable<PendingAnalysisImport[]> = writable([]);

let stopWatchingImports: (() => void) | null = null;
let importUser: User | null = null;

/** Follows the Sources library (which updates as imports finish) while any import is waiting to be added. */
function watchImports() {
  if (stopWatchingImports) {
    return;
  }
  stopWatchingImports = derived([sources, sources.loading], values => values).subscribe(([library, loading]) => {
    if (!loading) {
      settleImports(library ?? []);
    }
  });
  // The first report can settle everything before `subscribe` returns, when there was nothing yet to stop.
  if (!get(pendingAnalysisImports).some(({ status }) => status === 'importing')) {
    stopWatching();
  }
}

function stopWatching() {
  stopWatchingImports?.();
  stopWatchingImports = null;
}

function settleImports(library: Parameters<typeof getImportOutcome>[0]) {
  get(pendingAnalysisImports)
    .filter(({ status }) => status === 'importing')
    .forEach(async imported => {
      const outcome = getImportOutcome(library, imported);
      if (outcome.state === 'importing') {
        if (outcome.present && !imported.seen) {
          pendingAnalysisImports.update(all =>
            all.map(other => (other.revisionId === imported.revisionId ? { ...other, seen: true } : other)),
          );
        }
        return;
      }
      // Settled once: the library may report again before this resolves.
      if (
        !get(pendingAnalysisImports).some(
          ({ revisionId, status }) => revisionId === imported.revisionId && status === 'importing',
        )
      ) {
        return;
      }
      if (outcome.state === 'failed') {
        pendingAnalysisImports.update(all =>
          all.map(other =>
            other.revisionId === imported.revisionId ? { ...other, error: outcome.message, status: 'failed' } : other,
          ),
        );
        showFailureToast(`Import of ${imported.file.name} failed: ${outcome.message} Reopen Add Source to retry.`);
      } else {
        dismissAnalysisImport(imported.revisionId);
        const added = await addAnalysisSource(
          {
            kind: 'imported',
            revisionId: imported.revisionId,
            sourceId: imported.sourceId,
            sourceName: outcome.sourceName,
          },
          importUser,
        );
        // Not added when the person added it themselves in the meantime.
        if (added) {
          showSuccessToast(`Added ${outcome.sourceName} to this analysis`);
        }
      }
    });
  if (!get(pendingAnalysisImports).some(({ status }) => status === 'importing')) {
    stopWatching();
  }
}

/** Adds the revision to the analysis once its import succeeds. */
export function addAnalysisSourceWhenImported(
  imported: { adapter: string; file: File; owner: UserId | null; revisionId: number; sourceId: number },
  user: User | null,
) {
  importUser = user;
  pendingAnalysisImports.update(all => [...all, { ...imported, status: 'importing' }]);
  watchImports();
}

export function dismissAnalysisImport(revisionId: number) {
  pendingAnalysisImports.update(all => all.filter(imported => imported.revisionId !== revisionId));
  if (!get(pendingAnalysisImports).some(({ status }) => status === 'importing')) {
    stopWatching();
  }
}

/** Imports the file again as a new revision of the same source, still to be added when it succeeds. */
export async function retryAnalysisImport(failed: PendingAnalysisImport, user: User | null) {
  const result = await effects.importSourceRevision(
    failed.file,
    { owner: failed.owner, sourceId: failed.sourceId },
    failed.adapter,
    user,
  );
  if (result) {
    dismissAnalysisImport(failed.revisionId);
    addAnalysisSourceWhenImported({ ...failed, ...result }, user);
  }
}

function clearAnalysisImports() {
  stopWatching();
  pendingAnalysisImports.set([]);
}

/**
 * Points a source at other data (a newer revision of the same source), keeping its id: every row and layer bound to
 * it now shows the new data.
 */
export async function rebindAnalysisSource(sourceId: string, target: AnalysisSourceTarget, user: User | null) {
  analysisSourceBindings.update(bindings =>
    bindings.map(binding => (binding.id === sourceId ? { ...target, id: binding.id, label: binding.label } : binding)),
  );
  if (get(selectedAnalysisActivity)?.sourceId === sourceId) {
    selectedAnalysisActivity.set(null);
  }
  // Layers follow the source to its new data; a watched resource was chosen from the old data, so it is dropped.
  dropWatchedResources(sourceId);
  await loadSourceDetails(get(analysisSourceBindings), user);
}

function dropWatchedResources(sourceId: string) {
  analysisWatchedResources.update(watched => watched.filter(resource => resource.sourceId !== sourceId));
}

/** The analysis's own name for a source (an alias); empty to go back to the source's name. */
export function setAnalysisSourceLabel(sourceId: string, label: string) {
  analysisSourceBindings.update(bindings =>
    // An undefined label is dropped when the definition is saved as JSON.
    bindings.map(binding => (binding.id === sourceId ? { ...binding, label: label.trim() || undefined } : binding)),
  );
}

/**
 * Adds a row of one source's activities of `type`, unless a row already draws them, and selects that row so the result
 * is visible either way. Only the source and the type are promoted: nothing else the activity table filters on goes
 * into the layer. Returns whether a row was added, and the row that shows the type.
 */
export function showAnalysisActivityType(sourceId: string, type: string): { added: boolean; row: Row | undefined } {
  const timelines = () => get(view)?.definition.plan.timelines ?? [];
  const sourceLabel = getSource(get(analysisTimelineSources), sourceId)?.label ?? sourceId;
  const existing = findActivityTypeRow(timelines(), sourceId, type);
  if (!existing) {
    viewAddFilterToRow([toIntervalType(type)], 'activity', { sourceId, sourceLabel });
  }
  const row = existing ?? findActivityTypeRow(timelines(), sourceId, type);
  if (row) {
    viewSetSelectedRow(row.id);
    showSuccessToast(
      existing
        ? `${type} from ${sourceLabel} is already on the timeline (row "${row.name}")`
        : `Added ${type} from ${sourceLabel} to the timeline`,
    );
  }
  return { added: !existing, row };
}

/** Adds a row of every activity of one source (see createSourceActivityRow). */
export function addSourceActivityRow(sourceId: string, name: string) {
  const timeline = get(view)?.definition.plan.timelines[0];
  if (timeline) {
    const timelines = get(view)?.definition.plan.timelines ?? [];
    viewUpdateTimeline('rows', [...timeline.rows, createSourceActivityRow(timelines, sourceId, name)], timeline.id);
  }
}

/** A saved view as far as loading its timeline goes: read, never changed. */
export type ViewForTimelineImport = {
  id: number;
  name: string;
  /** Every plan_source the view's layers name that still exists. */
  planSources: ViewImportPlanSource[];
  timelines: Timeline[];
};

/**
 * Reads a saved view for loading its timeline into an analysis, at the current view version. Unlike opening it on a
 * Plan page, this migrates in memory only: a view the user can merely read is never written to. Null (reported) when
 * it can't be read.
 */
export async function readViewForTimelineImport(
  viewId: number,
  user: User | null,
): Promise<ViewForTimelineImport | null> {
  // getView falls back to a default view for an id it can't find; that is not what was asked for.
  const saved = await effects.getView(new URLSearchParams(`?${SearchParameters.VIEW_ID}=${viewId}`), user, false);
  if (!saved || saved.id !== viewId) {
    showFailureToast('The View Could Not Be Read');
    return null;
  }
  const { error, migratedViewDefinition } = applyViewDefinitionMigrations(saved.definition);
  if (error) {
    showFailureToast(`Unable To Read View "${saved.name}"`);
    return null;
  }
  const timelines = (migratedViewDefinition ?? saved.definition).plan.timelines;
  const planSources = await effects.getPlanSourcesForImport(
    [...new Set(timelines.flatMap(getImportedPlanSourceIds))],
    user,
  );
  if (!planSources) {
    showFailureToast('Unable To Read The Sources This View Uses');
    return null;
  }
  return { id: saved.id, name: saved.name, planSources, timelines };
}

/**
 * Replaces the analysis's timeline with `timeline` (see importViewTimeline). Its sources, name, owner and everything
 * else in the view are untouched, and, like any edit, it is saved by the autosave. Not offered when the user can't
 * edit the analysis. Returns whether it replaced.
 */
export function replaceAnalysisTimeline(timeline: Timeline, user: User | null): boolean {
  const current = get(analysis);
  if (!current || !featurePermissions.analysis.canUpdate(user, current)) {
    return false;
  }
  // Nothing mapped to this analysis's sources: replacing the timeline would only empty it.
  if (!timeline.rows.some(row => row.layers.length)) {
    showFailureToast('Nothing In The View Maps To This Analysis, So The Timeline Was Not Replaced');
    return false;
  }
  view.update(currentView =>
    currentView
      ? {
          ...currentView,
          definition: {
            ...currentView.definition,
            plan: { ...currentView.definition.plan, timelines: [timeline] },
          },
        }
      : currentView,
  );
  // Selections named rows and layers of the old timeline.
  viewSetSelectedRow(null);
  selectedSectionId.set(null);
  selectedLayerId.set(null);
  return true;
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
  dropWatchedResources(sourceId);
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

/**
 * Opens the analysis Analyze should return to, or makes `create` run. Returns the analysis's id, or null when the
 * lookup or the creation failed (each reports itself).
 */
async function reopenOrCreate(
  wanted: AnalysisSourceTarget[],
  fresh: boolean,
  user: User | null,
  create: () => Promise<number | null>,
): Promise<number | null> {
  if (!fresh) {
    const analyses = await effects.getAnalysisSourceUsage(user);
    if (analyses === null) {
      return null;
    }
    const existing = findAnalysisToReopen(analyses, wanted, {
      canCreate: featurePermissions.analysis.canCreate(user),
      userId: user?.id,
    });
    if (existing) {
      return existing.id;
    }
  }
  return create();
}

/**
 * "Analyze" on a plan, with the simulation the user is looking at (`simulationDatasetId`) if any: the user's most
 * recently updated analysis of that plan, and that simulation if given (see `findAnalysisToReopen`), else a new one.
 * `fresh` ("New analysis") always makes a new one. Returns the analysis's id.
 */
export async function analyzePlan(
  plan: { id: number; name: string },
  simulationDatasetId: number | null,
  user: User | null,
  { fresh = false }: { fresh?: boolean } = {},
): Promise<number | null> {
  const wanted: AnalysisSourceTarget[] = [{ kind: 'plan', planId: plan.id }];
  if (simulationDatasetId !== null) {
    wanted.push({ kind: 'simulation', simulationDatasetId });
  }
  return reopenOrCreate(wanted, fresh, user, () => createPlanAnalysis(plan, simulationDatasetId, user));
}

/**
 * "Analyze" on a successful imported revision: the user's most recently updated analysis that binds exactly that
 * revision, else a new single-source analysis. `fresh` always makes a new one. Pending and failed revisions can't be
 * analyzed. Returns the analysis's id.
 */
export async function analyzeRevision(
  source: { id: number; name: string },
  revision: { activityCount: number; id: number; status: string },
  user: User | null,
  { fresh = false }: { fresh?: boolean } = {},
): Promise<number | null> {
  if (revision.status !== 'success') {
    return null;
  }
  const target: AnalysisSourceTarget = {
    kind: 'imported',
    revisionId: revision.id,
    sourceId: source.id,
    sourceName: source.name,
  };
  return reopenOrCreate([target], fresh, user, () =>
    createRevisionAnalysis(source.name, target, revision.activityCount, user),
  );
}

/**
 * A new analysis of one imported revision, useful when it opens: it opens on the revision's coverage (every analysis
 * does, from its sources) and, unless there are too many to load at once, has a row of its activities. Its resources
 * are in the Sources browser.
 */
export async function createRevisionAnalysis(
  sourceName: string,
  target: Extract<AnalysisSourceTarget, { kind: 'imported' }>,
  activityCount: number,
  user: User | null,
): Promise<number | null> {
  const definition = createAnalysisDefinition();
  const sources: AnalysisSourceBinding[] = [{ ...target, id: 'source-1' }];
  if (activityCount > 0 && activityCount <= INITIAL_ACTIVITY_ROW_LIMIT) {
    const [timeline] = definition.view.plan.timelines;
    timeline.rows = [createSourceActivityRow(definition.view.plan.timelines, 'source-1', 'Activities')];
  }
  return effects.createAnalysis(`${sourceName} analysis`, { ...definition, sources }, user);
}

/**
 * A new analysis of the plan's current activities and, when given, one of its simulations, with a row for each (or
 * the plan's own view, rebound). Returns the new analysis's id.
 */
export async function createPlanAnalysis(
  plan: { id: number; name: string },
  simulationDatasetId: number | null,
  user: User | null,
): Promise<number | null> {
  const definition = createAnalysisDefinition();
  const sources: AnalysisSourceBinding[] = [{ id: 'source-1', kind: 'plan', planId: plan.id }];
  if (simulationDatasetId !== null) {
    sources.push({ id: 'source-2', kind: 'simulation', simulationDatasetId });
  }
  const planTimelines = get(view)?.definition.plan.timelines ?? [];
  if (planTimelines.some(timeline => timeline.rows.length)) {
    // The plan's own view, rebound to the analysis's sources.
    const bound = bindViewToAnalysisSources(
      planTimelines,
      get(planSources),
      sources,
      'source-1',
      simulationDatasetId !== null ? 'source-2' : null,
    );
    definition.view.plan.timelines = bound.timelines;
    sources.splice(0, sources.length, ...bound.bindings);
  } else {
    const [timeline] = definition.view.plan.timelines;
    // Each row's header names its source, live.
    sources.forEach(source => {
      timeline.rows = [
        ...timeline.rows,
        createSourceActivityRow(definition.view.plan.timelines, source.id, 'Activities'),
      ];
    });
  }
  return effects.createAnalysis(`${plan.name} analysis`, { ...definition, sources }, user);
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
