import { getAuthoredMission, getWorkspaceFileSnapshot } from './analysisSequence';
import type {
  AnalysisActivityRef,
  AnalysisActivityRow,
  AnalysisDefinition,
  AnalysisExternalEvent,
  AnalysisPlan,
  AnalysisPlanExternalDataset,
  AnalysisPlanDirective,
  AnalysisSimulationDataset,
  AnalysisSourceBinding,
  AnalysisSourceRevision,
  AnalysisSourceTarget,
  AnalysisSourceUsage,
  SourceRecovery,
  SourceRevisionSummary,
} from '../types/analysis';
import type { UserId } from '../types/app';
import type { SourceResource } from '../types/importedSource';
import type { ResourceType, Span } from '../types/simulation';
import type { Row, TimeRange, Timeline } from '../types/timeline';
import type {
  SourceBrowserNode,
  TimelineActivityRequest,
  TimelineActivitySubscription,
  TimelineResourceSubscription,
  TimelineResourceSubscriptionContext,
  TimelineSource,
  TimelineSourceId,
} from '../types/timelineSource';
import { ViewDefaultActivityOptions, ViewDefaultDiscreteOptions } from '../constants/view';
import { removeValueAnnotations } from './annotations';
import { getIntervalInMs } from './time';
import { createRow, createTimeline, createTimelineActivityLayer, isActivityLayer } from './timeline';
import {
  activityItemNode,
  countLabel,
  createStaticResourceSubscription,
  groupBrowserNodes,
  PLAN_SOURCE_ID,
  summarizeActivityTypes,
  toIntervalType,
} from './timelineSources';
import { generateDefaultView } from './view';

/* Activity identity. */

/** An activity's identity across the analysis: its source and its id within that source. */
export function getAnalysisActivityKey(ref: AnalysisActivityRef): string {
  return `${ref.sourceId}::${ref.activityId}`;
}

export function analysisActivityRefsEqual(a: AnalysisActivityRef | null, b: AnalysisActivityRef | null): boolean {
  return !!a && !!b && a.sourceId === b.sourceId && a.activityId === b.activityId;
}

/*
 * The timeline draws, selects and hit-tests activities by a numeric `span_id` that must be unique on the page, while
 * an analysis activity is only unique as (source, id). Rather than re-key the renderer, each analysis activity is
 * drawn under an id that encodes both: (source index + 1) * 2^32 + activity id. Plan span ids are below 2^31, so
 * the two can never collide, and the encoding is reversible without keeping a map of every activity seen.
 */
const DRAWING_ID_STRIDE = 2 ** 32;
const drawingSourceIndexes = new Map<TimelineSourceId, number>();
const drawingSourceIds: TimelineSourceId[] = [];

export function getActivityDrawingId(ref: AnalysisActivityRef): number {
  let index = drawingSourceIndexes.get(ref.sourceId);
  if (index === undefined) {
    index = drawingSourceIds.length;
    drawingSourceIds.push(ref.sourceId);
    drawingSourceIndexes.set(ref.sourceId, index);
  }
  return (index + 1) * DRAWING_ID_STRIDE + ref.activityId;
}

export function getActivityRefFromDrawingId(drawingId: number): AnalysisActivityRef | null {
  const index = Math.floor(drawingId / DRAWING_ID_STRIDE) - 1;
  const sourceId = drawingSourceIds[index];
  return index >= 0 && sourceId !== undefined ? { activityId: drawingId % DRAWING_ID_STRIDE, sourceId } : null;
}

/** The activity a timeline span is, when it comes from an analysis source. */
export function getActivityRefFromSpan(span: Span): AnalysisActivityRef | null {
  return span.sourceId !== undefined && span.sourceActivityId !== undefined
    ? { activityId: span.sourceActivityId, sourceId: span.sourceId }
    : null;
}

/* Adapters: native activities as the timeline's Span view model, keeping their source identity. */

export type ImportedActivityRecord = {
  category: string | null;
  end_time: string;
  id: number;
  name: string;
  parameters: Record<string, unknown>;
  /** The id of the record the product names as its parent, when that resolves to a record of the same revision. */
  parentId?: number;
  /** What the adapter says the record is (`metadata.recordKind`). */
  record_kind?: unknown;
  /** The product's own key for it. */
  source_key?: string;
  start_time: string;
  /** Its place among its parent's steps, when the product gives one. */
  step?: number | null;
  type: string;
};

/**
 * What a record is, in an operator's terms: a plan's directive and a simulation's span are told apart from each other
 * and from what a product reported or a sequence authored, so nothing is called just "Activity" when more is known.
 */
export function getRecordKindLabel(
  sourceKind: AnalysisSourceBinding['kind'],
  recordKind?: unknown,
  type?: string,
): string {
  if (sourceKind === 'plan') {
    return 'Plan directive';
  }
  if (sourceKind === 'simulation') {
    return 'Simulated span';
  }
  switch (recordKind) {
    case 'authored_step':
      return 'Authored command';
    case 'authored_sequence':
      return 'Authored sequence';
    case 'sequence_command':
      return 'Reported command';
    case 'sequence_history':
      return 'Reported sequence';
    case 'timed_record':
    case 'before_timed_record':
      return type === 'ERROR' ? 'Reported error' : type === 'WARNING' ? 'Reported warning' : 'Reported record';
    default:
      return 'Imported activity';
  }
}

export function importedActivityToSpan(sourceId: TimelineSourceId, activity: ImportedActivityRecord): Span {
  const startMs = Date.parse(activity.start_time);
  const endMs = Date.parse(activity.end_time);
  return {
    // Parameters are where activity filters look for argument values (Parameter filters).
    attributes: { arguments: activity.parameters as Span['attributes']['arguments'], computedAttributes: {} },
    dataset_id: -1,
    duration: '',
    durationMs: endMs - startMs,
    endMs,
    name: activity.name,
    parent_id:
      activity.parentId === undefined ? null : getActivityDrawingId({ activityId: activity.parentId, sourceId }),
    recordKind: getRecordKindLabel('imported', activity.record_kind, activity.type),
    sourceActivityId: activity.id,
    sourceId,
    span_id: getActivityDrawingId({ activityId: activity.id, sourceId }),
    ...(activity.source_key !== undefined ? { sourceKey: activity.source_key } : {}),
    startMs,
    start_offset: '',
    ...(typeof activity.step === 'number' ? { step: activity.step } : {}),
    type: activity.type,
  };
}

/**
 * A simulation span as an activity of the analysis source that reads it. Its hierarchy is kept (parents are
 * re-identified in the same source); its directive link is dropped, since an analysis has no directives to draw
 * it with and the id would be read as one of the page's directives.
 */
export function simulationSpanToActivity(sourceId: TimelineSourceId, span: Span): Span {
  const { directiveId: _directiveId, ...attributes } = span.attributes;
  return {
    ...span,
    attributes,
    parent_id: span.parent_id === null ? null : getActivityDrawingId({ activityId: span.parent_id, sourceId }),
    recordKind: 'Simulated span',
    sourceActivityId: span.span_id,
    sourceId,
    span_id: getActivityDrawingId({ activityId: span.span_id, sourceId }),
  };
}

