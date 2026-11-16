import { expect, test } from 'vitest';
import type { AnalysisNote } from '../types/analysis';
import type { Annotation, Row } from '../types/timeline';
import {
  getLayoutAnnotations,
  mergeAnnotationsForLayout,
  notesToAnnotations,
  toTimelineNotes,
} from './analysisAnnotations';
import { createTimeline } from './timeline';

const note = (extra: Partial<AnalysisNote>): AnalysisNote => ({
  createdAt: '2026-11-14T00:00:00Z',
  id: 1,
  text: 'Contact started late',
  ...extra,
});

const about = {
  data: 'revision:217',
  kind: 'activity' as const,
  name: 'ALLOCATION',
  sourceId: 's',
  sourceLabel: 'PEF',
};

const timeAnnotation: Annotation = {
  anchor: { end: '2026-147T18:10:00.000', kind: 'time', start: '2026-147T14:10:00.000' },
  id: 4,
  label: 'Planned contact',
};
const valueAnnotation: Annotation = {
  anchor: { kind: 'value', rowId: 2, rowName: 'Battery', y: 28, y2: 32, yAxisId: 0 },
  id: 9,
  label: 'Nominal',
};

const timeline = () =>
  createTimeline([], {
    annotations: [timeAnnotation, valueAnnotation],
    rows: [{ id: 2, name: 'Battery' } as Row],
  });

test('notes become annotations: records, explanations, orphaned values, bare times; nothing duplicated', () => {
  const migrated = notesToAnnotations(
    [
      note({ about, id: 1, start: '2026-05-27T14:00:00Z' }),
      note({ guide: { id: 4, kind: 'time', label: '' }, id: 2, text: 'Late by 4 min' }),
      note({
        guide: { kind: 'value', label: 'Gone', row: { id: 7, name: 'Temp' }, values: [1, 2] },
        id: 3,
        text: 'kept',
      }),
      note({ id: 5, start: '2026-05-27T14:00:00Z', text: 'Dropout' }),
    ],
    timeline(),
  );
  const [time, value, record, orphan, bare] = migrated.annotations;
  expect(migrated.annotations).toHaveLength(5);
  expect(time).toMatchObject({ description: 'Late by 4 min', id: 4 });
  expect(value).toEqual(valueAnnotation);
  expect(record).toMatchObject({
    anchor: { kind: 'record', record: { name: 'ALLOCATION', sourceId: 's' }, start: '2026-05-27T14:00:00Z' },
    description: 'Contact started late',
    legacyNoteId: 1,
  });
  expect(orphan).toMatchObject({
    anchor: { kind: 'value', rowId: null, rowName: 'Temp', y: 1, y2: 2 },
    label: 'Gone',
    legacyNoteId: 3,
  });
  expect(bare).toMatchObject({ anchor: { kind: 'time' }, label: 'Dropout', legacyNoteId: 5 });
  expect(bare.description).toBeUndefined();
  expect(new Set(migrated.annotations.map(({ id }) => id)).size).toBe(5);
});

test('no notes: the timeline itself', () => {
  const t = timeline();
  expect(notesToAnnotations([], t)).toBe(t);
});

test('record annotations are flags at the record’s start; time and value annotations are not', () => {
  const { annotations } = notesToAnnotations([note({ about, id: 1, start: '2026-05-27T14:00:00Z' })], timeline());
  expect(toTimelineNotes(annotations)).toEqual([
    { color: '#d97706', id: 10, startMs: Date.parse('2026-05-27T14:00:00Z'), text: 'ALLOCATION' },
  ]);
});

test('a layout saves the chosen annotations that can be reused, marked reusable', () => {
  const record: Annotation = { anchor: { kind: 'record', record: { ...about } }, id: 1, label: 'r' };
  const saved = getLayoutAnnotations([timeAnnotation, valueAnnotation, record], new Set([1, 9]));
  expect(saved).toEqual([{ ...valueAnnotation, reusable: true }]);
});

test('merging a layout keeps own findings (values detached), drops own reusable ones, brings the layout’s', () => {
  const own: Annotation[] = [
    { ...timeAnnotation, id: 0, label: 'mine' },
    { ...valueAnnotation, id: 1 },
    { ...timeAnnotation, id: 2, reusable: true },
  ];
  const incoming = createTimeline([], {
    annotations: [
      { ...timeAnnotation, id: 0, label: 'theirs', reusable: true },
      { ...valueAnnotation, id: 1, reusable: true },
      {
        ...valueAnnotation,
        anchor: { ...valueAnnotation.anchor, rowId: 99 } as Annotation['anchor'],
        id: 2,
        reusable: true,
      },
      { ...timeAnnotation, id: 3, label: 'not reusable' },
    ],
    rows: [{ id: 2, name: 'Battery' } as Row],
  });
  const merged = mergeAnnotationsForLayout(own, incoming, true);
  expect(merged.map(({ id, label }) => [id, label])).toEqual([
    [0, 'mine'],
    [1, 'Nominal'],
    [2, 'theirs'],
    [3, 'Nominal'],
  ]);
  expect(merged[1].anchor).toMatchObject({ rowId: null, rowName: 'Battery' });
  expect(merged[3].anchor).toMatchObject({ rowId: 2 });
  expect(mergeAnnotationsForLayout(own, incoming, false)).toHaveLength(2);
});
