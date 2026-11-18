import type {
  AnalysisActivityRef,
  AnalysisExternalEvent,
  AnalysisPlanDirective,
  AnalysisSimulationDataset,
  AnalysisSourceBinding,
  AnalysisSourceRevision,
} from '../types/analysis';
import type { ActivityType } from '../types/activity';
import type { User } from '../types/app';
import type { FormParameter, ParametersMap } from '../types/parameter';
import type { ValueSchema } from '../types/schema';
import {
  getExternalEventId,
  getRecordKindLabel,
  getRevisionVersionLabel,
  getSourceIdentity,
  isExternalEventId,
} from './analysis';
import effects from './effects';
import { getFormParameters } from './parameters';
import { getIntervalInMs, getUnixEpochTimeFromInterval } from './time';

/*
 * One analysis activity read from its source in that source's own terms: an imported activity with its attributes,
 * parameters and provenance, a simulation span with its arguments, or a plan's current directive. Read in one place
 * so the details panel, comparisons and notes all describe a record the same way.
 */

export type AnalysisActivityDetails = {
  /** What the product's adapter recorded as limiting the record (`metadata.dataQuality`). */
  cautions?: string[];
  /** A simulated span only: the directive it was simulated from, as the span records it (attributes.directiveId). */
  directiveId?: number;
  endInvalid?: string;
  /**
   * The recorded end. Null when there is none to use: a plan directive has none, and an end the product wrote before
   * the start (`endInvalid`, the product's value) is not an end even though the record is drawn at its start.
   */
  endMs: number | null;
  fields: [string, string][];
  /** The record's identity in its own source: a source key, a span id, a directive id. */
  key: string;
  /** What the record is, in an operator's terms: a plan directive, a simulated span, a reported command… */
  kind: string;
  /** Imported only: what the adapter recorded about the record (`metadata`): its parent, step, kind. */
  metadata?: Record<string, unknown>;
  name: string;
  /** What the record was given: imported parameters, or a span's or directive's arguments. */
  parameters: Record<string, unknown>;
  ref: AnalysisActivityRef;
  /**
   * Imported only: source keys of other records of the same revision this record names (`metadata.parent`,
   * `metadata.related`), as the product recorded them. A key may not resolve to a record.
   */
  related?: { parent?: string; related?: string; revisionId: number };
  sections: [string, Record<string, unknown>][];
  /** The data the record came from: see getSourceIdentity. */
  sourceIdentity: string;
  startMs: number;
  type: string;
};

export function getPlanDirectiveDetails(
  ref: AnalysisActivityRef,
  binding: AnalysisSourceBinding,
  directives: AnalysisPlanDirective[],
): AnalysisActivityDetails | null {
  const directive = directives.find(({ id }) => id === ref.activityId);
  if (!directive) {
    return null;
  }
  const anchor = directives.find(({ id }) => id === directive.anchor_id);
  return {
    endMs: null,
    fields: [
      ['Directive id', `${directive.id}`],
      [
        'Anchored to',
        directive.anchor_id === null
          ? `Plan ${directive.anchored_to_start ? 'start' : 'end'}`
          : `${anchor?.name || anchor?.type || 'Directive'} (${directive.anchor_id}) ${directive.anchored_to_start ? 'start' : 'end'}`,
      ],
      ['Offset', directive.start_offset],
    ],
    key: `directive ${directive.id}`,
    kind: getRecordKindLabel('plan'),
    name: directive.name || directive.type,
    parameters: directive.arguments,
    ref,
    sections: [
      ['Arguments', directive.arguments],
      ['Metadata', directive.metadata],
    ],
    sourceIdentity: getSourceIdentity(binding),
    startMs: Date.parse(directive.approximate_start_time),
    type: directive.type,
  };
}

/** One external event of a plan's linked derivation groups, in its own terms: its identity, type and attributes. */
export function getExternalEventDetails(
  ref: AnalysisActivityRef,
  binding: AnalysisSourceBinding,
  events: AnalysisExternalEvent[],
): AnalysisActivityDetails | null {
  const event = events.find(candidate => getExternalEventId(candidate) === ref.activityId);
  if (!event) {
    return null;
  }
  const startMs = Date.parse(event.start_time);
  return {
    endMs: startMs + getIntervalInMs(event.duration),
    fields: [
      ['Derivation group', event.derivation_group_name],
      ['External source', event.source_key],
      ['Event key', event.event_key],
    ],
    key: `${event.derivation_group_name}/${event.source_key}/${event.event_key}`,
    kind: 'External event',
    name: event.event_key,
    parameters: event.attributes,
    ref,
    sections: [['Attributes', event.attributes]],
    sourceIdentity: getSourceIdentity(binding),
    startMs,
    type: event.event_type_name,
  };
}

/** A plan source's record: a directive, or an external event of a linked derivation group (see isExternalEventId). */
export function getPlanRecordDetails(
  ref: AnalysisActivityRef,
  binding: AnalysisSourceBinding,
  directives: AnalysisPlanDirective[],
  events: AnalysisExternalEvent[],
): AnalysisActivityDetails | null {
  return isExternalEventId(ref.activityId)
    ? getExternalEventDetails(ref, binding, events)
    : getPlanDirectiveDetails(ref, binding, directives);
}

