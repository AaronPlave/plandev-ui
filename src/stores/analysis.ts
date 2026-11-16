import { debounce, isEqual, pick } from 'lodash-es';
import { SearchParameters } from '../enums/searchParameters';
import { derived, get, writable, type Readable, type Writable } from 'svelte/store';
import type {
  Analysis,
  AnalysisActivityRef,
  AnalysisExternalEvent,
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
import type { Annotation, AnnotationAnchor, AnnotationRecord, Row, TimeRange, Timeline } from '../types/timeline';
import type { TimelineSourceRegistry } from '../types/timelineSource';
import {
  bindViewToAnalysisSources,
  createAnalysisDefinition,
  createAnalysisSources,
  createSourceActivityRow,
  findActivityTypeRow,
  findAnalysisToReopen,
  getAnalysisSourceNames,
  getAnalysisTimeRanges,
  getImportOutcome,
  getNextAnalysisSourceId,
  getSourceIdentity,
  importedActivityToSpan,
  INITIAL_ACTIVITY_ROW_LIMIT,
  isSameAnalysisSource,
  removeSourceFromTimelines,
  simulationSpanToActivity,
  withSourceIdentity,
} from '../utilities/analysis';
import { seqJsonProblem, sha256 } from '../utilities/analysisSequence';
import {
  ANNOTATION_COLOR,
  getLayoutAnnotations,
  mergeAnnotationsForLayout,
  notesToAnnotations,
} from '../utilities/analysisAnnotations';
import { getNextAnnotationId } from '../utilities/annotations';
import { loadAnalysisActivityDetails } from '../utilities/analysisActivityDetails';
import type { WatchedResource } from '../utilities/analysisAtTime';
import { getSourceCatalog, type SourceCatalog } from '../utilities/analysisPresentation';
import {
  getImportedPlanSourceIds,
  rebindUnboundLayers,
  type ViewImportPlanSource,
} from '../utilities/analysisViewImport';
import effects from '../utilities/effects';
import gql from '../utilities/gql';
import { featurePermissions } from '../utilities/permissions';
import { showConfirmModal } from '../utilities/modal';
import { showFailureToast, showSuccessToast } from '../utilities/toast';
import { findResourceType, getLayersUsingSource, getSource, toIntervalType } from '../utilities/timelineSources';
import { createRow, createTimelineActivityLayer, isActivityLayer } from '../utilities/timeline';
import { ViewDefaultActivityOptions, ViewDefaultDiscreteOptions } from '../constants/view';
import { getDoyTime, getIntervalInMs } from '../utilities/time';
import { applyViewDefinitionMigrations } from '../utilities/view';
import {
  createLoadedActivitySubscription,
  createPlanActivitySubscription,
  getExternalEvents,
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
 * The inspector's tabs: Inspect (what is selected or followed to: an activity, a source, a sequence), At Time (what
 * every source says at the cursor), Annotations (the list, and the one being edited), and the Timeline Editor (the
 * selected row). Page state, never saved.
 */
export type AnalysisInspectorTab = 'annotations' | 'editor' | 'inspect' | 'time';
/** What Inspect shows. 'selection' is the selected activity (an authored sequence's record is shown in its sequence). */
export type AnalysisInspectTarget =
  | { entryId?: string; kind: 'sequence'; sourceId: string }
  | { kind: 'selection' }
  | { kind: 'source'; sourceId: string };
/** Anything the inspector can be asked to show: an Inspect target, or another tab (an annotation in its tab). */
export type AnalysisInspectorTarget =
  | AnalysisInspectTarget
  | { id: number; kind: 'annotation' }
  | { kind: 'annotations' }
  | { kind: 'editor' }
  | { kind: 'time' };
/** A place Inspect was: its target, and the activity selected then. */
export type AnalysisInspectState = { selected: AnalysisActivityRef | null; target: AnalysisInspectTarget };

export const analysisInspectorTab: Writable<AnalysisInspectorTab> = writable('inspect');
export const analysisInspector: Writable<AnalysisInspectTarget> = writable({ kind: 'selection' });
/** The annotation open in the Annotations tab; null for the list alone. */
export const analysisAnnotationFocus: Writable<number | null> = writable(null);
/** Where Inspect was before, most recent last, for Back. Switching tabs is not a place. */
export const analysisInspectorHistory: Writable<AnalysisInspectState[]> = writable([]);
/** Set when the inspector is asked to show something, so the page can open its pane. */
export const analysisInspectorRequests: Writable<number> = writable(0);

let inspected: AnalysisInspectState = { selected: null, target: { kind: 'selection' } };

function resetInspector(target: AnalysisInspectTarget = { kind: 'selection' }) {
  inspected = { selected: get(selectedAnalysisActivity), target };
  analysisInspector.set(target);
  analysisInspectorTab.set('inspect');
  analysisAnnotationFocus.set(null);
  analysisInspectorHistory.set([]);
}

/**
 * Shows `target`, on its tab. Following something in Inspect (a source, a sequence, a newly selected activity) is
 * remembered for Back; opening another tab is not.
 */
export function inspect(target: AnalysisInspectorTarget) {
  analysisInspectorRequests.update(n => n + 1);
  switch (target.kind) {
    case 'time':
    case 'editor':
      analysisInspectorTab.set(target.kind);
      return;
    case 'annotations':
    case 'annotation':
      analysisAnnotationFocus.set(target.kind === 'annotation' ? target.id : null);
      analysisInspectorTab.set('annotations');
      return;
  }
  analysisInspectorTab.set('inspect');
  const next: AnalysisInspectState = { selected: get(selectedAnalysisActivity), target };
  if (isEqual(next, inspected)) {
    return;
  }
  // Nothing selected and nothing followed is no place to go back to.
  if (inspected.target.kind !== 'selection' || inspected.selected) {
    analysisInspectorHistory.update(history => [...history, inspected].slice(-20));
  }
  inspected = next;
  analysisInspector.set(target);
}

/** Whether `ref` being selected is already what Inspect shows (as after Back), so it is not a new place. */
export function isInspected(ref: AnalysisActivityRef | null): boolean {
  if (restoringSelection) {
    restoringSelection = false;
    return true;
  }
  return inspected.target.kind === 'selection' && isEqual(inspected.selected, ref);
}

/** Set while Back puts back the selection it had: that is not a new place to remember. */
let restoringSelection = false;

export function inspectBack() {
  const history = get(analysisInspectorHistory);
  const previous = history.at(-1);
  if (previous) {
    analysisInspectorHistory.set(history.slice(0, -1));
    inspected = previous;
    analysisInspectorTab.set('inspect');
    analysisInspector.set(previous.target);
    restoringSelection = get(selectedAnalysisActivity) !== previous.selected;
    selectedAnalysisActivity.set(previous.selected);
  }
}

/**
 * Resources the At Time inspector was asked to watch, each of one source (by the analysis's own binding id) and its
 * name: the same name in two sources is two entries. Page state, not saved with the analysis; it lives here because the
 * inspector's tab unmounts when another tab is shown. Entries of a source that is removed or pointed at other data are
 * dropped, never redirected.
 */
export const analysisWatchedResources: Writable<WatchedResource[]> = writable([]);
/**
 * The activity the next selected one is compared with. Picked by the person; page state, not saved. Dropped when its
 * source is removed or pointed at other data.
 */
export const analysisCompareReference: Writable<AnalysisActivityRef | null> = writable(null);
/**
 * The analysis's annotations: its timeline's (types/timeline.ts), marks and findings alike, saved with it. Derived
 * from the view so there is one copy; changed through the functions below.
 */
export const analysisAnnotations: Readable<Annotation[]> = derived(
  view,
  $view => $view?.definition.plan.timelines[0]?.annotations ?? [],
);
/**
 * The timeline (with its annotations) as it was before the layout was last replaced, to undo it. Page state: cleared
 * when the analysis closes, and by any later replacement.
 */
export const analysisLayoutUndo: Writable<{ name: string; timeline: Timeline } | null> = writable(null);
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

/** The derivation groups linked to each bound plan, live, by plan id. */
const analysisPlanDerivationGroupLinks = gqlSubscribable<{ derivation_group_name: string; plan_id: number }[]>(
  gql.SUB_ANALYSIS_PLAN_DERIVATION_GROUPS,
  { planIds: analysisPlanIds },
  [],
);
export const analysisPlanDerivationGroups: Readable<Record<number, string[]>> = derived(
  analysisPlanDerivationGroupLinks,
  $links => {
    const byPlan: Record<number, string[]> = {};
    ($links ?? []).forEach(({ derivation_group_name, plan_id }) => {
      byPlan[plan_id] = [...(byPlan[plan_id] ?? []), derivation_group_name];
    });
    return byPlan;
  },
);

/** Each bound plan's external events (of its linked derivation groups, as derived), live, by plan id. */
export const analysisPlanExternalEvents: Readable<Record<number, AnalysisExternalEvent[]>> = derived(
  analysisPlanDerivationGroups,
  ($groups, set) => {
    const byPlan: Record<number, AnalysisExternalEvent[]> = {};
    set(byPlan);
    const unsubscribers = Object.entries($groups).map(([planId, groups]) =>
      getExternalEvents(groups).subscribe(events => {
        byPlan[Number(planId)] = events ?? [];
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
    analysisPlanExternalEvents,
    analysisPlanDerivationGroups,
  ],
  ([
    $bindings,
    $revisions,
    $datasets,
    $typeCounts,
    $recovery,
    $loading,
    $plans,
    $plansLoading,
    $planDirectives,
    $planEvents,
    $planGroups,
  ]) => ({
    loading: $loading,
    scope: 'analysis' as const,
    sources: createAnalysisSources({
      bindings: $bindings,
      loading: $loading,
      planExternalEvents: $planEvents,
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
      subscribePlanActivities: (binding, plan) =>
        createPlanActivitySubscription(binding.id, plan.id, $planGroups[plan.id] ?? []),
      subscribePlanExternalProfile: (_binding, plan, dataset, name, { user }) =>
        createProfileSubscription(
          dataset.dataset_id,
          name,
          new Date(Date.parse(plan.start_time) + getIntervalInMs(dataset.offset_from_plan_start)).toISOString(),
          user,
        ),
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

/**
 * Where to look when an analysis opens, from a shared link or from where this person last was. Never saved with the
 * analysis: one person's navigation does not change what the others open.
 */
export type AnalysisOpenContext = {
  /** A linked activity, with the data it was in (see getSourceIdentity): selected only if its source still reads that data. */
  activity?: AnalysisActivityRef & { data: string };
  /** An annotation to open. */
  annotationId?: number;
  compareCursorMs?: number;
  cursorMs?: number;
  /** A note, linked before annotations were one thing: the annotation made from it opens. */
  noteId?: number;
  range?: TimeRange;
};

/** Reads an open context from link parameters; anything malformed is ignored. */
export function parseAnalysisOpenContext(params: URLSearchParams): AnalysisOpenContext {
  const number = (name: string) => {
    const value = Number(params.get(name) ?? NaN);
    return Number.isFinite(value) ? value : undefined;
  };
  const start = number('start');
  const end = number('end');
  const activity = /^([^|]+)\|([^|]+)\|(\d+)$/.exec(params.get('activity') ?? '');
  return {
    activity: activity ? { activityId: Number(activity[3]), data: activity[2], sourceId: activity[1] } : undefined,
    annotationId: number('annotation'),
    compareCursorMs: number('cursorB'),
    cursorMs: number('cursor'),
    noteId: number('note'),
    range: start !== undefined && end !== undefined && end > start ? { end, start } : undefined,
  };
}

/** Link parameters for what is on screen now: the window, the cursors and the selected activity. */
export function getAnalysisLinkParams(): URLSearchParams {
  const params = new URLSearchParams();
  const { end, start } = get(viewTimeRange);
  params.set('start', `${Math.round(start)}`);
  params.set('end', `${Math.round(end)}`);
  const cursor = get(timeCursorMs);
  const compare = get(timeCursorCompareMs);
  if (cursor !== null) {
    params.set('cursor', `${Math.round(cursor)}`);
  }
  if (compare !== null) {
    params.set('cursorB', `${Math.round(compare)}`);
  }
  const selected = get(selectedAnalysisActivity);
  const binding = selected && get(analysisSourceBindings).find(({ id }) => id === selected.sourceId);
  if (selected && binding) {
    params.set('activity', `${selected.sourceId}|${getSourceIdentity(binding)}|${selected.activityId}`);
  }
  return params;
}

export async function openAnalysis(initial: Analysis, user: User | null, context: AnalysisOpenContext = {}) {
  clearAnalysisImports();
  const { migratedViewDefinition } = applyViewDefinitionMigrations(initial.definition.view);
  analysis.set(initial);
  analysisSourceBindings.set(initial.definition.sources);
  selectedAnalysisActivity.set(null);
  analysisCompareReference.set(null);
  // Notes saved before annotations were one concept become the annotations they are (see notesToAnnotations), and
  // layers that name a Plan page's plan read the analysis's plan or simulation, when there is only one.
  const viewDefinition = migratedViewDefinition ?? initial.definition.view;
  const [firstTimeline, ...otherTimelines] = viewDefinition.plan.timelines;
  const timeline =
    firstTimeline &&
    rebindUnboundLayers(
      notesToAnnotations(initial.definition.annotations ?? [], firstTimeline),
      initial.definition.sources,
    );
  resetInspector();
  // A link names an annotation (or, made before annotations, a note): it opens.
  const linked = timeline?.annotations.find(({ id, legacyNoteId }) =>
    context.annotationId !== undefined ? id === context.annotationId : legacyNoteId === context.noteId,
  );
  if (linked && (context.annotationId !== undefined || context.noteId !== undefined)) {
    inspect({ id: linked.id, kind: 'annotation' });
  }
  analysisLayoutUndo.set(null);
  analysisWatchedResources.set([]);
  initializeView({
    created_at: initial.created_at,
    definition:
      timeline === firstTimeline
        ? viewDefinition
        : { ...viewDefinition, plan: { ...viewDefinition.plan, timelines: [timeline, ...otherTimelines] } },
    id: -1,
    name: initial.name,
    owner: initial.owner,
    updated_at: initial.updated_at,
  });
  // Reopened while its earlier changes are still being sent: those saves carry on (and say so). Otherwise what was
  // just read is the revision to save over.
  const queue = saveQueues.get(initial.id);
  if (queue && !queue.running) {
    saveQueues.delete(initial.id);
  }
  analysisSaveStatus.set(queue?.running ? 'saving' : 'saved');
  const ranges = await loadSourceDetails(initial.definition.sources, user);
  if (ranges === undefined) {
    return;
  }
  // The time window is not saved with the analysis: it opens where a link or this person's last visit says, else on
  // its sources' range, or, with none yet, the last day.
  const lastDay = { end: Date.now(), start: Date.now() - 864e5 };
  if (!ranges) {
    analysisMaxTimeRange.set(lastDay);
  }
  viewTimeRange.set(context.range ?? ranges?.initial ?? lastDay);
  if (context.cursorMs !== undefined) {
    timeCursorMs.set(context.cursorMs);
    timeCursorCompareMs.set(context.compareCursorMs ?? null);
  }
  if (context.activity) {
    const { data, ...ref } = context.activity;
    const binding = initial.definition.sources.find(({ id }) => id === ref.sourceId);
    if (binding && getSourceIdentity(binding) === data) {
      selectedAnalysisActivity.set(ref);
    } else {
      // Never redirected to whatever the source reads now.
      showFailureToast('The Linked Activity Is In Data This Analysis No Longer Reads');
    }
  }
}

export function closeAnalysis() {
  // Changes already captured are still sent, for the analysis they were made in.
  flushAnalysisSave();
  sourceDetailsRequest++;
  analysis.set(null);
  analysisSourceBindings.set([]);
  analysisSourceRevisions.set([]);
  analysisSourceRecovery.set({});
  analysisSimulationDatasets.set([]);
  analysisSimulationTypeCounts.set({});
  selectedAnalysisActivity.set(null);
  resetInspector();
  analysisCompareReference.set(null);
  analysisLayoutUndo.set(null);
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
  if (get(analysisCompareReference)?.sourceId === sourceId) {
    analysisCompareReference.set(null);
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

/**
 * Adds a row of one source's activities of `type` whose parameter has one value (every ABORTED sequence, say), drawn
 * in `color`, unless a row already shows exactly that. An ordinary filtered layer: editable like any other.
 */
export function showAnalysisActivitiesWith(
  sourceId: string,
  type: string,
  parameter: string,
  value: string,
  color: string,
): Row | undefined {
  const timeline = get(view)?.definition.plan.timelines[0];
  if (!timeline) {
    return undefined;
  }
  const filter = {
    static_types: [type],
    type_subfilters: {
      [type]: [
        {
          field: 'Parameter' as const,
          id: 0,
          operator: 'equals' as const,
          subfield: { name: parameter, type: 'string' as const },
          value,
        },
      ],
    },
  };
  const existing = timeline.rows.find(row =>
    row.layers.some(layer => layer.sourceId === sourceId && isEqual(layer.filter.activity, filter)),
  );
  const sourceLabel = getSource(get(analysisTimelineSources), sourceId)?.label ?? sourceId;
  const row =
    existing ??
    createRow([timeline], {
      layers: [
        createTimelineActivityLayer([timeline], {
          activityColor: color,
          filter: { activity: filter },
          name: `${type} ${value}`,
          sourceId,
        }),
      ],
      name: `${type} · ${parameter} ${value} · ${sourceLabel}`,
    });
  if (!existing) {
    appendRootRow(timeline, row);
  }
  viewSetSelectedRow(row.id);
  showSuccessToast(existing ? `Already shown in row "${row.name}"` : `Added row "${row.name}"`);
  return row;
}

/** Adds a row at the end of the timeline, outside any section (a row the order doesn't name is put in one). */
function appendRootRow(timeline: Timeline, row: Row) {
  // One update: a timeline whose rows changed without its order could be normalized in between.
  view.update(
    current =>
      current && {
        ...current,
        definition: {
          ...current.definition,
          plan: {
            ...current.definition.plan,
            timelines: current.definition.plan.timelines.map(t =>
              t.id === timeline.id
                ? { ...t, items: [...(t.items ?? []), { id: row.id, type: 'row' as const }], rows: [...t.rows, row] }
                : t,
            ),
          },
        },
      },
  );
}

/**
 * Shows sequences on the timeline: a row of the source's records of `types` (the sequences' own kinds and their
 * steps'), grouped by name and opened by parent, so steps sit under their sequence in the product's order. With
 * `focus`, the row holds only that sequence and what descends from it (by the parents records name, never by type or
 * time); without, every sequence of the source. A row that already shows the same thing is reused, not duplicated.
 * The selection, revealed in the row's tree, does the rest. Only the presentation changes; the data is only read.
 */
export function showAnalysisSequence(
  sourceId: string,
  types: string[],
  focus?: { key: string; name: string },
): Row | undefined {
  const timeline = get(view)?.definition.plan.timelines[0];
  if (!timeline || !types.length) {
    return undefined;
  }
  const wanted = [...new Set(types)].sort();
  const within = focus ? [focus.key] : undefined;
  const existing = timeline.rows.find(
    row =>
      row.discreteOptions?.displayMode === 'grouped' &&
      row.discreteOptions.activityOptions?.hierarchyMode === 'parent' &&
      row.layers.some(
        layer =>
          layer.sourceId === sourceId &&
          isActivityLayer(layer) &&
          isEqual(layer.filter.activity?.within, within) &&
          wanted.every(type => layer.filter.activity?.static_types?.includes(type)),
      ),
  );
  const sourceLabel = getSource(get(analysisTimelineSources), sourceId)?.label ?? sourceId;
  // One focus row per source: focusing another sequence points the row made for following the focus at it, rather
  // than adding a row per sequence. A row the person has made their own (edited) is never repointed.
  const focusRow =
    !existing && focus
      ? timeline.rows.find(
          row =>
            row.followsFocus &&
            row.layers.length === 1 &&
            row.layers.some(
              layer => layer.sourceId === sourceId && isActivityLayer(layer) && layer.filter.activity?.within,
            ),
        )
      : undefined;
  if (focusRow && focus) {
    const name = `Sequence ${focus.name} · ${sourceLabel}`;
    viewUpdateTimeline(
      'rows',
      timeline.rows.map(row =>
        row.id === focusRow.id
          ? {
              ...row,
              layers: row.layers.map(layer => ({
                ...layer,
                filter: { ...layer.filter, activity: { static_types: wanted, within } },
                name: focus.name,
              })),
              name,
            }
          : row,
      ),
      timeline.id,
    );
    viewSetSelectedRow(focusRow.id);
    showSuccessToast(`Row "${name}" now shows ${focus.name}`);
    return focusRow;
  }
  const row =
    existing ??
    createRow([timeline], {
      discreteOptions: {
        ...ViewDefaultDiscreteOptions,
        activityOptions: { ...ViewDefaultActivityOptions, groupBy: 'name', hierarchyMode: 'parent' },
        displayMode: 'grouped',
      },
      ...(focus ? { followsFocus: true } : {}),
      height: focus ? 200 : 320,
      layers: [
        createTimelineActivityLayer([timeline], {
          filter: { activity: { static_types: wanted, ...(within ? { within } : {}) } },
          name: focus ? focus.name : wanted.join(' + '),
          sourceId,
        }),
      ],
      name: focus ? `Sequence ${focus.name} · ${sourceLabel}` : `Sequences · ${sourceLabel}`,
    });
  if (!existing) {
    appendRootRow(timeline, row);
  }
  viewSetSelectedRow(row.id);
  if (!existing) {
    showSuccessToast(`Added row "${row.name}"`);
  }
  return row;
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
 * Replaces the analysis's timeline with `timeline` (see importViewTimeline, applyPresentation). Its sources, name,
 * owner and everything else in the view are untouched, and, like any edit, it is saved by the autosave. The analysis's
 * own findings stay (value annotations among them say their row is gone); the presentation's reusable annotations come
 * with it when `bringAnnotations` (see mergeAnnotationsForLayout). Undo puts back the timeline as it was. Not offered
 * when the user can't edit the analysis. Returns whether it replaced.
 */
export function replaceAnalysisTimeline(
  timeline: Timeline,
  user: User | null,
  name: string = 'another layout',
  { bringAnnotations = true, dataless = false }: { bringAnnotations?: boolean; dataless?: boolean } = {},
): boolean {
  const current = get(analysis);
  const previous = get(view)?.definition.plan.timelines[0];
  if (!current || !previous || !featurePermissions.analysis.canUpdate(user, current)) {
    return false;
  }
  // Nothing mapped to this analysis's sources: replacing the timeline would only empty it. (A layout that never had
  // data layers, only rows, sections and annotations, is used as it is.)
  if (!dataless && !timeline.rows.some(row => row.layers.length)) {
    showFailureToast('Nothing In The View Maps To This Analysis, So The Timeline Was Not Replaced');
    return false;
  }
  analysisLayoutUndo.set({ name, timeline: previous });
  setAnalysisTimeline({
    ...timeline,
    annotations: mergeAnnotationsForLayout(previous.annotations, timeline, bringAnnotations),
    id: previous.id,
  });
  return true;
}

/** Puts back the timeline (and its annotations) the last layout replacement replaced. */
export function undoAnalysisLayout() {
  const undo = get(analysisLayoutUndo);
  if (undo) {
    setAnalysisTimeline(undo.timeline);
    analysisLayoutUndo.set(null);
  }
}

function setAnalysisTimeline(timeline: Timeline) {
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
}

/* Annotations (types/timeline.ts Annotation; see utilities/analysisAnnotations). */

function updateAnnotations(change: (annotations: Annotation[]) => Annotation[]) {
  const timeline = get(view)?.definition.plan.timelines[0];
  if (timeline) {
    viewUpdateTimeline('annotations', change(timeline.annotations), timeline.id);
  }
}

/** Adds an annotation and opens it, to be titled and explained. Returns its id. */
export function addAnnotation(
  annotation: Pick<Annotation, 'anchor' | 'label'> & Partial<Pick<Annotation, 'color' | 'description'>>,
  user: User | null,
): number | null {
  const timeline = get(view)?.definition.plan.timelines[0];
  if (!timeline) {
    return null;
  }
  const id = getNextAnnotationId([timeline]);
  updateAnnotations(all => [
    ...all,
    {
      color: ANNOTATION_COLOR,
      ...annotation,
      createdAt: new Date().toISOString(),
      ...(user?.id ? { createdBy: user.id } : {}),
      id,
    },
  ]);
  inspect({ id, kind: 'annotation' });
  return id;
}

/** Marks a time, or a time range, across the rows. */
export function addTimeAnnotation(startMs: number, endMs: number | undefined, user: User | null): number | null {
  const [from, to] = endMs === undefined ? [startMs] : [Math.min(startMs, endMs), Math.max(startMs, endMs)];
  const anchor: AnnotationAnchor = {
    kind: 'time',
    start: getDoyTime(new Date(from)),
    ...(to === undefined ? {} : { end: getDoyTime(new Date(to)) }),
  };
  return addAnnotation({ anchor, label: to === undefined ? 'Mark' : 'Marked range' }, user);
}

/** Marks a value on a row, on its first axis at the middle of its range (or at `y`), in that axis's unit. */
export function addValueAnnotation(rowId: number, user: User | null, y?: number): number | null {
  const timeline = get(view)?.definition.plan.timelines[0];
  const row = timeline?.rows.find(({ id }) => id === rowId);
  const axis = row?.yAxes[0];
  if (!timeline || !row || !axis) {
    return null;
  }
  const [low, high] = (axis.scaleDomain ?? []) as (number | null)[];
  // The unit of what the axis plots, so the value keeps its meaning if the row later reads something else.
  const layer = row.layers.find(({ yAxisId }) => yAxisId === axis.id);
  const units = layer
    ? findResourceType(get(analysisTimelineSources), layer.sourceId, layer.filter.resource)?.schema.metadata?.unit
        ?.value
    : undefined;
  const middle = typeof low === 'number' && typeof high === 'number' ? (low + high) / 2 : 0;
  return addAnnotation(
    {
      anchor: {
        kind: 'value',
        rowId,
        rowName: row.name,
        ...(units ? { units } : {}),
        y: y ?? middle,
        yAxisId: axis.id,
      },
      label: 'Limit',
    },
    user,
  );
}

/** Annotates one record of a source, at its start; it keeps which data it was about. */
export function addRecordAnnotation(
  record: Omit<AnnotationRecord, 'data' | 'sourceLabel'>,
  startMs: number,
  user: User | null,
): number | null {
  const binding = get(analysisSourceBindings).find(({ id }) => id === record.sourceId);
  if (!binding) {
    return null;
  }
  return addAnnotation(
    {
      anchor: {
        kind: 'record',
        record: {
          ...record,
          data: getSourceIdentity(binding),
          sourceLabel: getSource(get(analysisTimelineSources), binding.id)?.label ?? binding.id,
        },
        start: new Date(startMs).toISOString(),
      },
      label: record.name,
    },
    user,
  );
}

/** Annotates an activity of the analysis, read from its source for its name, kind and key. */
export async function annotateActivity(ref: AnalysisActivityRef, user: User | null): Promise<number | null> {
  const details = await loadAnalysisActivityDetails(ref, {
    bindings: get(analysisSourceBindings),
    datasets: get(analysisSimulationDatasets),
    planDirectives: get(analysisPlanDirectives),
    planExternalEvents: get(analysisPlanExternalEvents),
    revisions: get(analysisSourceRevisions),
    user,
  });
  if (!details) {
    showFailureToast('The Record Could Not Be Read');
    return null;
  }
  return addRecordAnnotation(
    {
      activityId: ref.activityId,
      key: details.key,
      kind: 'activity',
      name: details.name,
      recordKind: details.kind,
      sourceId: ref.sourceId,
    },
    details.startMs,
    user,
  );
}

/** A finding that marks nothing on the timeline. */
export function addGeneralAnnotation(user: User | null): number | null {
  return addAnnotation({ anchor: { kind: 'general' }, label: 'Finding' }, user);
}

/** Changes one annotation (its label, words, color, place, reuse), recording when. */
export function updateAnnotation(id: number, changes: Partial<Omit<Annotation, 'id'>>) {
  updateAnnotations(all =>
    all.map(annotation =>
      annotation.id === id ? { ...annotation, ...changes, updatedAt: new Date().toISOString() } : annotation,
    ),
  );
}

export function removeAnnotation(id: number) {
  updateAnnotations(all => all.filter(annotation => annotation.id !== id));
  if (get(analysisAnnotationFocus) === id) {
    analysisAnnotationFocus.set(null);
  }
}

/* Applying another analysis's presentation (see utilities/analysisPresentation). */

export type AnalysisPresentation = {
  bindings: AnalysisSourceBinding[];
  /** What each of its sources offers, by binding id, to check what the target can show. */
  catalogs: Record<string, SourceCatalog>;
  id: number;
  /** Where it was read from: another analysis, or a layout saved as a view. */
  kind: 'analysis' | 'view';
  name: string;
  /** Each source's name, by binding id. */
  names: Record<string, string>;
  noteCount: number;
  timeline: Timeline;
};

/** Reads another analysis's presentation. That analysis is only read. Null (reported) when it can't be. */
export async function readAnalysisPresentation(id: number, user: User | null): Promise<AnalysisPresentation | null> {
  const other = await effects.getAnalysis(id, user);
  const migrated = other && applyViewDefinitionMigrations(other.definition.view);
  const timeline = (migrated?.migratedViewDefinition ?? other?.definition.view)?.plan.timelines[0];
  if (!other || !timeline || migrated?.error) {
    showFailureToast('The Analysis Could Not Be Read');
    return null;
  }
  return {
    ...(await describePresentationSources(other.definition.sources, user)),
    id: other.id,
    kind: 'analysis',
    name: other.name,
    // Its findings stay there: only its reusable annotations can come (see mergeAnnotationsForLayout).
    noteCount:
      (other.definition.annotations?.length ?? 0) + timeline.annotations.filter(({ reusable }) => !reusable).length,
    timeline,
  };
}

/** What a presentation's sources are: their names, and what each offers, to check what a target can show. */
async function describePresentationSources(
  sourceBindings: AnalysisSourceBinding[],
  user: User | null,
): Promise<Pick<AnalysisPresentation, 'bindings' | 'catalogs' | 'names'>> {
  const [revisions, datasets, plans] = await Promise.all([
    effects.getAnalysisSourceRevisions(
      sourceBindings.flatMap(binding => (binding.kind === 'imported' ? [binding.revisionId] : [])),
      user,
    ),
    effects.getAnalysisSimulationDatasets(
      sourceBindings.flatMap(binding => (binding.kind === 'simulation' ? [binding.simulationDatasetId] : [])),
      user,
    ),
    effects.getAnalysisPlans(
      sourceBindings.flatMap(binding => (binding.kind === 'plan' ? [binding.planId] : [])),
      user,
    ),
  ]);
  // The logical source of each revision, so another revision of it can be suggested in the target.
  const bindings = withSourceIdentity(sourceBindings, revisions ?? []);
  const names = Object.fromEntries(
    bindings.map(binding => {
      const { name, version } = getAnalysisSourceNames(binding, {
        dataset: datasets.find(dataset => binding.kind === 'simulation' && dataset.id === binding.simulationDatasetId),
        plan: plans.find(plan => binding.kind === 'plan' && plan.id === binding.planId),
        revision: (revisions ?? []).find(revision => binding.kind === 'imported' && revision.id === binding.revisionId),
      });
      return [binding.id, `${binding.label ? `${binding.label}: ` : ''}${name}, ${version}`];
    }),
  );
  return {
    bindings,
    catalogs: Object.fromEntries(
      bindings.map(binding => [binding.id, getSourceCatalog(binding, revisions ?? [], datasets)]),
    ),
    names,
  };
}

/** The data a layout saved from an analysis names in place of a binding (see saveAnalysisLayoutAsView). */
const LAYOUT_SOURCE = /^(plan|revision|simulation):(\d+)$/;

/**
 * Saves the analysis's layout as a view anyone can find and use in another analysis: its timeline, with each layer
 * naming the data it read (e.g. "revision:217") rather than this analysis's binding, and `analysisLayout` saying what
 * each of those was (its alias, source, name, and the resources read with their type and unit), so the view says on
 * its own what each layer showed, even once that data is gone. Of the annotations, only those in `include` (by id) that can
 * go with it; annotations about records never do. Returns the view's id, or null (reported).
 */
export async function saveAnalysisLayoutAsView(
  name: string,
  user: User | null,
  include: Set<number> = new Set(),
): Promise<number | null> {
  const current = get(view);
  if (!current) {
    return null;
  }
  const bindings = get(analysisSourceBindings);
  const definition = structuredClone(current.definition);
  definition.plan.timelines = definition.plan.timelines.map(timeline => ({
    ...timeline,
    annotations: getLayoutAnnotations(timeline.annotations, include),
  }));
  const used = new Map<string, { binding: AnalysisSourceBinding; resources: Set<string> }>();
  definition.plan.timelines.forEach(timeline =>
    timeline.rows.forEach(row =>
      row.layers.forEach(layer => {
        const binding = bindings.find(({ id }) => id === layer.sourceId);
        if (binding) {
          layer.sourceId = getSourceIdentity(binding);
          const entry = used.get(layer.sourceId) ?? { binding, resources: new Set<string>() };
          if (layer.filter.resource) {
            entry.resources.add(layer.filter.resource);
          }
          used.set(layer.sourceId, entry);
        }
      }),
    ),
  );
  // Described without their aliases: the alias is kept apart, as the role.
  const described = await describePresentationSources(
    [...used.values()].map(({ binding: { label: _, ...binding } }) => binding),
    user,
  );
  definition.analysisLayout = {
    sources: Object.fromEntries(
      [...used.entries()].map(([identity, { binding, resources }]) => {
        const { id, label, ...target } = withSourceIdentity([binding], get(analysisSourceRevisions))[0];
        const catalog = described.catalogs[id]?.resources;
        return [
          identity,
          {
            binding: { ...target, ...(label ? { label } : {}) },
            name: described.names[id] ?? identity,
            resources: Object.fromEntries(
              [...resources].flatMap(key => {
                const entry = catalog?.get(key);
                return entry ? [[key, entry]] : [];
              }),
            ),
          },
        ];
      }),
    ),
  };
  const id = await effects.createNamedView(definition, name, user);
  if (id !== null) {
    showSuccessToast(`Saved the layout as view "${name}": use it in any analysis from Use a Layout`);
  }
  return id;
}

/**
 * A saved view as a presentation, when it is a layout saved from an Analysis (it says so in `analysisLayout`, or,
 * saved before that, its layers name data). 'plan-view' when it is a Plan's view, to be loaded as one
 * (readViewForTimelineImport).
 */
export async function readViewPresentation(
  viewId: number,
  user: User | null,
): Promise<AnalysisPresentation | 'plan-view' | null> {
  const saved = await effects.getView(new URLSearchParams(`?${SearchParameters.VIEW_ID}=${viewId}`), user, false);
  if (!saved || saved.id !== viewId) {
    showFailureToast('The View Could Not Be Read');
    return null;
  }
  const { error, migratedViewDefinition } = applyViewDefinitionMigrations(saved.definition);
  const timeline = (migratedViewDefinition ?? saved.definition).plan.timelines[0];
  if (error || !timeline) {
    showFailureToast(`Unable To Read View "${saved.name}"`);
    return null;
  }
  const described = saved.definition.analysisLayout?.sources ?? {};
  const identities = [
    ...new Set(
      timeline.rows.flatMap(row => row.layers.map(layer => layer.sourceId ?? '').filter(id => LAYOUT_SOURCE.test(id))),
    ),
  ];
  if (!identities.length && !saved.definition.analysisLayout) {
    return 'plan-view';
  }
  // Each data the layout names is a role, its binding id the identity itself; what the layout says about it (its
  // source, alias) is kept, so another revision of that source is suggested even if this one is gone.
  const bindings = identities.map((identity): AnalysisSourceBinding => {
    if (described[identity]) {
      return { ...described[identity].binding, id: identity };
    }
    const [, kind, ref] = identity.match(LAYOUT_SOURCE) ?? [];
    return kind === 'revision'
      ? { id: identity, kind: 'imported', revisionId: Number(ref) }
      : kind === 'simulation'
        ? { id: identity, kind: 'simulation', simulationDatasetId: Number(ref) }
        : { id: identity, kind: 'plan', planId: Number(ref) };
  });
  const presentation = await describePresentationSources(bindings, user);
  bindings.forEach(({ id, label }) => {
    const said = described[id];
    if (said && !presentation.catalogs[id]?.resources) {
      // That data can't be read now: what the layout said about it stands in, as what it was.
      presentation.names[id] = `${label ? `${label} — ` : ''}originally ${said.name}`;
      presentation.catalogs[id] = {
        activityTypes: presentation.catalogs[id]?.activityTypes ?? null,
        resources: new Map(Object.entries(said.resources)),
      };
    }
  });
  return {
    ...presentation,
    id: saved.id,
    kind: 'view',
    name: saved.name,
    noteCount: 0,
    timeline,
  };
}

/**
 * Removes a source and every layer bound to it; rows that only showed it go too. Asked first, saying which rows read it
 * (the source's data itself is not deleted, and it can be added again). Returns whether it was removed.
 */
export async function removeAnalysisSource(sourceId: string, user: User | null): Promise<boolean> {
  const label = getSource(get(analysisTimelineSources), sourceId)?.label ?? sourceId;
  const using = getLayersUsingSource(get(view)?.definition.plan.timelines ?? [], sourceId);
  const { confirm } = await showConfirmModal(
    'Remove',
    `Remove "${label}" from this analysis? Its data is not deleted, and it can be added again. ${
      using.length
        ? `${using.length === 1 ? 'This row reads' : 'These rows read'} it, and ${using.length === 1 ? 'its layer goes' : 'their layers go'} with it: ${using.join(', ')}.`
        : 'No row reads it.'
    }`,
    'Remove Source from Analysis',
  );
  if (!confirm) {
    return false;
  }
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
  if (get(analysisCompareReference)?.sourceId === sourceId) {
    analysisCompareReference.set(null);
  }
  dropWatchedResources(sourceId);
  await loadSourceDetails(next, user);
  return true;
}

/* Saving: the analysis saves itself shortly after anything it persists changes. */

type AnalysisPatch = Partial<Pick<Analysis, 'definition' | 'name'>>;

/**
 * One analysis's saves, sent one at a time. Each change is captured when it is made, so a change made while a save is
 * in flight goes in the next save, sent with the revision the previous one returned, and the analysis only says Saved
 * once nothing newer is waiting. The queue keeps working after the page moves to another analysis.
 */
type SaveQueue = {
  base: AnalysisSlim; // updated_at is the revision the next save must replace
  conflict: boolean;
  pending: AnalysisPatch | null;
  running: Promise<void> | null;
  user: User | null;
};

const saveQueues = new Map<number, SaveQueue>();

function setSaveStatus(id: number, status: Parameters<typeof analysisSaveStatus.set>[0]) {
  if (get(analysis)?.id === id) {
    analysisSaveStatus.set(status);
  }
}

function getSaveQueue(current: AnalysisSlim, user: User | null): SaveQueue {
  let queue = saveQueues.get(current.id);
  if (!queue) {
    queue = { base: current, conflict: false, pending: null, running: null, user };
    saveQueues.set(current.id, queue);
  }
  queue.user = user ?? queue.user;
  return queue;
}

async function drainSaveQueue(queue: SaveQueue) {
  const { id } = queue.base;
  while (queue.pending && !queue.conflict) {
    const patch = queue.pending;
    queue.pending = null;
    setSaveStatus(id, 'saving');
    const updatedAt = await effects.updateAnalysis(queue.base, patch, queue.user);
    if (updatedAt === 'conflict') {
      // Someone else changed it: never overwrite their work.
      queue.conflict = true;
      setSaveStatus(id, 'conflict');
      return;
    }
    if (!updatedAt) {
      // Kept, under anything newer, for the next try.
      queue.pending = { ...patch, ...(queue.pending ?? {}) };
      setSaveStatus(id, 'error');
      return;
    }
    queue.base = { ...queue.base, ...(patch.name !== undefined ? { name: patch.name } : {}), updated_at: updatedAt };
    analysis.update(current => (current?.id === id ? { ...current, ...patch, updated_at: updatedAt } : current));
  }
  if (!queue.conflict) {
    setSaveStatus(id, 'saved');
  }
}

/** Sends the analysis's waiting changes unless a save is already in flight (which then sends them next). */
function startSave(queue: SaveQueue): Promise<void> {
  if (!queue.running) {
    queue.running = drainSaveQueue(queue).finally(() => {
      queue.running = null;
      if (!queue.pending && get(analysis)?.id !== queue.base.id) {
        saveQueues.delete(queue.base.id);
      }
    });
  }
  return queue.running;
}

function requestSave(current: AnalysisSlim, patch: AnalysisPatch, user: User | null): SaveQueue {
  const queue = getSaveQueue(current, user);
  queue.pending = { ...queue.pending, ...patch };
  if (!queue.conflict) {
    setSaveStatus(current.id, 'unsaved');
  }
  return queue;
}

const saveSoon = debounce(() => saveQueues.forEach(queue => queue.pending && startSave(queue)), 1000);

/** Sends every waiting save now (leaving the page, say, or retrying one that failed). */
export function flushAnalysisSave(): Promise<void> {
  saveSoon.cancel();
  return Promise.all([...saveQueues.values()].filter(queue => queue.pending).map(startSave)).then(() => {});
}

/**
 * Saves the analysis whenever its sources or view change. Returns the function that stops it. Does nothing for a user
 * who can't update the analysis: their saves could only fail.
 */
export function autosaveAnalysis(user: User | null): () => void {
  const current = get(analysis);
  if (!user || !current || !featurePermissions.analysis.canUpdate(user, current)) {
    return () => {};
  }
  const queue = getSaveQueue(current, user);
  let first = true;
  const unsubscribe = derived([analysisSourceBindings, view], values => values).subscribe(([sources, currentView]) => {
    if (first) {
      first = false;
      return;
    }
    // Only this analysis's own view is saved into it: the view store is shared with every page, and a view of
    // another page or analysis (opened in between, or kept by a module reloaded in development) is never saved here.
    if (
      get(analysis)?.id !== current.id ||
      !currentView ||
      currentView.id !== -1 ||
      currentView.created_at !== current.created_at ||
      queue.conflict
    ) {
      return;
    }
    // Captured now: the stores may hold another analysis by the time this is sent.
    // Annotations are the view's; notes saved before them were translated when it opened, and are not written again.
    requestSave(current, { definition: { sources, version: 1, view: currentView.definition } }, user);
    saveSoon();
  });
  return () => {
    unsubscribe();
    flushAnalysisSave();
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
  { fresh = false, sequence = false }: { fresh?: boolean; sequence?: boolean } = {},
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
    createRevisionAnalysis(source.name, target, revision.activityCount, user, { sequence }),
  );
}

/** A SeqDev workspace file, as "Analyze sequence" reads it. */
export type WorkspaceSequenceFile = {
  /**
   * How the file's language becomes seqJSON, when it is not seqJSON itself: the adaptation's own conversion, run here
   * on exactly `input` (never on whatever output an editor last displayed).
   */
  conversion?: {
    /** The uploaded adaptation that converts, or null for the built-in SeqN conversion. */
    adaptationId: number | null;
    /** The command dictionary the conversion reads, when there is one. */
    commandDictionaryId: number | null;
    /** The file's language, e.g. "SeqN". */
    language: string;
    run: (input: string) => string | undefined | Promise<string | undefined>;
  };
  /** The file's saved content. */
  input: string;
  path: string;
  workspaceId: number;
  workspaceName: string;
};

/**
 * "Analyze sequence" on a file in a SeqDev workspace. Workspace files keep no versions, so the analysis reads a
 * snapshot: `input`, or its conversion to seqJSON run here on exactly `input`, imported as a revision of the user's
 * source for that file. The source is found by its origin, the workspace's id and the file's path, among the user's
 * own sources only: never by a name (workspace names repeat, and change), never another user's, and never by content.
 * A file moved or renamed is another source, since the workspace keeps no identity across a move. The same input
 * converting to the same bytes reuses their revision; anything else is a new revision, which an analysis of an older
 * one offers as an update and never takes on its own. Each revision keeps what it was made from: the workspace, path,
 * the input's hash and, for a conversion, the language, adaptation and dictionary. Returns the analysis's id, or null
 * (reported) when the conversion, the import or the analysis failed.
 */
export async function analyzeWorkspaceSequence(
  file: WorkspaceSequenceFile,
  user: User | null,
  wait: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
): Promise<number | null> {
  const name = `${file.workspaceName}/${file.path}`;
  let content: string | undefined = file.input;
  if (file.conversion) {
    try {
      content = await file.conversion.run(file.input);
    } catch (e) {
      showFailureToast(`The Sequence Could Not Be Converted To seqJSON: ${(e as Error).message}`);
      return null;
    }
  }
  const problem = seqJsonProblem(content);
  if (content === undefined || problem !== null) {
    showFailureToast(
      file.conversion
        ? `The Conversion To seqJSON Is Not A Sequence (${problem})`
        : `The File Is Not A seqJSON Sequence (${problem})`,
    );
    return null;
  }
  const [inputHash, contentHash] = await Promise.all([sha256(file.input), sha256(content)]);
  const source = await effects.getOrCreateSourceByOrigin(
    `workspace:${file.workspaceId}:${file.path}`,
    name,
    'seq_json',
    user,
  );
  if (source === null) {
    showFailureToast('The Sequence Could Not Be Analyzed');
    return null;
  }
  const { conversion } = file;
  const workspaceFile = {
    inputHash,
    path: file.path,
    workspaceId: file.workspaceId,
    workspaceName: file.workspaceName,
    ...(conversion
      ? {
          conversion: {
            adaptationId: conversion.adaptationId,
            commandDictionaryId: conversion.commandDictionaryId,
            from: conversion.language,
          },
        }
      : {}),
  };
  // The same bytes, made the same way from the same input: a revision of other input is another snapshot.
  let revision: { activityCount: number; id: number; status: string } | null =
    source.revisions.find(
      r =>
        r.content_hash === contentHash &&
        r.status === 'success' &&
        isEqual(
          pick((r.metadata as { workspaceFile?: object } | null)?.workspaceFile ?? {}, 'conversion', 'inputHash'),
          pick(workspaceFile, 'conversion', 'inputHash'),
        ),
    ) ?? null;
  if (!revision) {
    const imported = await effects.importSourceRevision(
      new File([content], `${file.path.split('/').pop()?.split('.')[0] || 'sequence'}.seq.json`, {
        type: 'application/json',
      }),
      { owner: source.owner, sourceId: source.id },
      'seq_json',
      user,
      { workspaceFile },
    );
    if (!imported) {
      return null;
    }
    // ponytail: polls the import for up to a minute; a seqJSON file ingests in well under a second.
    for (let tries = 0; tries < 120; tries++) {
      revision = await effects.getSourceRevisionStatus(imported.revisionId, user);
      if (revision && revision.status !== 'pending' && revision.status !== 'incomplete') {
        break;
      }
      await wait(500);
    }
    if (revision?.status !== 'success') {
      showFailureToast(
        revision?.status === 'failed' ? 'The Sequence Could Not Be Read As seqJSON' : 'The Sequence Is Still Importing',
      );
      return null;
    }
  }
  return analyzeRevision({ id: source.id, name: source.name }, revision, user, { sequence: true });
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
  { sequence = false }: { sequence?: boolean } = {},
): Promise<number | null> {
  const definition = createAnalysisDefinition();
  const sources: AnalysisSourceBinding[] = [{ ...target, id: 'source-1' }];
  if (activityCount > 0 && activityCount <= INITIAL_ACTIVITY_ROW_LIMIT) {
    const [timeline] = definition.view.plan.timelines;
    // A sequence is one row of it, steps under the sequence: not a flat row of records beside a hierarchy of them.
    timeline.rows = [
      createSourceActivityRow(definition.view.plan.timelines, 'source-1', sequence ? 'Sequence' : 'Activities', {
        byParent: sequence,
      }),
    ];
    // The timeline draws what its order names.
    timeline.items = timeline.rows.map(({ id }) => ({ id, type: 'row' as const }));
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
    timeline.items = timeline.rows.map(({ id }) => ({ id, type: 'row' as const }));
  }
  return effects.createAnalysis(`${plan.name} analysis`, { ...definition, sources }, user);
}

export async function renameAnalysis(name: string, user: User | null) {
  const current = get(analysis);
  if (current && name && name !== current.name) {
    // In the same queue as the autosave, so the two never race on one revision.
    const queue = requestSave(current, { name }, user);
    await startSave(queue);
  }
}
