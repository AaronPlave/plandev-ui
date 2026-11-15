import type { TimelineNote } from '../components/timeline/TimelineNotes.svelte';
import type { AnalysisAnnotation } from '../types/analysis';
import type { Timeline, VerticalGuide } from '../types/timeline';
import { getDoyTime, getUnixEpochTime } from './time';

/*
 * An analysis's annotations, as one concept over two stores:
 * - a mark across the rows (a time or a time range) or on a row (a value or a value range) is a guide of the
 *   analysis's own timeline, with an optional description: it is saved with the analysis, and goes into a saved
 *   layout only when chosen;
 * - a mark on a record or a resource (and a value mark whose row was replaced) is an AnalysisAnnotation, saved with the
 *   analysis only, never with a layout.
 * Each is addressed by a key: "time:<guideId>", "value:<rowId>:<guideId>", "note:<id>".
 */

export const ANNOTATION_COLOR = '#d97706';

export type AnnotationItem = {
  color: string;
  description: string;
  endMs?: number;
  key: string;
  kind: 'record' | 'time' | 'unanchored' | 'value';
  label: string;
  /** For 'record' and 'unanchored': the stored annotation. */
  note?: AnalysisAnnotation;
  row?: { id: number; name: string };
  startMs?: number;
  values?: number[];
};

export function timeKey(guideId: number): string {
  return `time:${guideId}`;
}

export function valueKey(rowId: number, guideId: number): string {
  return `value:${rowId}:${guideId}`;
}

export function noteKey(id: number): string {
  return `note:${id}`;
}

export type ParsedAnnotationKey =
  | { guideId: number; kind: 'time' }
  | { guideId: number; kind: 'value'; rowId: number }
  | { id: number; kind: 'note' };

export function parseAnnotationKey(key: string): ParsedAnnotationKey | null {
  const [kind, a, b] = key.split(':');
  if (kind === 'time' && a) {
    return { guideId: Number(a), kind };
  }
  if (kind === 'value' && a && b) {
    return { guideId: Number(b), kind, rowId: Number(a) };
  }
  if (kind === 'note' && a) {
    return { id: Number(a), kind };
  }
  return null;
}

function guideTimes(guide: VerticalGuide): { endMs?: number; startMs: number } {
  const times = [guide.timestamp, ...(guide.timestamp2 ? [guide.timestamp2] : [])].map(getUnixEpochTime).sort();
  return { endMs: times[1], startMs: times[0] };
}

/** Every annotation of the analysis, in time order (value marks, which have no time, after). */
export function listAnnotations(timeline: Timeline | undefined, notes: AnalysisAnnotation[]): AnnotationItem[] {
  const items: AnnotationItem[] = [
    ...(timeline?.verticalGuides ?? []).map(
      (guide): AnnotationItem => ({
        ...guideTimes(guide),
        color: guide.label.color ?? ANNOTATION_COLOR,
        description: guide.description ?? '',
        key: timeKey(guide.id),
        kind: 'time',
        label: guide.label.text,
      }),
    ),
    ...(timeline?.rows ?? []).flatMap(row =>
      row.horizontalGuides.map(
        (guide): AnnotationItem => ({
          color: guide.label.color ?? ANNOTATION_COLOR,
          description: guide.description ?? '',
          key: valueKey(row.id, guide.id),
          kind: 'value',
          label: guide.label.text,
          row: { id: row.id, name: row.name },
          values: guide.y2 === undefined ? [guide.y] : [guide.y, guide.y2],
        }),
      ),
    ),
    ...notes.map(
      (note): AnnotationItem => ({
        color: note.color ?? ANNOTATION_COLOR,
        description: note.text,
        endMs: note.end ? Date.parse(note.end) : undefined,
        key: noteKey(note.id),
        kind: note.about ? 'record' : 'unanchored',
        label: note.about?.name ?? note.guide?.label ?? '',
        note,
        row: note.guide?.row,
        startMs: note.start ? Date.parse(note.start) : undefined,
        values: note.guide?.values,
      }),
    ),
  ];
  return items.sort((a, b) => (a.startMs ?? Infinity) - (b.startMs ?? Infinity));
}

function firstLine(text: string): string {
  const line = text.split('\n')[0].trim();
  return line.length > 48 ? `${line.slice(0, 47)}…` : line;
}

function joinText(a: string | undefined, b: string): string {
  return [a, b].filter(text => text?.trim()).join('\n\n');
}

/**
 * Notes saved before annotations were one thing, as annotations: a note explaining a guide becomes that guide's
 * description; a note on a time or an interval alone, or on a time guide no longer there, becomes a time annotation (a
 * guide) with its words; a note on a value guide no longer there stays a note (its row is gone: it has nowhere to be
 * drawn). Notes about a record or a resource are unchanged. Nothing is dropped but empty explanations of guides, and
 * nothing is made twice: a converted note is removed. Returns the inputs themselves when there is nothing to convert.
 */
