import type { ValueSchema } from '../types/schema';
import type { Profile, Resource, ResourceValue } from '../types/simulation';
import { convertUsToDurationString, getIntervalInMs } from './time';

// First-fetch sentinel for windowed profile pulls: smaller than any real
// start_offset, so the windowed query returns every existing segment.
// Postgres interval syntax (HH:MM:SS) — Hasura's interval scalar rejects
// ISO 8601.
export const INITIAL_SINCE = '-00:00:01';

/**
 * Samples a list of profiles at their change points. Converts the sampled profiles to Resources.
 */
export function sampleProfiles(
  profiles: Profile[] | null,
  startTimeYmd: string | null,
  offsetInterval?: string,
): Resource[] {
  const resources: Resource[] = [];

  if (profiles && startTimeYmd) {
    const offsetMs = getIntervalInMs(offsetInterval);
    const start = new Date(startTimeYmd).getTime() + offsetMs;

    for (const profile of profiles) {
      const { duration, name, profile_segments, type: profileType } = profile;
      const { schema, type } = profileType;
      const durationMs = getIntervalInMs(duration);
      const values: ResourceValue[] = [];

      for (let i = 0; i < profile_segments.length; ++i) {
        const segment = profile_segments[i];
        const nextSegment = profile_segments[i + 1];

        const segmentOffset = getIntervalInMs(segment.start_offset);
        const nextSegmentOffset = nextSegment ? getIntervalInMs(nextSegment.start_offset) : durationMs;

        const { dynamics, is_gap } = segment;

        if (type === 'discrete') {
          values.push({
            is_gap,
            x: start + segmentOffset,
            y: dynamics,
          });
          values.push({
            is_gap,
            // Tagged rather than inferred: a real segment with a rate of 0 also produces two values
            // with the same y, and dropping *its* closing value would turn a flat run followed by a
            // jump into a ramp. Only the profile type knows the difference, and only here.
            is_hold: true,
            x: start + nextSegmentOffset,
            y: dynamics,
          });
        } else if (type === 'real' && dynamics == null) {
          // A gap, as Merlin writes it: is_gap = true with null dynamics. There is no {initial, rate}
          // to evaluate; a null y is what LayerLine already treats as "no value".
          values.push({ is_gap, x: start + segmentOffset, y: null });
          values.push({ is_gap, x: start + nextSegmentOffset, y: null });
        } else if (type === 'real') {
          values.push({
            is_gap,
            x: start + segmentOffset,
            y: dynamics.initial,
          });
          values.push({
            is_gap,
            x: start + nextSegmentOffset,
            y: dynamics.initial + dynamics.rate * ((nextSegmentOffset - segmentOffset) / 1000),
          });
        }
      }

      resources.push({ name, schema, values });
    }
  }

  return resources;
}

export type ResourceValueAtTime = {
  /** True when the cursor lands on a profile gap, so `value` is null for lack of data rather than a real null. */
  isGap: boolean;
  value: number | string | null;
};

/**
 * Whether a schema's values can be meaningfully averaged. Deliberately an allowlist mirroring the
 * timeline's own line-layer check (`LayerLine.svelte#resourcesToLinePoints`): anything else — an
 * enum, a boolean, or a struct carrying a composite payload — steps instead, because interpolating
 * it would either be meaningless or produce NaN.
 */
export function isNumericSchema(schema: ValueSchema): boolean {
  if (schema.type === 'int' || schema.type === 'real' || schema.type === 'duration') {
    return true;
  }
  return (
    schema.type === 'struct' && schema.items?.rate?.type === 'real' && schema.items?.initial?.type === 'real'
  );
}

