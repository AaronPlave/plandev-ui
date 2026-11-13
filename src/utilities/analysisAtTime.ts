import type {
  AnalysisActivityRow,
  AnalysisSimulationDataset,
  AnalysisSourceBinding,
  AnalysisSourceRevision,
} from '../types/analysis';
import type { DropdownOptions } from '../types/dropdown';
import type { SourceResource } from '../types/importedSource';
import type { ValueSchema } from '../types/schema';
import type { Resource, ResourceType, ResourceValue } from '../types/simulation';
import type { Layer, Row, TimeRange, Timeline } from '../types/timeline';
import type { TimelineSource, TimelineSourceId } from '../types/timelineSource';
import type { TimelineResourceState } from '../stores/timelineResourceStatus';
import {
  GAP,
  NULL,
  VALUE,
  isCompleteRaw,
  toMicros,
  type SourceQueryResult,
  type SourceSeries,
} from './importedResource';
import { convertUsToDurationString } from './time';

/*
 * What a source says at one instant. A value is never presented as more than it is:
 *  - sample:       a recorded sample of the source at exactly that instant;
 *  - held:         the source's last sample before that instant, still in effect (a step resource holds its value
 *                  until the next sample);
 *  - interpolated: a straight line between the two recorded samples either side of that instant, which the source
 *                  did not itself record;
 *  - computed:     read off a simulation's profile as the timeline holds it, not a recorded sample;
 *  - gap:          the source says it has no data there;
 *  - unavailable:  nothing can be said (outside the data, not loaded, not asked, failed), with the reason;
 *  - loading:      not read yet for this instant: never a value from another instant.
 */
export type AtTimeBasis = 'computed' | 'gap' | 'held' | 'interpolated' | 'loading' | 'sample' | 'unavailable';

export type AtTimeValue = {
  /** The response was not a complete, raw one: the value may not be the source's own. */
  approximate?: boolean;
  basis: AtTimeBasis;
  /** The sample after the instant, when the value depends on it (ms). */
  nextMs?: number;
  /** Why nothing can be said, or what else to know. */
  note?: string;
  /** The sample the value comes from, or the one before the instant (ms). */
  sampleMs?: number;
  value: number | string | null;
};

const MICROS_PER_MS = 1000;

function unavailable(note: string): AtTimeValue {
  return { basis: 'unavailable', note, value: null };
}

/** The element of a series, as the kind of thing it is and its value. */
function readSeries(series: SourceSeries, index: number, numeric: boolean) {
  const kind = series.k ? series.k[index] : VALUE;
  const value = kind === VALUE ? ((numeric ? series.v?.[index] : series.s?.[index]) ?? null) : null;
  return { kind, ms: series.t[index] / MICROS_PER_MS, value };
}

/**
 * The value of an imported resource at `timeMs`, from an exact query of the window [t, t + 1 microsecond): the samples
 * at t (`series`), the last one before it (`before`) and the first one after it (`after`). Nothing else is read.
 * `coverageEnd` (ms) is where the source's data stops: a step resource holds its last sample until then.
 */
export function getImportedValueAt(
  timeMs: number,
  result: SourceQueryResult,
  {
    coverageEnd,
    interpolation,
    numeric,
  }: { coverageEnd: number; interpolation: 'constant' | 'linear'; numeric: boolean },
): AtTimeValue {
  if (result.error) {
    return unavailable(result.error);
  }
  const approximate = isCompleteRaw(result) ? {} : { approximate: true };
  const at = result.series.t.length;
  if (at > 0) {
    const sample = readSeries(result.series, at - 1, numeric);
    return sample.kind === GAP
      ? { ...approximate, basis: 'gap', sampleMs: sample.ms, value: null }
      : { ...approximate, basis: 'sample', sampleMs: sample.ms, value: sample.value };
  }
  const before =
    result.before && result.before.t.length ? readSeries(result.before, result.before.t.length - 1, numeric) : null;
  const after = result.after && result.after.t.length ? readSeries(result.after, 0, numeric) : null;
  if (!before) {
    return unavailable('Before the first sample');
  }
  if (before.kind === GAP) {
    return { ...approximate, basis: 'gap', sampleMs: before.ms, value: null };
  }
  if (interpolation === 'linear' && numeric) {
    if (!after) {
      return unavailable('After the last sample');
    }
    if (before.kind !== VALUE || after.kind !== VALUE || before.value === null || after.value === null) {
      return unavailable('The line is broken here: a neighbouring sample has no value');
    }
    const fraction = (timeMs - before.ms) / (after.ms - before.ms);
    return {
      ...approximate,
      basis: 'interpolated',
      nextMs: after.ms,
      sampleMs: before.ms,
      value: Number(before.value) + (Number(after.value) - Number(before.value)) * fraction,
    };
  }
  if (!after && timeMs > coverageEnd) {
    return unavailable("After the end of the source's data");
  }
  return {
    ...approximate,
    basis: 'held',
    ...(after ? { nextMs: after.ms } : {}),
    sampleMs: before.ms,
    value: before.kind === NULL ? null : before.value,
  };
}

