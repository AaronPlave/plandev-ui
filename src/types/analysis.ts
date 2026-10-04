import type { ActivityType } from './activity';
import type { UserId } from './app';
import type { SourceResource } from './importedSource';
import type { ValueSchema } from './schema';
import type { TimelineSourceId } from './timelineSource';
import type { ViewDefinition } from './view';

/**
 * What an analysis source reads: an imported revision, a simulation dataset of any plan, or a plan's current
 * activity directives. A plan is live: it changes after it is added. `planRevision` is the plan's revision when the
 * analysis was last saved, so the page can say the plan has changed since.
 */
export type AnalysisSourceTarget =
  | { kind: 'imported'; revisionId: number }
  | { kind: 'simulation'; simulationDatasetId: number }
  | { kind: 'plan'; planId: number; planRevision?: number };

/**
 * A source an analysis composes. The analysis references it and never copies its data. `id` is what the analysis's
 * timeline layers bind to; it stays the same if the binding is later pointed at another revision. `label` is the
 * analysis's own name for it (an alias); the source's own name is unchanged.
 */
export type AnalysisSourceBinding = AnalysisSourceTarget & { id: TimelineSourceId; label?: string };

export type AnalysisDefinition = {
  sources: AnalysisSourceBinding[];
  version: 1;
  /** The existing view definition shape; an analysis uses its timeline, not its plan tables or grid. */
  view: ViewDefinition;
};

export type Analysis = {
  created_at: string;
  definition: AnalysisDefinition;
  id: number;
  name: string;
  owner: UserId;
  updated_at: string;
};

export type AnalysisSlim = Omit<Analysis, 'definition'>;

/** One activity in an analysis. Activity ids are only unique within their source, so the source is part of it. */
export type AnalysisActivityRef = {
  activityId: number;
  sourceId: TimelineSourceId;
};

/** merlin.analysis_activity: activities of every kind of source, in the one shape the activity table reads. */
export type AnalysisActivityRow = {
  activity_id: number;
  category: string | null;
  /** Null for a plan directive: it has no end. */
  end_time: string | null;
  name: string;
  source_kind: 'plan' | 'revision' | 'simulation';
  source_ref: number;
  start_time: string;
  type: string;
};

export type AnalysisActivityType = {
  category: string | null;
  count: number;
  first_start: string | null;
  last_end: string | null;
  /** Each parameter name seen on the type, with the JSON type of its values. */
  parameters: Record<string, 'array' | 'boolean' | 'number' | 'object' | 'string'>;
  type: string;
};

/** What an adapter reported about the product it read (merlin.source_revision.metadata.product). */
export type SourceProductMetadata = {
  generatedAt?: string;
  mission?: Record<string, unknown>;
  productVersion?: string;
  suggestedName?: string;
};

/** A revision as a version of its source: enough to name it and tell it from the others. */
export type SourceRevisionSummary = {
  id: number;
  /** `originalFileName`: the name of the file a user uploaded (the stored upload's name is made unique). */
  metadata: { originalFileName?: string; product?: SourceProductMetadata } | null;
  requested_at: string;
  status: 'pending' | 'incomplete' | 'success' | 'failed';
};

/** An imported revision, as an analysis needs to know it. */
export type AnalysisSourceRevision = SourceRevisionSummary & {
  activity_types: AnalysisActivityType[];
  adapter: string;
  adapter_version: string | null;
  content_hash: string | null;
  coverage_end: string | null;
  coverage_start: string | null;
  error: unknown;
  finished_at: string | null;
  original_file: { name: string } | null;
  resources: SourceResource[];
  /** The source with its newest successful revision, to offer an update. */
  source: { id: number; latest: SourceRevisionSummary[]; name: string; source_type: string };
};

/** A plan, as an analysis that reads its current activities needs to know it. */
export type AnalysisPlan = {
  duration: string;
  id: number;
  /** The types the plan's model declares, with their parameters, for filters. */
  mission_model: { activity_types: ActivityType[] } | null;
  model_id: number;
  name: string;
  revision: number;
  start_time: string;
};

/** A plan's current directive, read-only, at its anchor-resolved approximate start. */
export type AnalysisPlanDirective = {
  anchor_id: number | null;
  anchored_to_start: boolean;
  approximate_start_time: string;
  arguments: Record<string, unknown>;
  id: number;
  metadata: Record<string, unknown>;
  name: string;
  start_offset: string;
  type: string;
};

/** A simulation dataset of any plan, as an analysis needs to know it. */
export type AnalysisSimulationDataset = {
  dataset: { profiles: { name: string; type: { schema: ValueSchema } }[] } | null;
  dataset_id: number;
  id: number;
  simulation: {
    plan: {
      id: number;
      /** The types the plan's model declares, with their parameters, for filters. */
      mission_model: { activity_types: ActivityType[] } | null;
      name: string;
    } | null;
  } | null;
  simulation_end_time: string | null;
  simulation_start_time: string | null;
  status: string;
};

/** An importable format: an installed source adapter (merlin.source_adapter). */
export type SourceAdapterDescriptor = {
  capabilities: string[];
  display_name: string;
  extensions: string[];
  id: string;
  version: string;
};

/** What can be added to an analysis: every source with its revisions, and every plan with its simulations. */
export type AnalysisSourceOptions = {
  plans: {
    id: number;
    name: string;
    revision: number;
    simulations: {
      simulation_datasets: {
        id: number;
        simulation_end_time: string | null;
        simulation_start_time: string | null;
        status: string;
      }[];
    }[];
  }[];
  sources: {
    id: number;
    name: string;
    owner: UserId | null;
    revisions: (SourceRevisionSummary & {
      activity_types_aggregate: { aggregate: { sum: { count: number | null } | null } | null };
      coverage_end: string | null;
      coverage_start: string | null;
      resources_aggregate: { aggregate: { count: number } | null };
    })[];
    source_type: string;
  }[];
};

/** merlin.source_activity: one imported activity with everything the product recorded about it. */
export type SourceActivity = {
  attributes: Record<string, unknown>;
  category: string | null;
  end_time: string;
  id: number;
  metadata: Record<string, unknown>;
  name: string;
  parameters: Record<string, unknown>;
  revision_id: number;
  source_key: string;
  start_time: string;
  type: string;
};
