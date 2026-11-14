import type { TimelineNote } from '../components/timeline/TimelineNotes.svelte';
import type { AnalysisAnnotation } from '../types/analysis';

export const ANNOTATION_COLOR = '#d97706';

/** An analysis's notes as the timeline draws them. */
export function toTimelineNotes(annotations: AnalysisAnnotation[]): TimelineNote[] {
  return annotations.map(({ color, end, id, start, text }) => ({
    color: color ?? ANNOTATION_COLOR,
    endMs: end ? Date.parse(end) : undefined,
    id,
    startMs: Date.parse(start),
    text,
  }));
}