/**
 * The value of a simulation resource at `timeMs`, from the values the timeline holds for it (the sampled profile
 * segments, in time order). Not a recorded sample: see `AtTimeBasis`.
 */
export function getSimulatedValueAt(values: ResourceValue[], timeMs: number): AtTimeValue {
  if (!values.length) {
    return unavailable('The simulation has no values for this resource');
  }
  if (timeMs < values[0].x) {
    return unavailable('Before the simulation starts');
  }
  // The last value at or before the instant; of several at the same time, the last: it is the one in effect.
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (values[middle].x <= timeMs) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  const index = low - 1;
  const current = values[index];
  const next = values[index + 1];
  if (current.is_gap) {
    return { basis: 'gap', sampleMs: current.x, value: null };
  }
  if (current.x === timeMs) {
    return { basis: 'computed', sampleMs: current.x, value: current.y };
  }
  if (!next) {
    return unavailable('After the simulation ends');
  }
  const linear =
    !current.is_hold &&
    !next.is_gap &&
    typeof current.y === 'number' &&
    typeof next.y === 'number' &&
    next.x > current.x;
  const value = linear
    ? (current.y as number) +
      (((next.y as number) - (current.y as number)) * (timeMs - current.x)) / (next.x - current.x)
    : current.y;
  return { basis: 'computed', nextMs: next.x, sampleMs: current.x, value };
}

/**
 * A resource to read at an instant. It is identified by its source (the analysis's own binding id) and its name within
 * that source: the same name in two sources is two resources.
 */
export type InspectedResource = {
  /** The timeline layer that plots it, when one does. */
  layerName?: string;
  /** The resource's name within its source. */
  name: string;
  /** Plotted by some row of the timeline. */
  onTimeline: boolean;
  rowId?: number;
  rowName?: string;
  sourceId: TimelineSourceId;
  /** Explicitly watched in the inspector (it needs no row). */
  watched: boolean;
};

/** A resource the inspector was asked to watch: kept by the analysis page, never saved with the analysis. */
export type WatchedResource = { name: string; sourceId: TimelineSourceId };

export function getResourceKey(sourceId: TimelineSourceId, name: string): string {
  return `${sourceId}::${name}`;
}

/** Resources read per source and instant: more than this is not a table to read, and not a query to make. */
export const MAX_INSPECTED_RESOURCES = 100;

/**
 * The resources to read: all of those watched, then plotted ones for the slots left, in the order given. A plotted
 * resource is left out when the limit is reached, never a watched one (the picker stops at the limit, so they all fit).
 */
export function limitInspectedResources(
  inspected: InspectedResource[],
  max: number = MAX_INSPECTED_RESOURCES,
): InspectedResource[] {
  let room = max - inspected.filter(({ watched }) => watched).length;
  return inspected.filter(({ watched }) => watched || room-- > 0);
}

/**
 * The watched resources once the picker's `keys` are chosen: one already watched stays whether or not its source can be
 * listed now, and one the catalog does not know is dropped. The limit keeps the earlier ones: `refused` is how many of the
 * new ones did not fit.
 */