/**
 * A plan's current directive as an activity of the analysis source that reads the plan. It starts at its
 * anchor-resolved approximate start (the plan's own anchoring, from activity_directive_extended) and has no end:
 * it is drawn as a point, never with an invented duration.
 */
export function planDirectiveToSpan(sourceId: TimelineSourceId, directive: AnalysisPlanDirective): Span {
  const startMs = Date.parse(directive.approximate_start_time);
  return {
    attributes: {
      arguments: directive.arguments as Span['attributes']['arguments'],
      computedAttributes: {},
    },
    dataset_id: -1,
    duration: '',
    durationMs: 0,
    endMs: startMs,
    endUnknown: true,
    name: directive.name || directive.type,
    parent_id: null,
    recordKind: 'Plan directive',
    sourceActivityId: directive.id,
    sourceId,
    span_id: getActivityDrawingId({ activityId: directive.id, sourceId }),
    startMs,
    start_offset: '',
    type: directive.type,
  };
}

const EXTERNAL_EVENT_ID_BASE = 2 ** 31;

/**
 * A plan's activity ids are its directives' (below 2^31). An external event has none of its own (it is identified by
 * derivation group, source key, type and key), so it gets a stable id at or above 2^31 from that identity: it never
 * collides with a directive, fits the drawing ids, and is the same every time the event is read.
 * ponytail: 31-bit FNV-1a; a collision between two events of one plan is possible in principle, not at plan scale.
 */
export function getExternalEventId(
  event: Pick<AnalysisExternalEvent, 'derivation_group_name' | 'event_key' | 'event_type_name' | 'source_key'>,
): number {
  const text = `${event.derivation_group_name}\u0000${event.source_key}\u0000${event.event_type_name}\u0000${event.event_key}`;
  let hash = 0x811c9dc5;
  // By code point, as merlin.analysis_external_event_id does (UTF-16 units would differ outside the BMP).
  for (const char of text) {
    hash ^= char.codePointAt(0) as number;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return EXTERNAL_EVENT_ID_BASE + (hash & 0x7fffffff);
}

/** Whether a plan source's activity id is an external event's (see getExternalEventId), not a directive's. */
export function isExternalEventId(activityId: number): boolean {
  return activityId >= EXTERNAL_EVENT_ID_BASE;
}

/** An external event of a plan's linked derivation groups, as an activity of the analysis source that reads the plan. */
export function externalEventToSpan(sourceId: TimelineSourceId, event: AnalysisExternalEvent): Span {
  const startMs = Date.parse(event.start_time);
  const durationMs = getIntervalInMs(event.duration);
  const id = getExternalEventId(event);
  return {
    attributes: { arguments: event.attributes as Span['attributes']['arguments'], computedAttributes: {} },
    dataset_id: -1,
    duration: '',
    durationMs,
    endMs: startMs + durationMs,
    name: event.event_key,
    parent_id: null,
    recordKind: 'External event',
    sourceActivityId: id,
    sourceId,
    sourceKey: `${event.derivation_group_name}/${event.source_key}/${event.event_key}`,
    span_id: getActivityDrawingId({ activityId: id, sourceId }),
    startMs,
    start_offset: '',
    type: event.event_type_name,
  };
}

/* The analysis definition. */

export function createAnalysisDefinition(): AnalysisDefinition {
  const { definition } = generateDefaultView();
  return {
    sources: [],
    version: 1,
    view: {
      ...definition,
      plan: { ...definition.plan, timelines: [createTimeline([], { marginLeft: 250, marginRight: 30 })] },
    },
  };
}

/**
 * Carries a plan's view into a new analysis: its timelines, with layers rebound to the analysis's sources. A layer on
 * `imported:<plan_source id>` gets a binding to that plan source's revision; an unbound activity layer reads the
 * plan (`planSourceId`), an unbound resource layer the simulation (`simulationSourceId`), when there is one.
 * Returns the bindings it added and the rebound timelines.
 */
export function bindViewToAnalysisSources(
  timelines: Timeline[],
  planSources: { id: number; source_revision: { id: number; source?: { id: number; name: string } } }[],
  bindings: AnalysisSourceBinding[],
  planSourceId: TimelineSourceId,
  simulationSourceId: TimelineSourceId | null,
): { bindings: AnalysisSourceBinding[]; timelines: Timeline[] } {
  const result = [...bindings];
  const importedIds = new Map<TimelineSourceId, TimelineSourceId>();
  const rebind = (layer: Timeline['rows'][number]['layers'][number]) => {
    const sourceId = layer.sourceId;
    if (sourceId?.startsWith('imported:')) {
      if (!importedIds.has(sourceId)) {
        const planSource = planSources.find(({ id }) => `imported:${id}` === sourceId);
        if (!planSource) {
          return layer; // ponytail: a plan source since removed keeps its id and draws nothing
        }
        const id = getNextAnalysisSourceId(result);
        const { source } = planSource.source_revision;
        result.push({
          id,
          kind: 'imported',
          revisionId: planSource.source_revision.id,
          sourceId: source?.id,
          sourceName: source?.name,
        });
        importedIds.set(sourceId, id);
      }
      return { ...layer, sourceId: importedIds.get(sourceId) };
    }
    // New Plan layers name the Plan's own source explicitly; it means the same as no source.
    if (!sourceId || sourceId === PLAN_SOURCE_ID) {
      const id = isActivityLayer(layer) ? planSourceId : simulationSourceId;
      return id ? { ...layer, sourceId: id } : layer;
    }
    return layer;
  };
  const rebound = timelines.map(timeline => ({
    ...timeline,
    rows: timeline.rows.map(row => ({ ...row, layers: row.layers.map(rebind) })),
  })) as Timeline[];
  return { bindings: result, timelines: rebound };
}

/** A source id not yet used in the analysis. Layers store it, so it is never reused for another source. */
export function getNextAnalysisSourceId(bindings: AnalysisSourceBinding[]): TimelineSourceId {
  const used = bindings.map(binding => Number(/^source-(\d+)$/.exec(binding.id)?.[1] ?? 0));
  return `source-${Math.max(0, ...used) + 1}`;
}

export function isSameAnalysisSource(a: AnalysisSourceTarget, b: AnalysisSourceTarget): boolean {
  if (a.kind === 'imported' && b.kind === 'imported') {
    return a.revisionId === b.revisionId;
  }
  if (a.kind === 'simulation' && b.kind === 'simulation') {
    return a.simulationDatasetId === b.simulationDatasetId;
  }
  return a.kind === 'plan' && b.kind === 'plan' && a.planId === b.planId;
}

/**
 * The analysis "Analyze" should return to, or null when it should make one: an analysis that binds every one of
 * `wanted`. Analyze never adds to or swaps what an analysis binds, so a plan's analysis that lacks the simulation
 * asked for does not match.
 *
 * Someone else's analysis is not a default for working: only the user's own analyses are candidates. They are used
 * (read-only, as opened) only when the user cannot create one themselves. The most recently updated wins; ties go to
 * the newest id, so the choice is the same every time.
 */
export function findAnalysisToReopen(
  analyses: AnalysisSourceUsage[],
  wanted: AnalysisSourceTarget[],
  who: { canCreate: boolean; userId: UserId | undefined },
): AnalysisSourceUsage | null {
  const matching = analyses.filter(({ sources }) =>
    wanted.every(target => (sources ?? []).some(binding => isSameAnalysisSource(binding, target))),
  );
  const own = matching.filter(({ owner }) => who.userId !== undefined && owner === who.userId);
  const candidates = own.length || who.canCreate ? own : matching;
  return [...candidates].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || b.id - a.id)[0] ?? null;
}

