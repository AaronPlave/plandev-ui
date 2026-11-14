import type { TimelineNote } from '../components/timeline/TimelineNotes.svelte';
import type { AnalysisAnnotation } from '../types/analysis';
import type { HorizontalGuide, Timeline, VerticalGuide } from '../types/timeline';
import { getUnixEpochTime } from './time';

export const ANNOTATION_COLOR = '#d97706';

function findTimeGuide(timeline: Timeline | undefined, id: number | undefined): VerticalGuide | undefined {
  return id === undefined ? undefined : timeline?.verticalGuides.find(guide => guide.id === id);
}

function findValueGuide(
  timeline: Timeline | undefined,
  rowId: number | undefined,
  id: number | undefined,
): HorizontalGuide | undefined {
  return id === undefined
    ? undefined
    : timeline?.rows.find(row => row.id === rowId)?.horizontalGuides.find(guide => guide.id === id);
}

/** A guide's DOY timestamp as ISO. */
function isoOf(timestamp: string): string {
  return new Date(getUnixEpochTime(timestamp)).toISOString();
}

/**
 * Notes as the guides they explain are now: a time guide's note takes the guide's time and label (it may have been
 * dragged or renamed), a value guide's note its label and values. A note whose guide is no longer there keeps what
 * it last saw and loses the link. `rowsReplaced`: the rows were replaced wholesale (another layout), so no value
 * guide link can be trusted, even where an id still matches. Returns `notes` itself when nothing changed.
 */
export function syncGuideNotes(
  notes: AnalysisAnnotation[],
  timeline: Timeline | undefined,
  rowsReplaced: boolean = false,
): AnalysisAnnotation[] {
  let changed = false;
  const next = notes.map(note => {
    const { guide } = note;
    if (!guide || guide.id === undefined || !timeline) {
      return note;
    }
    let updated: AnalysisAnnotation;
    if (guide.kind === 'time') {
      const found = findTimeGuide(timeline, guide.id);
      if (!found) {
        updated = { ...note, guide: { ...guide, id: undefined } };
      } else {
        const times = [isoOf(found.timestamp), ...(found.timestamp2 ? [isoOf(found.timestamp2)] : [])].sort();
        updated = {
          ...note,
          end: times[1],
          guide: { ...guide, label: found.label.text },
          start: times[0],
        };
      }
    } else {
      const found = rowsReplaced ? undefined : findValueGuide(timeline, guide.row?.id, guide.id);
      const row = timeline.rows.find(({ id }) => id === guide.row?.id);
      updated = found
        ? {
            ...note,
            guide: {
              ...guide,
              label: found.label.text,
              row: row ? { id: row.id, name: row.name } : guide.row,
              values: found.y2 === undefined ? [found.y] : [found.y, found.y2],
            },
          }
        : { ...note, guide: { ...guide, id: undefined } };
    }
    if (JSON.stringify(updated) === JSON.stringify(note)) {
      return note;
    }
    changed = true;
    return updated;
  });
  return changed ? next : notes;
}

/**
 * An analysis's notes as flags in the timeline's notes lane. A note about a record or a resource is a flag at its time,
 * never a band over the record's whole duration: it is about the record, not about every moment of it. A note
 * explaining a time guide is a flag at the guide (which draws itself); one on a value guide has no time and no flag.
 * A note on an interval the person marked is a bar in the lane.
 */
export function toTimelineNotes(annotations: AnalysisAnnotation[]): TimelineNote[] {
  return annotations.flatMap(({ about, color, end, guide, id, start, text }) =>
    start
      ? [
          {
            color: color ?? ANNOTATION_COLOR,
            endMs: end && !about && !guide ? Date.parse(end) : undefined,
            id,
            startMs: Date.parse(start),
            text: text || guide?.label || about?.name || '',
          },
        ]
      : [],
  );
}

/** What a note is attached to, in a few words, for a list. */
export function describeNoteSubject(note: AnalysisAnnotation, sourceLabel?: string): string {
  const { about, guide } = note;
  if (guide) {
    const what = guide.kind === 'time' ? 'Time guide' : `Value guide${guide.row ? ` in ${guide.row.name}` : ''}`;
    const values = guide.values?.length ? ` (${guide.values.join(' – ')})` : '';
    return `${what} “${guide.label || 'unnamed'}”${values}${guide.id === undefined ? ', no longer on the timeline' : ''}`;
  }
  if (about) {
    return `${about.name}${about.key && about.key !== about.name ? ` (${about.key})` : ''} · ${sourceLabel ?? about.sourceLabel}`;
  }
  return '';
}