export function getWatchedSelection(
  keys: string[],
  watched: WatchedResource[],
  catalog: ResourceCatalogEntry[],
  max: number = MAX_INSPECTED_RESOURCES,
): { refused: number; watched: WatchedResource[] } {
  const current = new Map(watched.map(resource => [getResourceKey(resource.sourceId, resource.name), resource]));
  const known = new Map(catalog.map(entry => [entry.key, { name: entry.item.name, sourceId: entry.sourceId }]));
  const chosen = keys.flatMap(key => {
    const resource = current.get(key) ?? known.get(key);
    return resource ? [resource] : [];
  });
  return { refused: Math.max(0, chosen.length - max), watched: chosen.slice(0, max) };
}

/**
 * The resources being examined: those the timeline's rows draw (one entry per source and name, in row order) and then
 * those watched in the inspector that no row draws. A resource that is both appears once. Layers that name no source are
 * a Plan's legacy lookup, which an analysis does not have.
 */
export function getInspectedResources(
  timeline: Timeline | undefined,
  watched: WatchedResource[] = [],
): InspectedResource[] {
  const watchedKeys = new Set(watched.map(({ name, sourceId }) => getResourceKey(sourceId, name)));
  const seen = new Set<string>();
  const out: InspectedResource[] = [];
  (timeline?.rows ?? []).forEach((row: Row) =>
    row.layers.forEach((layer: Layer) => {
      const name = layer.filter.resource;
      if (!name || !layer.sourceId || (layer.chartType !== 'line' && layer.chartType !== 'x-range')) {
        return;
      }
      const key = getResourceKey(layer.sourceId, name);
      if (!seen.has(key)) {
        seen.add(key);
        out.push({
          layerName: layer.name,
          name,
          onTimeline: true,
          rowId: row.id,
          rowName: row.name,
          sourceId: layer.sourceId,
          watched: watchedKeys.has(key),
        });
      }
    }),
  );
  watched.forEach(({ name, sourceId }) => {
    const key = getResourceKey(sourceId, name);
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ name, onTimeline: false, sourceId, watched: true });
    }
  });
  return out;
}

/** Resources that can be watched: each bound source's own, and only where the source has data to read. */
export type ResourceCatalogEntry = { item: ResourceType; key: string; sourceId: TimelineSourceId; sourceLabel: string };

export function getResourceCatalog(sources: TimelineSource[]): ResourceCatalogEntry[] {
  return sources.flatMap(source =>
    source.resources && !source.resources.unavailableReason
      ? source.resources.catalog.map(item => ({
          item,
          key: getResourceKey(source.id, item.name),
          sourceId: source.id,
          sourceLabel: source.label,
        }))
      : [],
  );
}

/**
 * The catalog as picker options, sorted. Where more than one source offers resources, each option names its source:
 * the same resource in two sources must not look like one.
 */
export function getResourceOptions(catalog: ResourceCatalogEntry[]): DropdownOptions {
  const named = new Set(catalog.map(({ sourceId }) => sourceId)).size > 1;
  return catalog
    .map(({ item, key, sourceLabel }) => ({ display: named ? `${item.name} · ${sourceLabel}` : item.name, value: key }))
    .sort((a, b) => a.display.localeCompare(b.display));
}

/** Bound sources that offer resources but have none to read (failed, still importing, deleted) and why. */
export function getUnavailableResourceSources(sources: TimelineSource[]): { label: string; reason: string }[] {
  return sources.flatMap(source =>
    source.resources?.unavailableReason ? [{ label: source.label, reason: source.resources.unavailableReason }] : [],
  );
}

/** What reading a resource of a source means: from where, or why nothing can be read. */
export type ResourceTarget =
  | { definition: SourceResource; kind: 'imported'; revision: AnalysisSourceRevision }
  | { dataset: AnalysisSimulationDataset; kind: 'simulation' }
  | { kind: 'unavailable'; note: string };