/**
 * An imported revision with more activities than this does not get a starting activity row: one row would load them
 * all into the browser. Its resources and activity types are added from the Sources browser instead.
 */
export const INITIAL_ACTIVITY_ROW_LIMIT = 10000;

/** How merlin.analysis_activity names a binding's activities: its source_kind and source_ref. */
export function getAnalysisActivitySource(binding: AnalysisSourceTarget): {
  source_kind: AnalysisActivityRow['source_kind'];
  source_ref: number;
} {
  switch (binding.kind) {
    case 'imported':
      return { source_kind: 'revision', source_ref: binding.revisionId };
    case 'simulation':
      return { source_kind: 'simulation', source_ref: binding.simulationDatasetId };
    case 'plan':
      return { source_kind: 'plan', source_ref: binding.planId };
  }
}

/** The data a binding reads, e.g. "revision:110": the same for two bindings of the same data, and it changes when a binding is pointed at other data. */
export function getSourceIdentity(target: AnalysisSourceTarget): string {
  const { source_kind, source_ref } = getAnalysisActivitySource(target);
  return `${source_kind}:${source_ref}`;
}

/** The binding a row of merlin.analysis_activity comes from. */
export function getAnalysisActivityRowRef(
  bindings: AnalysisSourceBinding[],
  row: Pick<AnalysisActivityRow, 'activity_id' | 'source_kind' | 'source_ref'>,
): AnalysisActivityRef | null {
  const binding = bindings.find(binding => {
    const source = getAnalysisActivitySource(binding);
    return source.source_kind === row.source_kind && source.source_ref === row.source_ref;
  });
  return binding ? { activityId: row.activity_id, sourceId: binding.id } : null;
}

/* The activity table's server-side query. */

export type AnalysisActivityFilter = {
  /** Only these sources; null for every source of the analysis. */
  sourceIds: TimelineSourceId[] | null;
  text: string;
  /** Only activities that overlap this window (a plan directive, which has no end, by its start); null for all. */
  timeRange?: TimeRange | null;
  /** Only these types; null for every type. */
  types: string[] | null;
};

/** The merlin.analysis_activity filter for the analysis's sources and the table's filters. */
export function getAnalysisActivityWhere(
  bindings: AnalysisSourceBinding[],
  filter: AnalysisActivityFilter,
): Record<string, unknown> {
  const sources = bindings
    .filter(binding => !filter.sourceIds || filter.sourceIds.includes(binding.id))
    .map(binding => {
      const { source_kind, source_ref } = getAnalysisActivitySource(binding);
      return { source_kind: { _eq: source_kind }, source_ref: { _eq: source_ref } };
    });
  const conditions: Record<string, unknown>[] = [
    // No sources selected matches nothing, not everything.
    sources.length ? { _or: sources } : { activity_id: { _is_null: true } },
  ];
  if (filter.types) {
    conditions.push({ type: { _in: filter.types } });
  }
  if (filter.timeRange) {
    const start = new Date(filter.timeRange.start).toISOString();
    const end = new Date(filter.timeRange.end).toISOString();
    conditions.push({
      _or: [
        { end_time: { _gte: start }, start_time: { _lte: end } },
        { end_time: { _is_null: true }, start_time: { _gte: start, _lte: end } },
      ],
    });
  }
  const text = filter.text.trim();
  if (text) {
    const pattern = `%${text.replace(/[\\%_]/g, character => `\\${character}`)}%`;
    conditions.push({ _or: [{ name: { _ilike: pattern } }, { type: { _ilike: pattern } }] });
  }
  return { _and: conditions };
}

/** Start time order, with a stable tiebreak so paging never repeats or skips a row. */
export function getAnalysisActivityOrderBy(direction: 'asc' | 'desc'): Record<string, 'asc' | 'desc'>[] {
  return [{ start_time: direction }, { source_kind: direction }, { source_ref: direction }, { activity_id: direction }];
}

/**
 * What rows key a source's subscriptions by while it has no data to serve: null while it loads, the reason once it
 * is known to be unavailable, so rows replace the "loading" subscription they took first.
 */
function getUnavailableKey(unavailableReason: string | undefined): string | null {
  return unavailableReason ? `unavailable:${unavailableReason}` : null;
}

/**
 * Rows ordered before `row` under getAnalysisActivityOrderBy(direction): counting them gives `row`'s index, so the
 * table can scroll to an activity selected elsewhere.
 */
export function getAnalysisActivitiesBeforeWhere(
  row: Pick<AnalysisActivityRow, 'activity_id' | 'source_kind' | 'source_ref' | 'start_time'>,
  direction: 'asc' | 'desc',
): Record<string, unknown> {
  const before = direction === 'asc' ? '_lt' : '_gt';
  return {
    _or: [
      { start_time: { [before]: row.start_time } },
      { source_kind: { [before]: row.source_kind }, start_time: { _eq: row.start_time } },
      {
        source_kind: { _eq: row.source_kind },
        source_ref: { [before]: row.source_ref },
        start_time: { _eq: row.start_time },
      },
      {
        activity_id: { [before]: row.activity_id },
        source_kind: { _eq: row.source_kind },
        source_ref: { _eq: row.source_ref },
        start_time: { _eq: row.start_time },
      },
    ],
  };
}

/* Sources. Each binding becomes an ordinary TimelineSource, so the timeline, browser and editor need no Analysis. */

