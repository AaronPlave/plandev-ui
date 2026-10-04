import type {
  AnalysisActivityRef,
  AnalysisActivityRow,
  AnalysisDefinition,
  AnalysisPlan,
  AnalysisPlanDirective,
  AnalysisSimulationDataset,
  AnalysisSourceBinding,
  AnalysisSourceRevision,
  AnalysisSourceTarget,
  AnalysisSourceUsage,
  SourceRevisionSummary,
} from '../types/analysis';
import type { SourceResource } from '../types/importedSource';
import type { ResourceType, Span } from '../types/simulation';
import type { TimeRange, Timeline } from '../types/timeline';
import type {
  SourceBrowserNode,
  TimelineActivityRequest,
  TimelineActivitySubscription,
  TimelineResourceSubscription,
  TimelineResourceSubscriptionContext,
  TimelineSource,
  TimelineSourceId,
} from '../types/timelineSource';
import { ViewDefaultDiscreteOptions } from '../constants/view';
import { getIntervalInMs } from './time';
import { createRow, createTimeline, createTimelineActivityLayer, isActivityLayer } from './timeline';
import { createStaticResourceSubscription, toIntervalType } from './timelineSources';
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
  start_time: string;
  type: string;
};

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
    parent_id: null,
    sourceActivityId: activity.id,
    sourceId,
    span_id: getActivityDrawingId({ activityId: activity.id, sourceId }),
    startMs,
    start_offset: '',
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
    sourceActivityId: directive.id,
    sourceId,
    span_id: getActivityDrawingId({ activityId: directive.id, sourceId }),
    startMs,
    start_offset: '',
    type: directive.type,
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
  /** Directive types present in each bound plan now, by plan id; absent while they load. */
  planTypeCounts: Record<number, { count: number; name: string }[]>;
  plans: AnalysisPlan[];
  /** True while the bound plans are loading (they are subscribed to, separately from revisions and datasets). */
  plansLoading: boolean;
  revisions: AnalysisSourceRevision[];
  simulationDatasets: AnalysisSimulationDataset[];
  /** Span types present in each simulation dataset, by simulation dataset id; absent while they load. */
  simulationTypeCounts: Record<number, { count: number; name: string }[]>;
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
    return revision.status === 'failed' ? 'Import failed' : 'Importing…';
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
  details: { dataset?: AnalysisSimulationDataset; plan?: AnalysisPlan; revision?: AnalysisSourceRevision },
): { label: string; name: string; version: string } {
  let name: string;
  let version: string;
  let short: string;
  if (binding.kind === 'imported') {
    name = details.revision?.source.name ?? 'Imported source';
    version = details.revision ? getRevisionVersionLabel(details.revision) : 'Unavailable revision';
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

function groupBrowserNodes<T>(
  sourceId: TimelineSourceId,
  kind: string,
  items: T[],
  getCategory: (item: T) => string | null,
  toNode: (item: T) => SourceBrowserNode,
  summarize: (members: T[]) => Pick<SourceBrowserNode, 'badge' | 'tooltip'>,
): SourceBrowserNode[] {
  const byCategory = new Map<string, T[]>();
  items.forEach(item => {
    const category = getCategory(item) ?? 'Uncategorized';
    const members = byCategory.get(category) ?? [];
    members.push(item);
    byCategory.set(category, members);
  });
  return [...byCategory.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, members]) => ({
      ...summarize(members),
      children: members.map(toNode),
      id: `${sourceId}/${kind}/category/${category}`,
      kind: 'group',
      label: category,
    }));
}

function activityItemNode(sourceId: TimelineSourceId, name: string, count: number): SourceBrowserNode {
  return {
    action: { item: toIntervalType(name), sourceId, typeName: 'activity' },
    badge: `${count}`,
    id: `${sourceId}/activity/${name}`,
    kind: 'item',
    label: name,
    tooltip: countLabel(count, 'activity', 'activities'),
  };
}

function countLabel(count: number, one: string, many: string): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/** What a group of activity types shows: its activities, with how many types they are of. */
function summarizeActivityTypes(types: { count: number }[]): Pick<SourceBrowserNode, 'badge' | 'tooltip'> {
  const activities = types.reduce((total, type) => total + type.count, 0);
  return {
    badge: `${activities}`,
    tooltip: `${countLabel(types.length, 'type', 'types')} · ${countLabel(activities, 'activity', 'activities')}`,
  };
}

