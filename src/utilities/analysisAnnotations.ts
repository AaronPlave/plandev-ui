import type { TimelineNote } from '../components/timeline/TimelineNotes.svelte';
import type { AnalysisNote, AnalysisSourceBinding } from '../types/analysis';
import type { Annotation, Timeline } from '../types/timeline';
import { getSourceIdentity } from './analysis';
import { ANNOTATION_COLOR, detachValueAnnotations, getNextAnnotationId } from './annotations';
import { getDoyTime, getUnixEpochTime } from './time';

/*
 * An analysis's annotations are its timeline's (types/timeline.ts Annotation): marks and findings in one list, saved
 * with the analysis. What an Analysis adds: annotations about its sources' records, notes saved before annotations
 * (translated when it opens), and which annotations go with a layout when it is reused.
 */

export { ANNOTATION_COLOR };

/** An annotation's time, when it has one: a time or range, or a record's start. */
export function getAnnotationTimes(annotation: Annotation): { endMs?: number; startMs?: number } {
  const { anchor } = annotation;
  if (anchor.kind === 'time') {
    const times = [anchor.start, ...(anchor.end ? [anchor.end] : [])].map(getUnixEpochTime).sort((a, b) => a - b);
    return { endMs: times[1], startMs: times[0] };
  }
  if (anchor.kind === 'record' && anchor.start) {
    return { startMs: Date.parse(anchor.start) };
  }
  return {};
}

/** The analysis's annotations in time order; those without a time (values, findings) after. */
export function sortAnnotations(annotations: Annotation[]): Annotation[] {
  return [...annotations].sort(
    (a, b) => (getAnnotationTimes(a).startMs ?? Infinity) - (getAnnotationTimes(b).startMs ?? Infinity),
  );
}

/** What an annotation marks, in a few words. */
export function describeAnchor(annotation: Annotation, sourceLabel?: string): string {
  const { anchor } = annotation;
  switch (anchor.kind) {
    case 'time':
      return anchor.end ? 'Time range' : 'Time';
    case 'value': {
      const values = `${anchor.y}${anchor.y2 !== undefined ? ` – ${anchor.y2}` : ''}${anchor.units ? ` ${anchor.units}` : ''}`;
      const where = anchor.rowId === null ? `${anchor.rowName ?? 'a row'} (no longer shown)` : anchor.rowName;
      return `${anchor.y2 !== undefined ? 'Value range' : 'Value'} ${values}${where ? ` · ${where}` : ''}`;
    }
    case 'record':
      return `${anchor.record.recordKind ?? (anchor.record.kind === 'activity' ? 'Record' : 'Resource')} · ${sourceLabel ?? anchor.record.sourceLabel}`;
    default:
      return 'Finding';
  }
}

/** Why a record annotation can't be gone to as it was written, or null when it can (or is not about a record). */
export function getStaleReason(annotation: Annotation, bindings: AnalysisSourceBinding[]): string | null {
  if (annotation.anchor.kind !== 'record') {
    return null;
  }
  const { record } = annotation.anchor;
  const binding = bindings.find(({ id }) => id === record.sourceId);
  if (!binding) {
    return `${record.sourceLabel} is no longer in this analysis.`;
  }
  const now = getSourceIdentity(binding);
  return now === record.data
    ? null
    : `Written when ${record.sourceLabel} read ${record.data}; it now reads ${now}. Not checked against it.`;
}

/**
 * Record annotations as flags at the record's start, in the lane under the time axis: never a band over a record's
 * whole duration (it is about the record, not every moment of it). Time and value annotations draw as guides.
 */
export function toTimelineNotes(annotations: Annotation[]): TimelineNote[] {
  return annotations.flatMap(annotation =>
    annotation.anchor.kind === 'record' && annotation.anchor.start
      ? [
          {
            color: annotation.color ?? ANNOTATION_COLOR,
            id: annotation.id,
            startMs: Date.parse(annotation.anchor.start),
            text: annotation.label || annotation.description || annotation.anchor.record.name,
          },
        ]
      : [],
  );
}

function firstLine(text: string): string {
  const line = text.split('\n')[0].trim();
  return line.length > 48 ? `${line.slice(0, 47)}…` : line;
}

function joinText(a: string | undefined, b: string): string | undefined {
  return [a, b].filter(text => text?.trim()).join('\n\n') || undefined;
}

/**
 * Notes saved before annotations were one thing (an analysis's `definition.annotations`), as annotations of its
 * timeline: a note about a record becomes a record annotation; a note explaining a time or value guide becomes that
 * annotation's description (not a second annotation); a note on a time alone, or on a guide no longer there, becomes
 * a time annotation, or a value annotation whose row is no longer shown; anything else a finding. Every note keeps
 * its words, color, author and id (`legacyNoteId`, for links to it). The timeline itself when there are none.
 */