export type AnalysisSourcesInput = {
  bindings: AnalysisSourceBinding[];
  /** True while the revisions and datasets the bindings name are loading. */
  loading: boolean;
  /** The external events of each bound plan's linked derivation groups, by plan id; absent while they load. */
  planExternalEvents?: Record<number, AnalysisExternalEvent[]>;
  /** Directive types present in each bound plan now, by plan id; absent while they load. */
  planTypeCounts: Record<number, { count: number; name: string }[]>;
  plans: AnalysisPlan[];
  /** True while the bound plans are loading (they are subscribed to, separately from revisions and datasets). */
  plansLoading: boolean;
  revisions: AnalysisSourceRevision[];
  simulationDatasets: AnalysisSimulationDataset[];
  /** Span types present in each simulation dataset, by simulation dataset id; absent while they load. */
  simulationTypeCounts: Record<number, { count: number; name: string }[]>;
  /** What is left of each source (by id) whose bound revision is gone; null when the source is gone too. */
  sourceRecovery?: Record<number, SourceRecovery | null>;
  /** A profile of an external dataset uploaded for a simulation, from `start` (its plan's start plus its offset). */
  subscribeExternalDatasetProfile?: (
    datasetId: number,
    name: string,
    start: string,
    context: TimelineResourceSubscriptionContext,
  ) => TimelineResourceSubscription;
  subscribeImportedActivities: (
    binding: AnalysisSourceBinding,
    revision: AnalysisSourceRevision,
    request: TimelineActivityRequest,
    context: TimelineResourceSubscriptionContext,
  ) => TimelineActivitySubscription;
  subscribeImportedResource: (
    binding: AnalysisSourceBinding,
    revision: AnalysisSourceRevision,
    resource: SourceResource,
    context: TimelineResourceSubscriptionContext,
  ) => TimelineResourceSubscription;
  subscribePlanActivities: (
    binding: AnalysisSourceBinding,
    plan: AnalysisPlan,
    context: TimelineResourceSubscriptionContext,
  ) => TimelineActivitySubscription;
  /** A profile of one of a plan's external datasets, at the plan's start plus the dataset's offset. */
  subscribePlanExternalProfile?: (
    binding: AnalysisSourceBinding,
    plan: AnalysisPlan,
    dataset: AnalysisPlanExternalDataset,
    name: string,
    context: TimelineResourceSubscriptionContext,
  ) => TimelineResourceSubscription;
  subscribeSimulationActivities: (
    binding: AnalysisSourceBinding,
    dataset: AnalysisSimulationDataset,
    context: TimelineResourceSubscriptionContext,
  ) => TimelineActivitySubscription;
  subscribeSimulationProfile: (
    binding: AnalysisSourceBinding,
    dataset: AnalysisSimulationDataset,
    name: string,
    context: TimelineResourceSubscriptionContext,
  ) => TimelineResourceSubscription;
};

/** A date as people say it: "Oct 3, 2026". */
function formatDate(time: string): string {
  return new Date(time).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    year: 'numeric',
  });
}

/**
 * Which version of its source a revision is, in people's terms: the product's own generation date when the format
 * records one, else when it was imported. Never the database id.
 */
export function getRevisionVersionLabel(revision: SourceRevisionSummary): string {
  const product = revision.metadata?.product;
  if (product?.generatedAt) {
    return `${formatDate(product.generatedAt)} product${product.productVersion ? ` (${product.productVersion})` : ''}`;
  }
  // Imports of one source on one day are common (a re-run, a fix): the time tells them apart.
  return `Imported ${formatRequestTime(revision)}`;
}

export function formatRequestTime(revision: { requested_at: string }): string {
  return `${formatDate(revision.requested_at)}, ${revision.requested_at.slice(11, 16)} UTC`;
}

/** The newer successful revision of the same source, if the bound one isn't the newest. */
export function getNewerRevision(revision: AnalysisSourceRevision | undefined): SourceRevisionSummary | null {
  const latest = revision?.source.latest[0];
  return latest && latest.id > revision.id ? latest : null;
}

/** A revision's contents in a line, or its import status while it has none. */
export function getRevisionSummary(revision: {
  activity_types_aggregate: { aggregate: { sum: { count: number | null } | null } | null };
  coverage_end: string | null;
  coverage_start: string | null;
  resources_aggregate: { aggregate: { count: number } | null };
  status: string;
}): string {
  if (revision.status !== 'success') {
    // Pending: no worker has claimed it yet (none is running, or the one that is is busy with another import).
    return revision.status === 'failed'
      ? 'Import failed'
      : revision.status === 'pending'
        ? 'Waiting for an ingest worker…'
        : 'Importing…';
  }
  const resources = revision.resources_aggregate.aggregate?.count ?? 0;
  const activities = revision.activity_types_aggregate.aggregate?.sum?.count ?? 0;
  return `${resources.toLocaleString()} resources · ${activities.toLocaleString()} activities · ${formatRange(revision.coverage_start, revision.coverage_end)}`;
}

/** The analyses using each imported revision, by revision id. */
export function getRevisionUsage(analyses: AnalysisSourceUsage[]): Record<number, AnalysisSourceUsage[]> {
  const usage: Record<number, AnalysisSourceUsage[]> = {};
  analyses.forEach(analysis =>
    new Set((analysis.sources ?? []).flatMap(b => (b.kind === 'imported' ? [b.revisionId] : []))).forEach(id => {
      usage[id] = [...(usage[id] ?? []), analysis];
    }),
  );
  return usage;
}

/**
 * The analyses that reference a source: through any of its revisions, or (for a revision since deleted) through the
 * source itself. Each analysis once, by id, however many revisions or bindings it uses. Deleting the source affects
 * exactly these; deleting one revision affects only `getRevisionUsage` of it.
 */
export function getSourceUsage(
  source: { id: number; revisions: { id: number }[] },
  analyses: AnalysisSourceUsage[],
): AnalysisSourceUsage[] {
  const revisionIds = new Set(source.revisions.map(({ id }) => id));
  const found = new Map<number, AnalysisSourceUsage>();
  analyses.forEach(analysis => {
    const uses = (analysis.sources ?? []).some(
      binding => binding.kind === 'imported' && (binding.sourceId === source.id || revisionIds.has(binding.revisionId)),
    );
    if (uses && !found.has(analysis.id)) {
      found.set(analysis.id, analysis);
    }
  });
  return [...found.values()];
}

/**
 * What deleting source data does to what uses it, for the confirmation: the analyses that read it show it as
 * unavailable, and a plan that has it attached loses it (the link goes with the revision) and its timeline layers
 * show it as unavailable. Never says "unused" of something a plan or an analysis uses.
 */
export function getSourceDeletionImpact(analyses: { name: string }[], plans: { name: string }[]): string {
  const names = (list: { name: string }[]) => list.map(({ name }) => `"${name}"`).join(', ');
  const parts: string[] = [];
  if (analyses.length) {
    parts.push(
      `${analyses.length === 1 ? 'The analysis' : 'These analyses'} ${names(analyses)} will show it as unavailable.`,
    );
  }
  if (plans.length) {
    parts.push(
      `${plans.length === 1 ? 'The plan' : 'These plans'} ${names(plans)} ${plans.length === 1 ? 'has' : 'have'} it attached and will lose it: layers that read it will show it as unavailable, and adding it again will not reconnect them.`,
    );
  }
  return parts.length ? parts.join(' ') : 'No analysis or plan uses it.';
}

/**
 * Records, on each imported binding, which source its revision belongs to (and that source's name), from the
 * revisions just read. Bindings saved before that was recorded gain it, and renamed sources are followed. Returns
 * `bindings` itself when nothing changes.
 */
