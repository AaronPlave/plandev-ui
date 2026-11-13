import type { AnalysisActivityRow } from '../types/analysis';
import type { ValueSchema } from '../types/schema';
import type { Resource, ResourceValue } from '../types/simulation';
import type { Layer, Row, TimeRange, Timeline } from '../types/timeline';
import type { TimelineSourceId } from '../types/timelineSource';
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
 *  - unavailable:  nothing can be said (outside the data, not loaded, not asked, failed), with the reason.
 */
export type AtTimeBasis = 'computed' | 'gap' | 'held' | 'interpolated' | 'sample' | 'unavailable';

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

/** A resource layer of the timeline: what to read at an instant, and where it is on the timeline. */
export type InspectedResource = {
  layerName: string;
  /** The resource's name within its source. */
  name: string;
  rowId: number;
  rowName: string;
  sourceId: TimelineSourceId;
};

/** Resources read per source and instant: more than this is not a table to read, and not a query to make. */
export const MAX_INSPECTED_RESOURCES = 100;

/**
 * The resources the timeline's rows draw (one entry per source and name, in row order), which is what "the resources
 * being examined" means. Layers that name no source are a Plan's legacy lookup, which an analysis does not have.
 */
export function getInspectedResources(timeline: Timeline | undefined): InspectedResource[] {
  const seen = new Set<string>();
  const out: InspectedResource[] = [];
  (timeline?.rows ?? []).forEach((row: Row) =>
    row.layers.forEach((layer: Layer) => {
      const name = layer.filter.resource;
      if (!name || !layer.sourceId || (layer.chartType !== 'line' && layer.chartType !== 'x-range')) {
        return;
      }
      const key = `${layer.sourceId}::${name}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ layerName: layer.name, name, rowId: row.id, rowName: row.name, sourceId: layer.sourceId });
      }
    }),
  );
  return out;
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
  readingA: AtTimeValue;
  readingB: AtTimeValue | null;
  schema: ValueSchema;
  sourceLabel: string;
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
  /** Resources the timeline plots that were not read (beyond the limit). */
  omittedResources: number;
  onSelectActivity: (row: AnalysisActivityRow) => void;
  resources: AnalysisCursorResource[];
};