/** Resolves a resource to the data its own source binds now. Never falls back to another source. */
export function resolveResource(
  spec: Pick<InspectedResource, 'name' | 'sourceId'>,
  bindings: AnalysisSourceBinding[],
  revisions: AnalysisSourceRevision[],
  datasets: AnalysisSimulationDataset[],
): ResourceTarget {
  const binding = bindings.find(({ id }) => id === spec.sourceId);
  if (!binding) {
    return { kind: 'unavailable', note: 'Not a source of this analysis' };
  }
  if (binding.kind === 'imported') {
    const revision = revisions.find(({ id }) => id === binding.revisionId);
    if (!revision || revision.status !== 'success') {
      return { kind: 'unavailable', note: 'The source has no data to read' };
    }
    const definition = revision.resources.find(({ key }) => key === spec.name);
    return definition
      ? { definition, kind: 'imported', revision }
      : { kind: 'unavailable', note: 'Not a resource of this source' };
  }
  if (binding.kind === 'simulation') {
    const dataset = datasets.find(({ id }) => id === binding.simulationDatasetId);
    if (!dataset) {
      return { kind: 'unavailable', note: 'The simulation dataset has no data to read' };
    }
    return dataset.status === 'success'
      ? { dataset, kind: 'simulation' }
      : { kind: 'unavailable', note: `The simulation is ${dataset.status}` };
  }
  return { kind: 'unavailable', note: 'A plan has no resources' };
}

/** A schema with the resource's units, where the cursor panel reads them from. */
export function withUnit(schema: ValueSchema, units: string | null): ValueSchema {
  return units ? { ...schema, metadata: { ...schema.metadata, unit: { value: units } } } : schema;
}

export const loadingReading: AtTimeValue = { basis: 'loading', note: 'Reading…', value: null };

/** What a simulation resource says at `timeMs`, from what the timeline's registry holds of it right now. */
export function getSimulatedReading(
  state: TimelineResourceState | undefined,
  timeMs: number,
): { reading: AtTimeValue; schema: ValueSchema | null } {
  if (state?.resource) {
    return { reading: getSimulatedValueAt(state.resource.values, timeMs), schema: state.resource.schema };
  }
  if (state?.error) {
    return { reading: unavailable(state.error), schema: null };
  }
  return { reading: state?.loading ? loadingReading : unavailable('Not loaded yet'), schema: null };
}

/**
 * Reads imported resources at one instant: one exact query per source revision (in requests of up to
 * `perRequest` resources), so two sources with a resource of one name are asked and answered separately. `query` asks
 * the revision for the instant. A failed request makes only its own resources unavailable. The readings are by resource key.
 */
export async function readImportedResources(
  timeMs: number,
  items: { definition: SourceResource; revision: AnalysisSourceRevision; spec: InspectedResource }[],
  query: (revisionId: number, names: string[]) => Promise<SourceQueryResult[]>,
  perRequest: number = 100,
): Promise<Map<string, AtTimeValue>> {
  const out = new Map<string, AtTimeValue>();
  const byRevision = new Map<number, typeof items>();
  items.forEach(item => byRevision.set(item.revision.id, [...(byRevision.get(item.revision.id) ?? []), item]));
  await Promise.all(
    [...byRevision.entries()].map(async ([revisionId, members]) => {
      for (let i = 0; i < members.length; i += perRequest) {
        const slice = members.slice(i, i + perRequest);
        try {
          const results = await query(
            revisionId,
            slice.map(({ spec }) => spec.name),
          );
          const byName = new Map(results.map(result => [result.resource, result]));
          slice.forEach(({ definition, revision, spec }) => {
            const result = byName.get(spec.name);
            out.set(
              getResourceKey(spec.sourceId, spec.name),
              result
                ? getImportedValueAt(timeMs, result, {
                    coverageEnd: Date.parse(definition.coverage_end ?? revision.coverage_end ?? ''),
                    interpolation: definition.interpolation,
                    numeric: definition.numeric,
                  })
                : unavailable('The source returned nothing for it'),
            );
          });
        } catch (e) {
          slice.forEach(({ spec }) =>
            out.set(getResourceKey(spec.sourceId, spec.name), unavailable((e as Error).message || 'The read failed')),
          );
        }
      }
    }),
  );
  return out;
}