export function withSourceIdentity(
  bindings: AnalysisSourceBinding[],
  revisions: { id: number; source: { id: number; name: string } }[],
): AnalysisSourceBinding[] {
  let changed = false;
  const next = bindings.map(binding => {
    const revision = binding.kind === 'imported' ? revisions.find(({ id }) => id === binding.revisionId) : undefined;
    if (
      binding.kind !== 'imported' ||
      !revision ||
      (binding.sourceId === revision.source.id && binding.sourceName === revision.source.name)
    ) {
      return binding;
    }
    changed = true;
    return { ...binding, sourceId: revision.source.id, sourceName: revision.source.name };
  });
  return changed ? next : bindings;
}

/** How an import started from an analysis stands, read from the Sources library (which updates live). */
export type ImportOutcome =
  | { message: string; state: 'failed' }
  | { sourceName: string; state: 'success' }
  /** `present`: the library has listed the revision (it may not have yet, just after the import was requested). */
  | { present: boolean; state: 'importing' };

export function getImportOutcome(
  library: {
    id: number;
    name: string;
    revisions: { error?: { message?: string } | null; id: number; status: string }[];
  }[],
  imported: { revisionId: number; seen?: boolean; sourceId: number },
): ImportOutcome {
  const source = library.find(({ id }) => id === imported.sourceId);
  const revision = source?.revisions.find(({ id }) => id === imported.revisionId);
  if (!source || !revision) {
    // Not listed yet is not deleted: only a revision the library has listed before can have been deleted since.
    return imported.seen
      ? { message: 'The import was deleted before it finished.', state: 'failed' }
      : { present: false, state: 'importing' };
  }
  switch (revision.status) {
    case 'success':
      return { sourceName: source.name, state: 'success' };
    case 'failed':
      return { message: revision.error?.message || 'The import failed.', state: 'failed' };
    default:
      return { present: true, state: 'importing' };
  }
}

/**
 * The adapters a running ingest worker can use: those it reported in the last two minutes (workers report every few
 * seconds while ingesting and every 30 s while idle). An uninstalled adapter keeps its catalog row but stops being seen.
 */
export function getAvailableAdapters<T extends { last_seen_at: string }>(adapters: T[], now: number = Date.now()): T[] {
  return adapters.filter(({ last_seen_at }) => now - Date.parse(last_seen_at) < 2 * 60_000);
}

/**
 * A source's revisions (newest first) as people use them: `usable` is the latest successful one, `pending` the newer
 * attempts still importing or failed, shown but not in the way, and `older` everything before `usable`.
 */
export function splitSourceRevisions<T extends { status: string }>(
  revisions: T[],
): { older: T[]; pending: T[]; usable: T | null } {
  const index = revisions.findIndex(({ status }) => status === 'success');
  if (index < 0) {
    return { older: [], pending: revisions, usable: null };
  }
  return { older: revisions.slice(index + 1), pending: revisions.slice(0, index), usable: revisions[index] };
}

/**
 * What a binding is, in people's terms: `name` is the thing (a source, a plan), `version` which of its data
 * (a revision, a simulation, its current activities), and `label` the short form rows, the table and tooltips use:
 * the analysis's alias when it has one.
 */
export function getAnalysisSourceNames(
  binding: AnalysisSourceBinding,
  details: {
    dataset?: AnalysisSimulationDataset;
    plan?: AnalysisPlan;
    revision?: AnalysisSourceRevision;
    /** What is left of the source when the bound revision is gone: null when the source is gone too. */
    source?: SourceRecovery | null;
  },
): { label: string; name: string; version: string } {
  let name: string;
  let version: string;
  let short: string;
  const file = getWorkspaceFileSnapshot(details.revision);
  if (binding.kind === 'imported' && file && details.revision) {
    // A SeqDev file: its sequence's name, with the workspace it is in (the full path is in its details).
    name = getAuthoredMission(details.revision)?.sequenceId ?? file.path.split('/').pop()?.split('.')[0] ?? file.path;
    version = getRevisionVersionLabel(details.revision);
    short = file.workspaceName;
  } else if (binding.kind === 'imported') {
    name = details.revision?.source.name ?? details.source?.name ?? binding.sourceName ?? 'Imported source';
    version = details.revision
      ? getRevisionVersionLabel(details.revision)
      : details.source
        ? 'Revision deleted'
        : details.source === null
          ? 'Source deleted'
          : 'Unavailable revision';
    // Captions keep the date only; the details and the Sources panel show the full version.
    short = details.revision
      ? version
          .replace(/ product.*$/, '')
          .replace(/^Imported /, '')
          .replace(/, \d\d:\d\d UTC$/, '')
      : version;
  } else if (binding.kind === 'simulation') {
    name = details.dataset?.simulation?.plan?.name ?? 'Simulation';
    version = `Simulation ${binding.simulationDatasetId}`;
    short = version;
  } else {
    name = details.plan?.name ?? 'Plan';
    version = 'Current activities';
    short = 'Current';
  }
  return { label: binding.label || `${name} · ${short}`, name, version };
}

export function createAnalysisSources(input: AnalysisSourcesInput): TimelineSource[] {
  const sources = input.bindings.map(binding => {
    switch (binding.kind) {
      case 'imported':
        return createImportedRevisionSource(
          input,
          binding,
          input.revisions.find(revision => revision.id === binding.revisionId),
          binding.sourceId === undefined ? undefined : input.sourceRecovery?.[binding.sourceId],
        );
      case 'simulation':
        return createSimulationDatasetSource(
          input,
          binding,
          input.simulationDatasets.find(dataset => dataset.id === binding.simulationDatasetId),
        );
      case 'plan':
        return createPlanSource(
          input,
          binding,
          input.plans.find(plan => plan.id === binding.planId),
        );
    }
  });
  // Two revisions of one source imported the same day share a short label: tell them apart by import time.
  return sources.map((source, index) => {
    const binding = input.bindings[index];
    if (
      binding.kind !== 'imported' ||
      binding.label ||
      sources.filter(({ label }) => label === source.label).length < 2
    ) {
      return source;
    }
    const revision = input.revisions.find(({ id }) => id === binding.revisionId);
    const file = getWorkspaceFileSnapshot(revision);
    const twin =
      file &&
      input.revisions.find(other => {
        const otherFile = getWorkspaceFileSnapshot(other);
        return (
          other !== revision &&
          otherFile &&
          otherFile.workspaceId !== file.workspaceId &&
          otherFile.workspaceName === file.workspaceName
        );
      });
    if (file && twin) {
      // Two workspaces of one name: the workspace's id tells them apart.
      return { ...source, label: `${source.label} (workspace ${file.workspaceId})` };
    }
    const { name, version } = getAnalysisSourceNames(binding, {
      revision,
      source: binding.sourceId === undefined ? undefined : input.sourceRecovery?.[binding.sourceId],
    });
    return { ...source, label: `${name} · ${version.replace(/^Imported /, '')}` };
  });
}

/**
 * A plan, live: its current activity directives, and what the plan has from outside it: the external events of the
 * derivation groups linked to it (as records of their own kind), and the profiles of its plan-level external datasets
 * (its external resources). Read-only. Its simulations' results are their own sources.
 */