export function migrateLegacyNotes(
  notes: AnalysisAnnotation[],
  timeline: Timeline,
): { notes: AnalysisAnnotation[]; timeline: Timeline } {
  const legacy = (note: AnalysisAnnotation) =>
    !note.about && (note.guide ? note.guide.kind === 'time' || note.guide.id !== undefined : !!note.start);
  if (!notes.some(legacy)) {
    return { notes, timeline };
  }
  const next: Timeline = structuredClone(timeline);
  let nextGuideId = Math.max(-1, ...next.verticalGuides.map(({ id }) => id)) + 1;
  const kept = notes.filter(note => {
    if (!legacy(note)) {
      return true;
    }
    const { guide } = note;
    if (guide?.kind === 'value') {
      const found = next.rows.find(row => row.id === guide.row?.id)?.horizontalGuides.find(({ id }) => id === guide.id);
      if (!found) {
        return true; // its row was replaced: kept as an unanchored note
      }
      found.description = joinText(found.description, note.text) || undefined;
      return false;
    }
    const found = guide?.id !== undefined ? next.verticalGuides.find(({ id }) => id === guide.id) : undefined;
    if (found) {
      found.description = joinText(found.description, note.text) || undefined;
      return false;
    }
    if (!note.start) {
      return !!note.text.trim(); // nothing to place it at; keep the words
    }
    const label = guide?.label || firstLine(note.text) || 'Note';
    next.verticalGuides.push({
      ...(note.text.trim() && note.text.trim() !== label ? { description: note.text } : {}),
      id: nextGuideId++,
      label: { color: note.color ?? ANNOTATION_COLOR, text: label },
      timestamp: getDoyTime(new Date(note.start)),
      ...(note.end ? { timestamp2: getDoyTime(new Date(note.end)) } : {}),
    });
    return false;
  });
  return { notes: kept, timeline: next };
}

/**
 * Annotations about records and resources as flags at the record's time, in the lane under the time axis: never a
 * band over a record's whole duration (a note is about the record, not every moment of it). Marks across or on the
 * rows are guides, which draw themselves.
 */
export function toTimelineNotes(annotations: AnalysisAnnotation[]): TimelineNote[] {
  return annotations.flatMap(({ about, color, id, start, text }) =>
    about && start
      ? [{ color: color ?? ANNOTATION_COLOR, id, startMs: Date.parse(start), text: text || about.name }]
      : [],
  );
}

/** A timeline with only the chosen annotations (guides by key); the others are left out. */
export function keepAnnotations(timeline: Timeline, include: Set<string>): Timeline {
  return {
    ...timeline,
    rows: timeline.rows.map(row => ({
      ...row,
      horizontalGuides: row.horizontalGuides.filter(guide => include.has(valueKey(row.id, guide.id))),
    })),
    verticalGuides: timeline.verticalGuides.filter(guide => include.has(timeKey(guide.id))),
  };
}

/** A timeline whose marks keep their place and label but say nothing: what another analysis concluded stays there. */
export function withoutDescriptions(timeline: Timeline): Timeline {
  return {
    ...timeline,
    rows: timeline.rows.map(row => ({
      ...row,
      horizontalGuides: row.horizontalGuides.map(({ description: _, ...guide }) => guide),
    })),
    verticalGuides: timeline.verticalGuides.map(({ description: _, ...guide }) => guide),
  };
}

/**
 * Value annotations with an explanation on rows that `replacement` replaces: kept as unanchored annotations (their
 * words, label, row and values as they were), so replacing a layout loses no one's explanation.
 */
export function getDisplacedValueAnnotations(
  previous: Timeline,
  firstId: number,
  createdBy?: string,
): AnalysisAnnotation[] {
  let id = firstId;
  return previous.rows.flatMap(row =>
    row.horizontalGuides
      .filter(guide => guide.description?.trim())
      .map(guide => ({
        color: guide.label.color,
        createdAt: new Date().toISOString(),
        createdBy,
        guide: {
          kind: 'value' as const,
          label: guide.label.text,
          row: { id: row.id, name: row.name },
          values: guide.y2 === undefined ? [guide.y] : [guide.y, guide.y2],
        },
        id: id++,
        text: guide.description ?? '',
      })),
  );
}

/** What an annotation marks, in a few words. */
export function describeAnnotation(item: AnnotationItem, sourceLabel?: string): string {
  switch (item.kind) {
    case 'time':
      return item.endMs === undefined ? 'Time' : 'Time range';
    case 'value':
      return `${item.values?.length === 2 ? 'Value range' : 'Value'} ${item.values?.join(' – ')} · ${item.row?.name}`;
    case 'record': {
      const about = item.note?.about;
      return about
        ? `${about.kind === 'activity' ? 'Activity' : 'Resource'} · ${sourceLabel ?? about.sourceLabel}`
        : '';
    }
    default:
      return item.values?.length
        ? `Was on ${item.row?.name ?? 'a row'} at ${item.values.join(' – ')} (row no longer shown)`
        : 'Not placed on the timeline';
  }
}