/** Index of the first value whose x is strictly greater than `timeMs`. */
function firstIndexAfter(values: ResourceValue[], timeMs: number): number {
  let low = 0;
  let high = values.length;

  while (low < high) {
    const mid = (low + high) >>> 1;
    if (values[mid].x <= timeMs) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

function isUsable(value: ResourceValue | undefined): boolean {
  return value !== undefined && !value.is_gap && value.y !== null && value.y !== undefined;
}

/**
 * Resolves the value of a sampled resource at an arbitrary time.
 *
 * `Resource.values` is a time-sorted piecewise-linear polyline in absolute unix ms (see
 * `sampleProfiles`), so this brackets `timeMs` with a binary search and then either interpolates
 * or snaps to the nearer neighbor.
 *
 * Semantics deliberately mirror the timeline's hover tooltip
 * (`LayerLine.svelte#onMousemove`) so the inspector panel and the tooltip can never disagree
 * about the same profile at the same time: the left neighbor is the *last* value at or before
 * `timeMs` (which is what makes a step land on the new value exactly at a segment boundary), the
 * right neighbor is the first value after it, either neighbor being a gap yields no value, and
 * `interpolate === false` snaps at the halfway point.
 *
 * The one intentional divergence: `LayerLine` also uses the pointer's y position to disambiguate
 * between several resources sharing a layer. There is no pointer here, and callers resolve one
 * resource at a time, so that step has no analogue.
 */
export function getResourceValueAtTime(
  resource: Resource,
  timeMs: number,
  interpolate: boolean,
): ResourceValueAtTime {
  const { schema, values } = resource;

  if (!values.length) {
    return { isGap: false, value: null };
  }

  const firstAfter = firstIndexAfter(values, timeMs);
  const left = values[firstAfter - 1];
  const right = values[firstAfter];

  // Outside the sampled extent on either side there is nothing to bracket, so fall back to the
  // single adjacent value the way the tooltip does at the edges of the data.
  if (left === undefined || right === undefined) {
    const edge = left ?? right;
    if (!isUsable(edge)) {
      return { isGap: edge?.is_gap === true, value: null };
    }
    return { isGap: false, value: edge.y };
  }

  if (!isUsable(left) || !isUsable(right)) {
    return { isGap: left.is_gap === true || right.is_gap === true, value: null };
  }

  const percent = (timeMs - left.x) / (right.x - left.x);

  if (!interpolate || !isNumericSchema(schema)) {
    // Stepping takes the left value rather than the nearer one, so a held value stays correct right
    // up to the moment it changes.
    return { isGap: false, value: interpolate ? left.y : percent < 0.5 ? left.y : right.y };
  }

  return {
    isGap: false,
    value: (1 - percent) * (left.y as number) + percent * (right.y as number),
  };
}

/**
 * Renders a resolved resource value for display, applying the same unit suffix and duration
 * conversion the timeline tooltip uses (see `TimelineTooltip.svelte#textForLinePoint`).
 */
export function formatResourceValue(
  value: number | string | null,
  schema: ValueSchema,
  includeUnit: boolean = true,
): string {
  if (value === null || value === undefined) {
    return '';
  }

  const unit = includeUnit ? (schema.metadata?.unit?.value ?? '') : '';
  let formatted: string;

  if (schema.type === 'duration' && typeof value === 'number' && value > 0) {
    // Duration resources are stored in microseconds.
    formatted = convertUsToDurationString(value);
  } else if (typeof value === 'object') {
    // Struct/series resources carry a composite payload; `${value}` would render "[object Object]".
    formatted = JSON.stringify(value);
  } else {
    formatted = `${value}`;
  }

  return unit ? `${formatted} (${unit})` : formatted;
}

/**
 * Formats a resource number for a dense inspector column: large magnitudes collapse to a G/M
 * suffix, mid-range values get thousands separators, and small ones keep a fixed number of
 * decimals. Without this a raw simulated value renders as `108.08590357490047`, which is both
 * unreadable and destroys column alignment.
 */
export function formatResourceNumber(value: number | null | undefined, decimals: number = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '–';
  }

  const magnitude = Math.abs(value);
  if (magnitude >= 1e9) {
    return `${(value / 1e9).toFixed(2)}G`;
  }
  if (magnitude >= 1e6) {
    return `${(value / 1e6).toFixed(2)}M`;
  }
  if (magnitude >= 1e4) {
    return Math.round(value).toLocaleString('en-US');
  }
  return value.toFixed(decimals);
}

/** Decimal places to show for a schema, since resource metadata does not carry a precision hint. */
export function getResourceDecimals(schema: ValueSchema): number {
  return schema.type === 'int' ? 0 : 2;
}

export type ResourceWindowStats = {
  /** Time integral of the value over the window, in value-milliseconds. */
  area: number;
  /** Time-weighted mean — the honest average for a signal held for uneven durations. */
  avg: number;
  durationMs: number;
  max: number;
  min: number;
  /** Number of sampled segments contributing to the window. */
  sampleCount: number;
};

/**
 * Time-weighted statistics for a numeric resource between two times.
 *
 * Integrates trapezoidally over the sampled polyline. That is exact for both profile kinds without
 * needing to branch on the schema: `sampleProfiles` emits segment endpoints for real profiles (so
 * the ramp is linear between them) and duplicated values for discrete ones (so each segment is
 * flat). A plain mean over samples would be wrong — samples are not evenly spaced.
 */
export function getResourceWindowStats(
  resource: Resource,
  startMs: number,
  endMs: number,
): ResourceWindowStats | null {
  const { values } = resource;
  const t0 = Math.min(startMs, endMs);
  const t1 = Math.max(startMs, endMs);

  if (!values.length) {
    return null;
  }

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let area = 0;
  let durationMs = 0;
  let sampleCount = 0;

  for (let i = 0; i < values.length - 1; i++) {
    const left = values[i];
    const right = values[i + 1];
    if (!isUsable(left) || !isUsable(right)) {
      continue;
    }

    const segmentStart = Math.max(left.x, t0);
    const segmentEnd = Math.min(right.x, t1);
    if (segmentEnd <= segmentStart) {
      continue;
    }

    const interval = right.x - left.x || 1;
    const leftY = left.y as number;
    const rightY = right.y as number;
    // Clip the segment's endpoints to the window before integrating, so a window that starts or
    // ends mid-segment is weighted by the part that is actually inside it.
    const valueAtStart = leftY + (rightY - leftY) * ((segmentStart - left.x) / interval);
    const valueAtEnd = leftY + (rightY - leftY) * ((segmentEnd - left.x) / interval);
    const dt = segmentEnd - segmentStart;

    area += ((valueAtStart + valueAtEnd) / 2) * dt;
    durationMs += dt;
    sampleCount++;
    min = Math.min(min, valueAtStart, valueAtEnd);
    max = Math.max(max, valueAtStart, valueAtEnd);
  }

  if (durationMs <= 0) {
    // A zero-width window still has a defined value; report it as a degenerate window rather than
    // nothing, so the UI does not blank out while the two cursors coincide.
    const { value } = getResourceValueAtTime(resource, t0, true);
    if (typeof value !== 'number') {
      return null;
    }
    return { area: 0, avg: value, durationMs: 0, max: value, min: value, sampleCount: 0 };
  }

  return { area, avg: area / durationMs, durationMs, max, min, sampleCount };
}

export type ResourceSparkline = {
  /** SVG path in the given box. */
  d: string;
  max: number;
  min: number;
};

/**
 * Builds a decimated SVG path for a resource across a fixed time domain, normalized to the
 * resource's own value range so the shape fills the box regardless of magnitude.
 *
 * Decimated to `maxPoints` because a sparkline is read as a shape, not as data — carrying thousands
 * of points per row would cost far more than it conveys.
 */
export function getResourceSparkline(
  resource: Resource,
  domainStartMs: number,
  domainEndMs: number,
  width: number,
  height: number,
  maxPoints: number = 56,
): ResourceSparkline | null {
  const numeric = resource.values.filter(value => isUsable(value) && typeof value.y === 'number');
  if (numeric.length < 2 || domainEndMs <= domainStartMs || width <= 0 || height <= 0) {
    return null;
  }

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of numeric) {
    min = Math.min(min, value.y as number);
    max = Math.max(max, value.y as number);
  }

  const range = max - min || 1;
  const span = domainEndMs - domainStartMs;
  const step = Math.max(1, Math.floor(numeric.length / maxPoints));
  let d = '';

  for (let i = 0; i < numeric.length; i += step) {
    const value = numeric[i];
    const x = ((value.x - domainStartMs) / span) * width;
    const y = height - 1.5 - (((value.y as number) - min) / range) * (height - 3);
    d += `${d ? ' L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }

  return { d, max, min };
}

/** Y position of a value within a sparkline box built by `getResourceSparkline`. */
export function getSparklineY(spark: ResourceSparkline, value: number, height: number): number {
  const range = spark.max - spark.min || 1;
  const y = height - 1.5 - ((value - spark.min) / range) * (height - 3);
  return Number.isNaN(y) ? height / 2 : y;
}