function createPlanSource(
  input: AnalysisSourcesInput,
  binding: AnalysisSourceBinding,
  plan: AnalysisPlan | undefined,
): TimelineSource {
  const sourceId = binding.id;
  const { label, name } = getAnalysisSourceNames(binding, { plan });
  const unavailableReason = !plan && !input.plansLoading ? 'The plan no longer exists' : undefined;
  const present = plan ? input.planTypeCounts[plan.id] : undefined;
  const events = plan ? input.planExternalEvents?.[plan.id] : undefined;
  const modelTypes = plan?.mission_model?.activity_types ?? [];
  const directiveCount = present?.reduce((total, type) => total + type.count, 0);
  // Each external event type, by derivation group, with how many events.
  const eventGroups = new Map<string, Map<string, number>>();
  (events ?? []).forEach(event => {
    const types = eventGroups.get(event.derivation_group_name) ?? new Map<string, number>();
    types.set(event.event_type_name, (types.get(event.event_type_name) ?? 0) + 1);
    eventGroups.set(event.derivation_group_name, types);
  });
  const eventTypes = [...new Set((events ?? []).map(event => event.event_type_name))].sort();
  // A profile name is the plan's resource; the first dataset that has it provides it.
  const datasets = plan?.external_datasets ?? [];
  const profiles = new Map<string, { dataset: AnalysisPlanExternalDataset; type: ResourceType }>();
  datasets.forEach(dataset =>
    dataset.dataset?.profiles.forEach(profile => {
      if (!profiles.has(profile.name)) {
        profiles.set(profile.name, { dataset, type: { name: profile.name, schema: profile.type.schema } });
      }
    }),
  );
  const catalog = [...profiles.values()].map(({ type }) => type);
  return {
    browserNodes: [
      {
        badge: directiveCount !== undefined ? `${directiveCount}` : undefined,
        children: (present ?? []).map(type =>
          activityItemNode(sourceId, type.name, type.count, ['directive', 'directives']),
        ),
        emptyMessage: unavailableReason ?? (present ? 'No activity directives' : 'Loading…'),
        id: `${sourceId}/activities`,
        kind: 'group',
        label: 'Activity directives',
        tooltip: present ? summarizeActivityTypes(present, ['directive', 'directives']).tooltip : undefined,
      },
      ...(eventGroups.size
        ? [
            {
              badge: `${events?.length ?? 0}`,
              children: [...eventGroups.entries()].map(([group, types]) => ({
                badge: `${[...types.values()].reduce((total, count) => total + count, 0)}`,
                children: [...types.entries()]
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([type, count]) => activityItemNode(sourceId, type, count, ['event', 'events'])),
                id: `${sourceId}/events/${group}`,
                kind: 'group' as const,
                label: group,
                tooltip: 'Derivation group linked to the plan',
              })),
              id: `${sourceId}/events`,
              kind: 'group' as const,
              label: 'External events',
              tooltip: 'External events of the derivation groups linked to the plan, as derived',
            },
          ]
        : []),
      ...(catalog.length
        ? [
            {
              badge: `${catalog.length}`,
              children: catalog.map(resourceType => ({
                action: { item: resourceType, sourceId, typeName: 'resource' as const },
                id: `${sourceId}/resource/${resourceType.name}`,
                kind: 'item' as const,
                label: resourceType.name,
                tags: [resourceType.schema.type],
                tooltip: `External dataset ${profiles.get(resourceType.name)?.dataset.dataset_id}`,
              })),
              id: `${sourceId}/resources`,
              kind: 'group' as const,
              label: 'External resources',
              tooltip: "Profiles of the plan's external datasets (not tied to a simulation)",
            },
          ]
        : []),
    ],
    description: plan
      ? `Plan "${name}": its current activity directives, live`
      : `Plan ${binding.kind === 'plan' ? binding.planId : ''}`,
    group: 'Plans',
    id: sourceId,
    intervals: {
      catalog: [
        ...(present ?? []).map(type => modelTypes.find(({ name }) => name === type.name) ?? toIntervalType(type.name)),
        ...eventTypes.map(type => toIntervalType(type)),
      ],
      hasDirectives: false,
      loading: input.plansLoading || !present,
      present: [
        ...(present ?? []),
        ...eventTypes.map(type => ({
          count: (events ?? []).filter(event => event.event_type_name === type).length,
          name: type,
        })),
      ],
      // The plan changes under the key: its subscription follows it, so rows never need to resubscribe.
      revisionKey: plan ? `plan:${plan.id}` : getUnavailableKey(unavailableReason),
      subscribe: (_request, context) =>
        plan
          ? input.subscribePlanActivities(binding, plan, context)
          : createStaticActivitySubscription(unavailableReason ?? '', input.plansLoading),
    },
    kind: 'plan',
    label,
    ...(catalog.length && plan
      ? {
          resources: {
            catalog,
            loading: false,
            revisionKey: `plan:${plan.id}`,
            subscribe: (resourceName: string, context: TimelineResourceSubscriptionContext) => {
              const found = profiles.get(resourceName);
              return found && input.subscribePlanExternalProfile
                ? input.subscribePlanExternalProfile(binding, plan, found.dataset, resourceName, context)
                : createStaticResourceSubscription({
                    error: `${resourceName} is not in this plan's external datasets`,
                    loading: false,
                    resource: null,
                  });
            },
          },
        }
      : {}),
  };
}