export function createAnalysisSources(input: AnalysisSourcesInput): TimelineSource[] {
  const sources = input.bindings.map(binding => {
    switch (binding.kind) {
      case 'imported':
        return createImportedRevisionSource(
          input,
          binding,
          input.revisions.find(revision => revision.id === binding.revisionId),
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
    const { name, version } = getAnalysisSourceNames(binding, { revision });
    return { ...source, label: `${name} · ${version.replace(/^Imported /, '')}` };
  });
}

/**
 * A plan's current activity directives. Live: the rows follow the plan as it changes. Read-only, with no
 * resources (a plan's resources are its simulations' results, which are their own sources).
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
  const modelTypes = plan?.mission_model?.activity_types ?? [];
  return {
    browserNodes: [
      {
        children: groupBrowserNodes(
          sourceId,
          'activity',
          present ?? [],
          () => 'Activity directives',
          type => activityItemNode(sourceId, type.name, type.count),
          summarizeActivityTypes,
        ),
        emptyMessage: unavailableReason ?? (present ? 'No activities' : 'Loading…'),
        id: `${sourceId}/activities`,
        kind: 'group',
        label: `Current Activities (${(present ?? []).reduce((total, type) => total + type.count, 0)})`,
        tooltip: present ? summarizeActivityTypes(present).tooltip : undefined,
      },
    ],
    description: plan
      ? `Plan "${name}": its current activity directives, live`
      : `Plan ${binding.kind === 'plan' ? binding.planId : ''}`,
    group: 'Plans',
    id: sourceId,
    intervals: {
      catalog: (present ?? []).map(
        type => modelTypes.find(({ name }) => name === type.name) ?? toIntervalType(type.name),
      ),
      hasDirectives: false,
      loading: input.plansLoading || !present,
      present: present ?? [],
      // The plan changes under the key: its subscription follows it, so rows never need to resubscribe.
      revisionKey: plan ? `plan:${plan.id}` : getUnavailableKey(unavailableReason),
      subscribe: (_request, context) =>
        plan
          ? input.subscribePlanActivities(binding, plan, context)
          : createStaticActivitySubscription(unavailableReason ?? '', input.plansLoading),
    },
    kind: 'plan',
    label,
  };
}

function createImportedRevisionSource(
  input: AnalysisSourcesInput,
  binding: AnalysisSourceBinding,
  revision: AnalysisSourceRevision | undefined,
): TimelineSource {
  const sourceId = binding.id;
  const { label } = getAnalysisSourceNames(binding, { revision });
  const ready = revision?.status === 'success';
  const unavailableReason = !revision
    ? input.loading
      ? undefined
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
    browserNodes: [
      {
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
        label: `Resources (${resources.length})`,
        tooltip: countLabel(resources.length, 'resource', 'resources'),
      },
      {
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
        label: `Activities (${activityTypes.reduce((total, type) => total + type.count, 0)})`,
        tooltip: summarizeActivityTypes(activityTypes).tooltip,
      },
    ],
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
  return {
    browserNodes: [
      {
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
        label: `Resources (${catalog.length})`,
        tooltip: countLabel(catalog.length, 'resource', 'resources'),
      },
      {
        children: (present ?? []).map(({ count, name }) => activityItemNode(sourceId, name, count)),
        emptyMessage: unavailableReason ?? (present ? 'No simulated activities' : 'Loading…'),
        id: `${sourceId}/activities`,
        kind: 'group',
        label: `Simulated Activities (${(present ?? []).reduce((total, type) => total + type.count, 0)})`,
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
      catalog,
      loading: input.loading,
      revisionKey: dataset ? `simulation-dataset:${dataset.id}` : getUnavailableKey(unavailableReason),
      subscribe: (name, context) =>
        dataset && !unavailableReason
          ? input.subscribeSimulationProfile(binding, dataset, name, context)
          : createStaticResourceSubscription({
              error: unavailableReason ?? '',
              loading: input.loading,
              resource: null,
            }),
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
export function createSourceActivityRow(timelines: Timeline[], sourceId: TimelineSourceId, name: string) {
  return createRow(timelines, {
    discreteOptions: { ...ViewDefaultDiscreteOptions, displayMode: 'grouped' },
    layers: [createTimelineActivityLayer(timelines, { name, sourceId })],
    name,
  });
}

/**
 * Whether some row already draws activities of `type` from `sourceId`: a layer of that source with no filter (all
 * its activities) or one naming the type. Layers with dynamic filters are taken as not showing it.
 */
export function isActivityTypeShown(timelines: Timeline[], sourceId: TimelineSourceId, type: string): boolean {
  return timelines.some(timeline =>
    timeline.rows.some(row =>
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
    ),
  );
}

/* Removing a source. */

/**
 * The timelines without any layer bound to `sourceId`. A row left with no layers is removed (it only showed that
 * source), as are axes only those layers used and the guides on them. Rows and layers of other sources are kept as
 * they are.
 */
export function removeSourceFromTimelines(timelines: Timeline[], sourceId: TimelineSourceId): Timeline[] {
  return timelines.map(timeline => ({
    ...timeline,
    rows: timeline.rows.flatMap(row => {
      const removed = row.layers.filter(layer => layer.sourceId === sourceId);
      if (!removed.length) {
        return [row];
      }
      const layers = row.layers.filter(layer => layer.sourceId !== sourceId);
      if (!layers.length) {
        return [];
      }
      const keptAxes = new Set(layers.map(layer => layer.yAxisId));
      const droppedAxes = new Set(removed.map(layer => layer.yAxisId).filter(id => !keptAxes.has(id)));
      return [
        {
          ...row,
          horizontalGuides: row.horizontalGuides.filter(guide => !droppedAxes.has(guide.yAxisId)),
          layers,
          yAxes: row.yAxes.filter(axis => !droppedAxes.has(axis.id)),
        },
      ];
    }),
  }));
}