export type AnalysisResourceRowsInput = {
  bindings: AnalysisSourceBinding[];
  /** The B cursor, when comparing. */
  compareMs: number | null;
  /** The A cursor. */
  cursorMs: number | null;
  datasets: AnalysisSimulationDataset[];
  /** Why the reads failed, if they did. */
  error: string;
  /** What the timeline's registry holds of a resource (the display data, and a simulation's profile). */
  getState: (datasetId: number, name: string, kind: 'importedRevision' | 'sim') => TimelineResourceState | undefined;
  labels: Record<string, string>;
  /** Imported readings for the cursors are still being read. */
  pending: boolean;
  /** The imported readings (by resource key) for A and B, only when they are for the current instants. */
  readingsA: Map<string, AtTimeValue> | null;
  readingsB: Map<string, AtTimeValue> | null;
  revisions: AnalysisSourceRevision[];
  specs: InspectedResource[];
};

/**
 * The inspector's rows, one per resource, each read from its own source:
 *  - imported: the reading taken at the cursor, or "reading" while it is on its way, or why it failed; never one taken
 *    at another instant (the caller passes only current ones);
 *  - simulation: computed now from the profile the registry holds, so it is there as soon as the profile has loaded.
 */
export function getAnalysisResourceRows(input: AnalysisResourceRowsInput): AnalysisCursorResource[] {
  const { bindings, compareMs, cursorMs, datasets, error, getState, labels, pending, revisions, specs } = input;
  if (cursorMs === null) {
    return [];
  }
  const missing = pending ? loadingReading : unavailable(error || 'Not read');
  return specs.map(spec => {
    const key = getResourceKey(spec.sourceId, spec.name);
    const target = resolveResource(spec, bindings, revisions, datasets);
    let schema: ValueSchema = { type: 'string' };
    let display: Resource | null = null;
    let readingA: AtTimeValue;
    let readingB: AtTimeValue | null = null;
    if (target.kind === 'imported') {
      schema = withUnit(target.definition.schema, target.definition.units);
      display = getState(target.revision.id, spec.name, 'importedRevision')?.resource ?? null;
      readingA = input.readingsA?.get(key) ?? missing;
      readingB = compareMs === null ? null : (input.readingsB?.get(key) ?? missing);
    } else if (target.kind === 'simulation') {
      const state = getState(target.dataset.dataset_id, spec.name, 'sim');
      const first = getSimulatedReading(state, cursorMs);
      schema =
        first.schema ?? target.dataset.dataset?.profiles.find(({ name }) => name === spec.name)?.type.schema ?? schema;
      display = state?.resource ?? null;
      readingA = first.reading;
      readingB = compareMs === null ? null : getSimulatedReading(state, compareMs).reading;
    } else {
      readingA = unavailable(target.note);
      readingB = compareMs === null ? null : readingA;
    }
    return {
      display: display ?? { name: spec.name, schema, values: [] },
      key,
      name: spec.name,
      onTimeline: spec.onTimeline,
      readingA,
      readingB,
      schema,
      sourceLabel: labels[spec.sourceId] ?? spec.sourceId,
      watched: spec.watched,
    };
  });
}

/**
 * What was read at one instant under one configuration of the inspector. It is only ever shown for that instant and
 * that configuration: see `getCurrentSnapshot`.
 */
export type AtTimeSnapshot<T> = { configKey: string; time: number; value: T };

/** The snapshot if it is what is being asked for now, else null: a reading of another instant is never shown. */
export function getCurrentSnapshot<T>(
  snapshot: AtTimeSnapshot<T> | null,
  timeMs: number | null,
  configKey: string,
): T | null {
  return snapshot && timeMs !== null && snapshot.time === timeMs && snapshot.configKey === configKey
    ? snapshot.value
    : null;
}

/** The window of an exact query for one instant: the samples at it, and the neighbours either side. */
export function getInstantQuery(timeMs: number) {
  const start = toMicros(timeMs);
  return { end: start + 1, fidelity: 'exact' as const, pointBudget: 2, start };
}

/** A value for reading: numbers to a useful precision, the rest as they are. */
export function formatAtTimeValue(value: number | string | null): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? value.toLocaleString()
      : value.toLocaleString(undefined, { maximumSignificantDigits: 8 });
  }
  return value;
}