function createImportedRevisionSource(
  input: AnalysisSourcesInput,
  binding: AnalysisSourceBinding,
  revision: AnalysisSourceRevision | undefined,
  recovery: SourceRecovery | null | undefined,
): TimelineSource {
  const sourceId = binding.id;
  const { label } = getAnalysisSourceNames(binding, { revision, source: recovery });
  const ready = revision?.status === 'success';
  const unavailableReason = !revision
    ? input.loading
      ? undefined
      : recovery === null
        ? 'The source was deleted'
        : recovery
          ? 'This revision was deleted'
          : 'The revision no longer exists'
    : ready
      ? undefined
      : revision.status === 'failed'
        ? 'The import failed'
        : 'The source is still being imported';
  const resources = revision?.resources ?? [];
  const activityTypes = revision?.activity_types ?? [];
  const resourcesByKey = new Map(resources.map(resource => [resource.key, resource]));
  return {
    browserNodes: (
      [
        {
          badge: `${resources.length}`,
          children: groupBrowserNodes(
            sourceId,
            'resource',
            resources,
            resource => resource.category,
            resource => ({
              action: { item: { name: resource.key, schema: resource.schema }, sourceId, typeName: 'resource' },
              id: `${sourceId}/resource/${resource.key}`,
              kind: 'item',
              label: resource.key,
              tags: [resource.schema.type],
              tooltip: [resource.units, resource.sample_count !== null ? `${resource.sample_count} samples` : null]
                .filter(Boolean)
                .join(' · '),
            }),
            members => ({ badge: `${members.length}`, tooltip: countLabel(members.length, 'resource', 'resources') }),
          ),
          emptyMessage: unavailableReason ?? (input.loading ? 'Loading…' : 'No resources'),
          id: `${sourceId}/resources`,
          kind: 'group',
          label: 'Resources',
          tooltip: countLabel(resources.length, 'resource', 'resources'),
        },
        {
          badge: `${activityTypes.reduce((total, type) => total + type.count, 0)}`,
          children: groupBrowserNodes(
            sourceId,
            'activity',
            activityTypes,
            type => type.category,
            type => activityItemNode(sourceId, type.type, type.count),
            summarizeActivityTypes,
          ),
          emptyMessage: unavailableReason ?? (input.loading ? 'Loading…' : 'No activities'),
          id: `${sourceId}/activities`,
          kind: 'group',
          // An authored sequence's records that have an absolute time: its steps, and the sequence's own interval.
          label: getAuthoredMission(revision) ? 'Timeline records' : 'Activities',
          tooltip: summarizeActivityTypes(activityTypes).tooltip,
        },
      ] as SourceBrowserNode[]
    ).filter(node => node.children?.length || !revision || !ready || input.loading),
    description: revision
      ? `${revision.source.name} · ${getRevisionVersionLabel(revision)} · ${formatRange(revision.coverage_start, revision.coverage_end)}`
      : 'Imported source',
    group: 'Imported Sources',
    id: sourceId,
    intervals: {
      catalog: activityTypes.map(type => toIntervalType(type.type, type.parameters)),
      hasDirectives: false,
      loading: input.loading,
      present: activityTypes.map(type => ({ count: type.count, name: type.type })),
      revisionKey: ready ? `source-revision:${revision.id}` : getUnavailableKey(unavailableReason),
      subscribe: (request, context) =>
        revision && ready
          ? input.subscribeImportedActivities(binding, revision, request, context)
          : createStaticActivitySubscription(unavailableReason ?? '', input.loading),
    },
    kind: 'imported',
    label,
    resources: {
      catalog: resources.map(resource => ({ name: resource.key, schema: resource.schema })),
      loading: input.loading,
      revisionKey: ready ? `source-revision:${revision.id}` : getUnavailableKey(unavailableReason),
      subscribe: (name, context) => {
        const resource = resourcesByKey.get(name);
        if (!revision || !ready || !resource) {
          return createStaticResourceSubscription({
            error: unavailableReason ?? `Resource not found in ${label}`,
            loading: input.loading,
            resource: null,
          });
        }
        return input.subscribeImportedResource(binding, revision, resource, context);
      },
      unavailableReason,
    },
  };
}

function createSimulationDatasetSource(
  input: AnalysisSourcesInput,
  binding: AnalysisSourceBinding,
  dataset: AnalysisSimulationDataset | undefined,
): TimelineSource {
  const sourceId = binding.id;
  const { label } = getAnalysisSourceNames(binding, { dataset });
  const unavailableReason = !dataset
    ? input.loading
      ? undefined
      : 'The simulation dataset no longer exists'
    : dataset.status === 'success'
      ? undefined
      : `The simulation is ${dataset.status}`;
  const catalog: ResourceType[] = (dataset?.dataset?.profiles ?? []).map(({ name, type }) => ({
    name,
    schema: type.schema,
  }));
  const present = dataset ? input.simulationTypeCounts[dataset.id] : undefined;
  const plan = dataset?.simulation?.plan;
  const modelTypes = plan?.mission_model?.activity_types ?? [];
  // External datasets uploaded for this simulation: its external resources. A simulated profile of the same name wins,
  // as on the Plan page (the model's profiles, then the attached external datasets).
  const simulated = new Set(catalog.map(({ name }) => name));
  const external = new Map<string, { dataset: AnalysisPlanExternalDataset; type: ResourceType }>();
  (plan?.external_datasets ?? [])
    .filter(({ simulation_dataset_id }) => simulation_dataset_id === dataset?.id)
    .forEach(each =>
      each.dataset?.profiles.forEach(profile => {
        if (!simulated.has(profile.name) && !external.has(profile.name)) {
          external.set(profile.name, { dataset: each, type: { name: profile.name, schema: profile.type.schema } });
        }
      }),
    );
  const externalCatalog = [...external.values()].map(({ type }) => type);
  return {
    browserNodes: [
      ...(externalCatalog.length
        ? [
            {
              badge: `${externalCatalog.length}`,
              children: externalCatalog.map(resourceType => ({
                action: { item: resourceType, sourceId, typeName: 'resource' as const },
                id: `${sourceId}/external-resource/${resourceType.name}`,
                kind: 'item' as const,
                label: resourceType.name,
                tags: [resourceType.schema.type],
                tooltip: `External dataset ${external.get(resourceType.name)?.dataset.dataset_id}, uploaded for this simulation`,
              })),
              id: `${sourceId}/external-resources`,
              kind: 'group' as const,
              label: 'External resources',
              tooltip: 'Profiles of the external datasets uploaded for this simulation',
            },
          ]
        : []),
      {
        badge: `${catalog.length}`,
        children: catalog.map(resourceType => ({
          action: { item: resourceType, sourceId, typeName: 'resource' },
          id: `${sourceId}/resource/${resourceType.name}`,
          kind: 'item',
          label: resourceType.name,
          tags: [resourceType.schema.type],
        })),
        emptyMessage: unavailableReason ?? (input.loading ? 'Loading…' : 'No simulated resources'),
        id: `${sourceId}/resources`,
        kind: 'group',
        label: 'Resources',
        tooltip: countLabel(catalog.length, 'resource', 'resources'),
      },
      {
        badge: present ? `${present.reduce((total, type) => total + type.count, 0)}` : undefined,
        children: (present ?? []).map(({ count, name }) => activityItemNode(sourceId, name, count)),
        emptyMessage: unavailableReason ?? (present ? 'No simulated activities' : 'Loading…'),
        id: `${sourceId}/activities`,
        kind: 'group',
        label: 'Simulated activities',
        tooltip: present ? summarizeActivityTypes(present).tooltip : undefined,
      },
    ],
    description: dataset
      ? `Simulation ${dataset.id}${plan ? ` of plan "${plan.name}"` : ''} · ${formatRange(dataset.simulation_start_time, dataset.simulation_end_time)}`
      : 'Simulation',
    group: 'Simulations',
    id: sourceId,
    intervals: {
      // The model's declarations where the plan's model still has them; types it no longer declares by name.
      catalog: (present ?? []).map(
        type => modelTypes.find(({ name }) => name === type.name) ?? toIntervalType(type.name),
      ),
      hasDirectives: false,
      loading: input.loading || !present,
      present: present ?? [],
      revisionKey: dataset ? `simulation-dataset:${dataset.id}` : getUnavailableKey(unavailableReason),
      // Simulations are small: every span is loaded once, so hierarchies are complete; rows filter by type.
      subscribe: (_request, context) =>
        dataset && !unavailableReason
          ? input.subscribeSimulationActivities(binding, dataset, context)
          : createStaticActivitySubscription(unavailableReason ?? '', input.loading),
    },
    kind: 'simulation',
    label,
    resources: {
      catalog: [...catalog, ...externalCatalog],
      loading: input.loading,
      revisionKey: dataset ? `simulation-dataset:${dataset.id}` : getUnavailableKey(unavailableReason),
      subscribe: (name, context) => {
        const found = external.get(name);
        if (dataset && !unavailableReason && found && plan?.start_time && input.subscribeExternalDatasetProfile) {
          const start = new Date(
            Date.parse(plan.start_time) + getIntervalInMs(found.dataset.offset_from_plan_start),
          ).toISOString();
          return input.subscribeExternalDatasetProfile(found.dataset.dataset_id, name, start, context);
        }
        return dataset && !unavailableReason
          ? input.subscribeSimulationProfile(binding, dataset, name, context)
          : createStaticResourceSubscription({
              error: unavailableReason ?? '',
              loading: input.loading,
              resource: null,
            });
      },
      unavailableReason,
    },
  };
}

