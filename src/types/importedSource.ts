import type { ValueSchema } from './schema';

/** One imported revision's use by the current plan (merlin.plan_source). */
export type PlanSource = {
  id: number;
  label: string | null;
  source_revision: {
    /** Each activity type in the revision, with how many there are. */
    activity_types: { category: string | null; count: number; parameters: Record<string, string>; type: string }[];
    coverage_end: string | null;
    coverage_start: string | null;
    id: number;
    progress: Record<string, unknown>;
    /** Written when ingest starts, before any data is read, so it is browseable while the revision ingests. */
    resources: SourceResource[];
    source: { id: number; name: string; source_type: string };
    status: 'pending' | 'incomplete' | 'success' | 'failed';
  };
};

/** A resource in an imported revision's catalog (merlin.source_resource). */
export type SourceResource = {
  category: string | null;
  coverage_end: string | null;
  coverage_start: string | null;
  interpolation: 'linear' | 'constant';
  key: string;
  numeric: boolean;
  sample_count: number | null;
  schema: ValueSchema;
  units: string | null;
};