export const atTimeBasisLabels: Record<AtTimeBasis, string> = {
  computed: 'Computed',
  gap: 'Gap',
  held: 'Held',
  interpolated: 'Interpolated',
  loading: 'Reading…',
  sample: 'Sample',
  unavailable: 'Unavailable',
};

/** How far `ms` is from `from`, to its two largest units: "−2y 202d", "+55s". */
export function formatTimeOffset(ms: number, from: number): string {
  const delta = ms - from;
  const span =
    convertUsToDurationString(Math.abs(delta) * 1000)
      .split(' ')
      .slice(0, 2)
      .join(' ') || '0s';
  return `${delta < 0 ? '−' : '+'}${span}`;
}

/** What a reading is, in words, with the times it rests on (relative to `time`, the instant it was read at). */
export function explainAtTime(reading: AtTimeValue, time: number, formatTime: (ms: number) => string): string {
  const sample = reading.sampleMs;
  const next = reading.nextMs;
  switch (reading.basis) {
    case 'sample':
      return `Recorded at ${formatTime(sample ?? time)}${reading.approximate ? ' (approximate response)' : ''}`;
    case 'held':
      return `Last sample ${formatTimeOffset(sample!, time)} (${formatTime(sample!)}) still in effect${next ? `; next sample ${formatTimeOffset(next, time)}` : ''}`;
    case 'interpolated':
      return `A straight line between the samples at ${formatTimeOffset(sample!, time)} and ${formatTimeOffset(next!, time)}; not recorded`;
    case 'computed':
      return `Read off the simulation's profile${sample !== undefined ? ` (segment from ${formatTimeOffset(sample, time)}${next ? ` to ${formatTimeOffset(next, time)}` : ''})` : ''}; not a recorded sample`;
    case 'gap':
      return `The source records no data here${sample !== undefined ? ` (from ${formatTime(sample)})` : ''}`;
    default:
      return reading.note ?? '';
  }
}

/* What the Analysis hands the time cursor panel, in place of the Plan's stores. */

export type AnalysisCursorResource = {
  /** Display data the timeline holds for it, for the sparkline only (never read for the value). */
  display: Resource;
  /** Identifies it among sources with resources of the same name. */
  key: string;
  name: string;
  /** Plotted by a row of the timeline (so it is not offered a row). */
  onTimeline: boolean;
  readingA: AtTimeValue;
  readingB: AtTimeValue | null;
  schema: ValueSchema;
  sourceLabel: string;
  /** Watched in the inspector, so it can be taken off the list. */
  watched: boolean;
};

export type AnalysisCursorActivityGroup = {
  /** Which cursor, when two are set. */
  cursor: 'A' | 'B' | null;
  sources: { label: string; note?: string; rows: AnalysisActivityRow[]; sourceId: string; total: number }[];
  time: number;
};

export type AnalysisCursorData = {
  activities: AnalysisCursorActivityGroup[];
  /** Where the cursors may go: what the analysis's sources cover. */
  bounds: TimeRange;
  error: string;
  formatTime: (ms: number) => string;
  loading: boolean;
  /** Plotted resources beyond the limit that were not read (watched ones always are). */
  omittedResources: number;
  onSelectActivity: (row: AnalysisActivityRow) => void;
  /** Adds a resource's layer to the timeline, in `row` (a new row when none): absent when the timeline can't be edited. */
  onShowOnTimeline: ((key: string, row?: Row) => void) | null;
  /** Stops watching a resource (a row that is also on the timeline stays). */
  onUnwatch: (key: string) => void;
  /** The keys of the watched resources, as the picker's options name them. */
  onWatchedChange: (keys: string[]) => void;
  /** What can be watched: the bound sources' resources. */
  resourceOptions: DropdownOptions;
  resources: AnalysisCursorResource[];
  /** The sources' lists are still on their way. */
  resourcesLoading: boolean;
  /** The timeline's rows, to place a resource in. */
  rows: Row[];
  /** Bound sources whose resources cannot be offered, and why. */
  unavailableSources: { label: string; reason: string }[];
  /** Why a resource just picked is not watched (the limit on watched resources), or ''. */
  watchNotice: string;
  /** The keys of the watched resources, as the picker's options name them. */
  watchedKeys: string[];
};