export function createStaticActivitySubscription(
  error: string,
  loading: boolean = false,
): TimelineActivitySubscription {
  return {
    store: { subscribe: run => (run({ error, loading, spans: [] }), () => {}) },
    unsubscribe: () => {},
  };
}

/* Time. */

export function formatRange(start: string | null | undefined, end: string | null | undefined): string {
  const [from, to] = [start ? formatDate(start) : '?', end ? formatDate(end) : '?'];
  return from === to ? from : `${from} – ${to}`;
}

function parseRange(start: string | null | undefined, end: string | null | undefined): TimeRange | null {
  const range = { end: Date.parse(end ?? ''), start: Date.parse(start ?? '') };
  return Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start ? range : null;
}

function union(ranges: (TimeRange | null)[]): TimeRange | null {
  const present = ranges.filter((range): range is TimeRange => range !== null);
  return present.length
    ? { end: Math.max(...present.map(r => r.end)), start: Math.min(...present.map(r => r.start)) }
    : null;
}

/**
 * The extent the timeline can show: every source's data. The default view is the simulations' extent when there
 * are simulations (a plan's span is the usual unit of comparison), else the bound plans', else everything.
 */
export function getAnalysisTimeRanges(
  revisions: AnalysisSourceRevision[],
  datasets: AnalysisSimulationDataset[],
  plans: AnalysisPlan[] = [],
): { initial: TimeRange; max: TimeRange } | null {
  const simulations = union(datasets.map(d => parseRange(d.simulation_start_time, d.simulation_end_time)));
  const planRanges = union(
    plans.map(p =>
      parseRange(p.start_time, new Date(Date.parse(p.start_time) + getIntervalInMs(p.duration)).toISOString()),
    ),
  );
  const max = union([
    simulations,
    planRanges,
    ...revisions.map(r => parseRange(r.coverage_start, r.coverage_end)),
    ...revisions.flatMap(r => r.activity_types.map(t => parseRange(t.first_start, t.last_end))),
  ]);
  return max ? { initial: simulations ?? planRanges ?? max, max } : null;
}

/**
 * A row of every activity of one source, grouped by type: the natural first look at a plan or a simulation. Imported
 * products can hold far more than one row draws, so the page only suggests it for plans and simulations.
 */
export function createSourceActivityRow(
  timelines: Timeline[],
  sourceId: TimelineSourceId,
  name: string,
  { byParent = false }: { byParent?: boolean } = {},
) {
  return createRow(timelines, {
    discreteOptions: {
      ...ViewDefaultDiscreteOptions,
      // A sequence's records open by parent: its steps under it, in the product's order.
      ...(byParent
        ? {
            activityOptions: {
              ...ViewDefaultActivityOptions,
              groupBy: 'name' as const,
              hierarchyMode: 'parent' as const,
            },
          }
        : {}),
      displayMode: 'grouped',
    },
    layers: [createTimelineActivityLayer(timelines, { name, sourceId })],
    name,
  });
}

/**
 * Whether some row already draws activities of `type` from `sourceId`: a layer of that source with no filter (all
 * its activities) or one naming the type. Layers with dynamic filters are taken as not showing it.
 */
export function isActivityTypeShown(timelines: Timeline[], sourceId: TimelineSourceId, type: string): boolean {
  return !!findActivityTypeRow(timelines, sourceId, type);
}

/** The first row that draws activities of `type` from `sourceId` (see isActivityTypeShown), if any. */
export function findActivityTypeRow(timelines: Timeline[], sourceId: TimelineSourceId, type: string): Row | undefined {
  return timelines
    .flatMap(timeline => timeline.rows)
    .find(row =>
      row.layers.some(layer => {
        if (!isActivityLayer(layer) || layer.sourceId !== sourceId) {
          return false;
        }
        const filter = layer.filter.activity;
        if (filter?.static_types?.length) {
          return filter.static_types.includes(type);
        }
        return !filter?.dynamic_type_filters?.length && !filter?.other_filters?.length;
      }),
    );
}

/**
 * The spans that are, or descend from (through the parents they name, among `all`), a record with one of `keys`: a
 * layer's `within` narrowing. A parent that isn't loaded ends the chain.
 */
export function spansWithin(spans: Span[], all: Span[], keys: string[]): Span[] {
  const wanted = new Set(keys);
  const byId = new Map(all.map(span => [span.span_id, span]));
  const memo = new Map<number, boolean>();
  const inside = (span: Span | undefined, depth: number): boolean => {
    if (!span || depth > 64) {
      return false;
    }
    let known = memo.get(span.span_id);
    if (known === undefined) {
      known =
        (span.sourceKey !== undefined && wanted.has(span.sourceKey)) ||
        (span.parent_id !== null && inside(byId.get(span.parent_id), depth + 1));
      memo.set(span.span_id, known);
    }
    return known;
  };
  return spans.filter(span => inside(span, 0));
}

/* Removing a source. */

/**
 * The timelines without any layer bound to `sourceId`. A row left with no layers is removed (it only showed that
 * source), as are axes only those layers used and the guides on them. Rows and layers of other sources are kept as
 * they are.
 */
export function removeSourceFromTimelines(timelines: Timeline[], sourceId: TimelineSourceId): Timeline[] {
  return timelines.map(timeline => {
    let annotations = timeline.annotations;
    const rows = timeline.rows.flatMap(row => {
      const removed = row.layers.filter(layer => layer.sourceId === sourceId);
      if (!removed.length) {
        return [row];
      }
      const layers = row.layers.filter(layer => layer.sourceId !== sourceId);
      if (!layers.length) {
        annotations = removeValueAnnotations(annotations, row.id);
        return [];
      }
      const keptAxes = new Set(layers.map(layer => layer.yAxisId));
      const droppedAxes = new Set(
        removed.map(layer => layer.yAxisId).filter((id): id is number => id !== null && !keptAxes.has(id)),
      );
      annotations = removeValueAnnotations(annotations, row.id, droppedAxes);
      return [{ ...row, layers, yAxes: row.yAxes.filter(axis => !droppedAxes.has(axis.id)) }];
    });
    return { ...timeline, annotations, rows };
  });
}