export type ActivityDetailsContext = {
  bindings: AnalysisSourceBinding[];
  datasets: AnalysisSimulationDataset[];
  planDirectives: Record<number, AnalysisPlanDirective[]>;
  planExternalEvents?: Record<number, AnalysisExternalEvent[]>;
  revisions: AnalysisSourceRevision[];
  user: User | null;
};

/** Null when the activity, or the source it names, is no longer there. */
export async function loadAnalysisActivityDetails(
  ref: AnalysisActivityRef,
  { bindings, datasets, planDirectives, planExternalEvents, revisions, user }: ActivityDetailsContext,
): Promise<AnalysisActivityDetails | null> {
  const binding = bindings.find(({ id }) => id === ref.sourceId);
  if (!binding) {
    return null;
  }
  const sourceIdentity = getSourceIdentity(binding);
  if (binding.kind === 'plan') {
    return getPlanRecordDetails(
      ref,
      binding,
      planDirectives[binding.planId] ?? [],
      planExternalEvents?.[binding.planId] ?? [],
    );
  }
  if (binding.kind === 'imported') {
    const activity = await effects.getSourceActivity(binding.revisionId, ref.activityId, user);
    if (!activity) {
      return null;
    }
    const revision = revisions.find(({ id }) => id === binding.revisionId);
    const { endInvalid, endTime, parent, related } = activity.metadata;
    // Adapter versions before `endInvalid` kept the product's end as `endTime` only when it was invalid.
    const invalidEnd = endInvalid === true || typeof endTime === 'string' ? `${endTime ?? 'invalid'}` : undefined;
    return {
      cautions: typeof activity.metadata.dataQuality === 'string' ? [activity.metadata.dataQuality] : undefined,
      endInvalid: invalidEnd,
      endMs: invalidEnd === undefined ? Date.parse(activity.end_time) : null,
      fields: [
        ['Subsystem', activity.category ?? '—'],
        ['Id in source', `${activity.id}`],
        ['Source key', activity.source_key],
        ['Product', revision ? `${revision.source.name}, ${getRevisionVersionLabel(revision)}` : ''],
      ],
      key: activity.source_key,
      kind: getRecordKindLabel('imported', activity.metadata.recordKind, activity.type),
      metadata: activity.metadata,
      name: activity.name,
      parameters: activity.parameters,
      ref,
      related: {
        parent: typeof parent === 'string' ? parent : undefined,
        related: typeof related === 'string' ? related : undefined,
        revisionId: binding.revisionId,
      },
      sections: [
        ['Parameters', activity.parameters],
        ['Attributes', activity.attributes],
        ['Provenance', activity.metadata],
      ],
      sourceIdentity,
      startMs: Date.parse(activity.start_time),
      type: activity.type,
    };
  }
  const dataset = datasets.find(({ id }) => id === binding.simulationDatasetId);
  if (!dataset?.simulation_start_time) {
    return null;
  }
  const span = await effects.getSpan(dataset.dataset_id, ref.activityId, user);
  if (!span) {
    return null;
  }
  const startMs = getUnixEpochTimeFromInterval(dataset.simulation_start_time, span.start_offset);
  const plan = dataset.simulation?.plan;
  return {
    directiveId: span.attributes.directiveId,
    endMs: startMs + getIntervalInMs(span.duration),
    fields: [
      ['Span id', `${span.span_id}`],
      ['Parent span', span.parent_id === null ? '—' : `${span.parent_id}`],
      ['Directive', span.attributes.directiveId === undefined ? '—' : `${span.attributes.directiveId}`],
      ['Plan', plan ? `${plan.name} (${plan.id})` : '—'],
      ['Simulation dataset', `${dataset.id}`],
    ],
    key: `span ${span.span_id}`,
    kind: getRecordKindLabel('simulation'),
    name: span.type,
    parameters: (span.attributes.arguments ?? {}) as Record<string, unknown>,
    ref,
    sections: [
      ['Arguments', span.attributes.arguments],
      ['Computed attributes', span.attributes.computedAttributes as Record<string, unknown>],
    ],
    sourceIdentity,
    startMs,
    type: span.type,
  };
}

/** A schema for a value nothing declares (an imported record's parameter), from the value itself. */
export function inferValueSchema(value: unknown): ValueSchema {
  if (typeof value === 'boolean') {
    return { type: 'boolean' };
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { type: 'int' } : { type: 'real' };
  }
  if (Array.isArray(value)) {
    return { items: value.length ? inferValueSchema(value[0]) : { type: 'string' }, type: 'series' };
  }
  if (value && typeof value === 'object') {
    return {
      items: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, inferValueSchema(item)])),
      type: 'struct',
    };
  }
  return { type: 'string' };
}

/**
 * A record's values (arguments, attributes) as read-only form parameters, the way a Plan's activity forms show them:
 * by the type's declared schema where there is one (a model's activity type), else by the values' own shape.
 */
export function getReadOnlyFormParameters(
  values: Record<string, unknown> | null | undefined,
  declared?: Pick<ActivityType, 'parameters' | 'required_parameters'> | null,
): FormParameter[] {
  const entries = Object.entries(values ?? {});
  if (!entries.length) {
    return [];
  }
  const parameters: ParametersMap = {};
  entries.forEach(([name, value], index) => {
    parameters[name] = declared?.parameters[name] ?? { order: 1000 + index, schema: inferValueSchema(value) };
  });
  return getFormParameters(parameters, values as never, declared?.required_parameters ?? []).map(parameter => ({
    ...parameter,
    valueSource: 'none',
  }));
}
