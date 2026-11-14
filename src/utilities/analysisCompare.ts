import { isEqual } from 'lodash-es';

/*
 * Comparing two activities a person picked. Nothing here decides that two records are the same event: the caller
 * supplies both, and the result only states what the two records say and how they differ. Every number in it is
 * computed from the records' own times; the reading of it is the person's.
 */

/** One side of a comparison: an activity as its source recorded it. */
export type ComparedActivity = {
  /** What the source or its adapter says limits the record itself (e.g. an end the file did not really give). */
  cautions?: string[];
  /** Null when the source records no end (a plan directive). */
  endMs: number | null;
  /** The record's identity in its own source: a source key, a span id, a directive id. */
  key: string;
  name: string;
  parameters: Record<string, unknown>;
  /** The data the record came from, e.g. "imported:110": two bindings of the same data compare as the same source. */
  sourceIdentity: string;
  startMs: number;
  type: string;
};

export type ParameterComparison = {
  a: unknown;
  b: unknown;
  name: string;
  status: 'differs' | 'onlyA' | 'onlyB' | 'same';
};

export type ActivityComparison = {
  /** b − a. Null when either record has no end. */
  durationDeltaMs: number | null;
  endDeltaMs: number | null;
  /** How the two intervals sit in time: how long they overlap, or the gap between them. */
  interval: { kind: 'gap' | 'overlap'; ms: number };
  /** Things that limit what the comparison can establish. */
  notes: string[];
  parameters: ParameterComparison[];
  sameKey: boolean;
  sameSource: boolean;
  sameType: boolean;
  startDeltaMs: number;
};

export function compareActivities(a: ComparedActivity, b: ComparedActivity): ActivityComparison {
  const aEnd = a.endMs ?? a.startMs;
  const bEnd = b.endMs ?? b.startMs;
  const bothEnd = a.endMs !== null && b.endMs !== null;
  const overlap = Math.min(aEnd, bEnd) - Math.max(a.startMs, b.startMs);
  const names = [...new Set([...Object.keys(a.parameters), ...Object.keys(b.parameters)])].sort();
  const parameters = names.map((name): ParameterComparison => {
    const inA = name in a.parameters;
    const inB = name in b.parameters;
    const status = !inA ? 'onlyB' : !inB ? 'onlyA' : isEqual(a.parameters[name], b.parameters[name]) ? 'same' : 'differs';
    return { a: a.parameters[name], b: b.parameters[name], name, status };
  });
  const sameSource = a.sourceIdentity === b.sourceIdentity;
  const sameKey = a.key === b.key;
  const notes: string[] = [...(a.cautions ?? []), ...(b.cautions ?? [])];
  if (sameSource && sameKey) {
    notes.push('Both sides are the same record.');
  }
  if (!bothEnd) {
    notes.push('One record has no end, so end and duration cannot be compared.');
  }
  if (overlap < 0) {
    notes.push('The two records do not overlap in time.');
  }
  if (!parameters.some(parameter => parameter.status === 'same')) {
    notes.push('The records share no parameter value: nothing in them says they describe the same event.');
  }
  return {
    durationDeltaMs: bothEnd ? bEnd - b.startMs - (aEnd - a.startMs) : null,
    endDeltaMs: bothEnd ? bEnd - aEnd : null,
    interval: { kind: overlap < 0 ? 'gap' : 'overlap', ms: Math.abs(overlap) },
    notes,
    parameters,
    sameKey,
    sameSource,
    sameType: a.type === b.type,
    startDeltaMs: b.startMs - a.startMs,
  };
}

/** A signed duration, to the millisecond when it has one: "+7m 30s", "−25m", "0s". */
export function formatDelta(ms: number): string {
  if (ms === 0) {
    return '0s';
  }
  const abs = Math.abs(ms);
  const parts: [number, string][] = [
    [Math.floor(abs / 864e5), 'd'],
    [Math.floor(abs / 36e5) % 24, 'h'],
    [Math.floor(abs / 6e4) % 60, 'm'],
    [Math.floor(abs / 1e3) % 60, 's'],
    [abs % 1e3, 'ms'],
  ];
  const text = parts
    .filter(([value]) => value)
    .map(([value, unit]) => `${value}${unit}`)
    .join(' ');
  return `${ms < 0 ? '−' : '+'}${text}`;
}

/** The computed facts of a comparison as plain text, for a note. States what was compared; concludes nothing. */
export function describeComparison(
  a: ComparedActivity & { sourceLabel: string },
  b: ComparedActivity & { sourceLabel: string },
  comparison: ActivityComparison,
): string {
  const differing = comparison.parameters.filter(parameter => parameter.status === 'differs');
  const same = comparison.parameters.filter(parameter => parameter.status === 'same');
  return [
    `Compared ${a.name} (${a.key}, ${a.sourceLabel}) with ${b.name} (${b.key}, ${b.sourceLabel}).`,
    `Computed: start ${formatDelta(comparison.startDeltaMs)}` +
      (comparison.endDeltaMs === null
        ? ''
        : `, end ${formatDelta(comparison.endDeltaMs)}, duration ${formatDelta(comparison.durationDeltaMs ?? 0)}`) +
      '.',
    same.length ? `Same in both: ${same.map(({ name }) => name).join(', ')}.` : '',
    differing.length
      ? `Different: ${differing.map(({ a, b, name }) => `${name} (${JSON.stringify(a)} vs ${JSON.stringify(b)})`).join(', ')}.`
      : '',
    ...comparison.notes,
  ]
    .filter(Boolean)
    .join('\n');
}