export function notesToAnnotations(notes: AnalysisNote[], timeline: Timeline): Timeline {
  if (!notes.length) {
    return timeline;
  }
  const annotations = [...timeline.annotations];
  let nextId = getNextAnnotationId([timeline]);
  const common = (note: AnalysisNote) => ({
    ...(note.color ? { color: note.color } : {}),
    createdAt: note.createdAt,
    ...(note.createdBy ? { createdBy: note.createdBy } : {}),
    legacyNoteId: note.id,
  });
  notes.forEach(note => {
    const { about, guide } = note;
    if (about) {
      annotations.push({
        ...common(note),
        anchor: {
          kind: 'record',
          record: {
            ...(about.activityId !== undefined ? { activityId: about.activityId } : {}),
            data: about.data,
            ...(about.key ? { key: about.key } : {}),
            kind: about.kind,
            name: about.name,
            sourceId: about.sourceId,
            sourceLabel: about.sourceLabel,
          },
          ...(note.start ? { start: note.start } : {}),
        },
        ...(note.text.trim() ? { description: note.text } : {}),
        id: nextId++,
        label: about.name,
      });
      return;
    }
    // A note explaining a guide still on the timeline: its words become that annotation's.
    const explained =
      guide?.kind === 'time' && guide.id !== undefined
        ? annotations.find(({ anchor, id }) => anchor.kind === 'time' && id === guide.id)
        : guide?.kind === 'value'
          ? annotations.find(
              ({ anchor }) =>
                anchor.kind === 'value' &&
                anchor.rowId !== null &&
                anchor.rowId === guide.row?.id &&
                anchor.y === guide.values?.[0],
            )
          : undefined;
    if (explained) {
      const index = annotations.indexOf(explained);
      annotations[index] = { ...explained, description: joinText(explained.description, note.text) };
      return;
    }
    const label = guide?.label || firstLine(note.text) || 'Note';
    const description = note.text.trim() && note.text.trim() !== label ? note.text : undefined;
    const base = { ...common(note), ...(description ? { description } : {}), id: nextId++, label };
    if (guide?.kind === 'value' && guide.values?.length) {
      annotations.push({
        ...base,
        anchor: {
          kind: 'value',
          rowId: null,
          ...(guide.row ? { rowName: guide.row.name } : {}),
          y: guide.values[0],
          ...(guide.values[1] !== undefined ? { y2: guide.values[1] } : {}),
          yAxisId: -1,
        },
      });
    } else if (note.start) {
      annotations.push({
        ...base,
        anchor: {
          kind: 'time',
          start: getDoyTime(new Date(note.start)),
          ...(note.end ? { end: getDoyTime(new Date(note.end)) } : {}),
        },
      });
    } else {
      annotations.push({ ...base, anchor: { kind: 'general' } });
    }
  });
  return { ...timeline, annotations };
}

/** Whether an annotation can go with a saved View: a mark of a time or a value, not a finding about records. */
export function canBeReusable(annotation: Annotation): boolean {
  // Marks of a time or a value read the same over other data; a record's or a general finding is this analysis's.
  return annotation.anchor.kind === 'time' || annotation.anchor.kind === 'value';
}

/** The annotations saved with a layout: the chosen ones (by id) that can be, marked reusable. */
export function getLayoutAnnotations(annotations: Annotation[], include: Set<number>): Annotation[] {
  return annotations.flatMap(annotation =>
    include.has(annotation.id) && canBeReusable(annotation) ? [{ ...annotation, reusable: true }] : [],
  );
}

/**
 * The annotations of an analysis whose rows are replaced by another presentation's. Its own findings (not reusable)
 * stay; value annotations among them were on rows that are gone, so they say so instead of moving to whichever new
 * row has the same id. Its reusable annotations were part of the presentation being replaced, and go with it. The
 * presentation's reusable annotations come in (renumbered), when `bring`; a value annotation of a row it doesn't keep
 * is left out.
 */
export function mergeAnnotationsForLayout(current: Annotation[], incoming: Timeline, bring: boolean): Annotation[] {
  const own = detachValueAnnotations(
    current.filter(annotation => !annotation.reusable),
    new Set(),
  );
  if (!bring) {
    return own;
  }
  const rowIds = new Set(incoming.rows.map(({ id }) => id));
  let nextId = getNextAnnotationId([{ annotations: own }]);
  const brought = incoming.annotations.flatMap(annotation =>
    annotation.reusable &&
    canBeReusable(annotation) &&
    (annotation.anchor.kind !== 'value' || (annotation.anchor.rowId !== null && rowIds.has(annotation.anchor.rowId)))
      ? [{ ...annotation, id: nextId++ }]
      : [],
  );
  return [...own, ...brought];
}
