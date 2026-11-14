import type {
  AnalysisActivityRef,
  AnalysisPlanDirective,
  AnalysisSimulationDataset,
  AnalysisSourceBinding,
  AnalysisSourceRevision,
} from '../types/analysis';
import type { User } from '../types/app';
import { getRevisionVersionLabel, getSourceIdentity } from './analysis';
import effects from './effects';
import { getIntervalInMs, getUnixEpochTimeFromInterval } from './time';

/*
 * One analysis activity read from its source in that source's own terms: an imported activity with its attributes,
 * parameters and provenance, a simulation span with its arguments, or a plan's current directive. Read in one place
 * so the details panel, comparisons and notes all describe a record the same way.
 */

export type AnalysisActivityDetails = {
  /** What the product's adapter recorded as limiting the record (`metadata.dataQuality`). */
  cautions?: string[];
  /** Null when the source records no end (a plan directive). */
  endMs: number | null;
  fields: [string, string][];
  /** The record's identity in its own source: a source key, a span id, a directive id. */
  key: string;
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

export type ActivityDetailsContext = {
  bindings: AnalysisSourceBinding[];
  datasets: AnalysisSimulationDataset[];
  planDirectives: Record<number, AnalysisPlanDirective[]>;
  revisions: AnalysisSourceRevision[];
  user: User | null;
};

/** Null when the activity, or the source it names, is no longer there. */
export async function loadAnalysisActivityDetails(
  ref: AnalysisActivityRef,
  { bindings, datasets, planDirectives, revisions, user }: ActivityDetailsContext,
): Promise<AnalysisActivityDetails | null> {
  const binding = bindings.find(({ id }) => id === ref.sourceId);
  if (!binding) {
    return null;
  }
  const sourceIdentity = getSourceIdentity(binding);
  if (binding.kind === 'plan') {
    return getPlanDirectiveDetails(ref, binding, planDirectives[binding.planId] ?? []);
  }
  if (binding.kind === 'imported') {
    const activity = await effects.getSourceActivity(binding.revisionId, ref.activityId, user);
    if (!activity) {
      return null;
    }
    const revision = revisions.find(({ id }) => id === binding.revisionId);
    const { parent, related } = activity.metadata;
    return {
      cautions: typeof activity.metadata.dataQuality === 'string' ? [activity.metadata.dataQuality] : undefined,
      endMs: Date.parse(activity.end_time),
      fields: [
        ['Subsystem', activity.category ?? '—'],
        ['Id in source', `${activity.id}`],
        ['Source key', activity.source_key],
        ['Product', revision ? `${revision.source.name}, ${getRevisionVersionLabel(revision)}` : ''],
      ],
      key: activity.source_key,
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
    endMs: startMs + getIntervalInMs(span.duration),
    fields: [
      ['Span id', `${span.span_id}`],
      ['Parent span', span.parent_id === null ? '—' : `${span.parent_id}`],
      ['Directive', span.attributes.directiveId === undefined ? '—' : `${span.attributes.directiveId}`],
      ['Plan', plan ? `${plan.name} (${plan.id})` : '—'],
      ['Simulation dataset', `${dataset.id}`],
    ],
    key: `span ${span.span_id}`,
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
