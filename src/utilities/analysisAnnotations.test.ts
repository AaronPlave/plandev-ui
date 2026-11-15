import { expect, test } from 'vitest';
import type { AnalysisAnnotation } from '../types/analysis';
import { createTimeline } from './timeline';
import {
  getDisplacedValueAnnotations,
  keepAnnotations,
  listAnnotations,
  migrateLegacyNotes,
  toTimelineNotes,
  withoutDescriptions,
} from './analysisAnnotations';

const note = (extra: Partial<AnalysisAnnotation>): AnalysisAnnotation => ({
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

function timeline() {
  const t = createTimeline([], {
    verticalGuides: [
      {
        id: 4,
        label: { text: 'Planned contact' },
        timestamp: '2026-147T14:10:00.000',
        timestamp2: '2026-147T18:10:00.000',
      },
    ],
  });
  t.rows = [
    {
      horizontalGuides: [{ id: 9, label: { text: 'Nominal' }, y: 28, y2: 32, yAxisId: 0 }],
      id: 2,
      name: 'Battery',
    } as unknown as (typeof t.rows)[number],
  ];
  return t;
}

test('a note explaining a guide becomes the guide’s explanation: one annotation, not two', () => {
  const { notes, timeline: migrated } = migrateLegacyNotes(
    [
      note({ guide: { id: 4, kind: 'time', label: '' }, id: 1, text: 'Late by 4 min' }),
      note({ guide: { id: 9, kind: 'value', label: '', row: { id: 2, name: '' } }, id: 2, text: 'Spec range' }),
      note({ about, id: 3, start: '2026-05-27T14:00:00Z' }),
    ],
    timeline(),
  );
  expect(notes.map(({ id }) => id)).toEqual([3]);
  expect(migrated.verticalGuides).toHaveLength(1);
  expect(migrated.verticalGuides[0].description).toBe('Late by 4 min');
  expect(migrated.rows[0].horizontalGuides[0].description).toBe('Spec range');
  // Loading again changes nothing (no duplicates).
  const again = migrateLegacyNotes(notes, migrated);
  expect(again.timeline).toBe(migrated);
  expect(again.notes).toBe(notes);
});

test('a note on a time, an interval, or a time guide that is gone becomes a time annotation with its words', () => {
  const { notes, timeline: migrated } = migrateLegacyNotes(
    [
      note({ id: 1, start: '2026-05-27T14:00:00Z', text: 'Dropout' }),
      note({ end: '2026-05-27T18:00:00Z', id: 2, start: '2026-05-27T14:00:00Z', text: 'Pass\nHandover was slow' }),
      note({
        guide: { id: undefined, kind: 'time', label: 'Old mark' },
        id: 3,
        start: '2026-05-27T15:00:00Z',
        text: 'Why',
      }),
      note({ guide: { id: undefined, kind: 'value', label: 'Gone', values: [1] }, id: 4, text: 'kept' }),
    ],
    timeline(),
  );
  expect(notes.map(({ id }) => id)).toEqual([4]);
  const added = migrated.verticalGuides.slice(1);
  expect(added.map(guide => [guide.label.text, guide.description, !!guide.timestamp2])).toEqual([
    ['Dropout', undefined, false],
    ['Pass', 'Pass\nHandover was slow', true],
    ['Old mark', 'Why', false],
  ]);
  expect(new Set(migrated.verticalGuides.map(({ id }) => id)).size).toBe(4);
});

test('one list of every annotation, in time order', () => {
  const items = listAnnotations(timeline(), [note({ about, id: 7, start: '2026-05-27T15:00:00Z' })]);
  expect(items.map(({ key, kind }) => [key, kind])).toEqual([
    ['time:4', 'time'],
    ['note:7', 'record'],
    ['value:2:9', 'value'],
  ]);
});

test('record annotations are flags at the record’s start, never a band over it', () => {
  const lane = toTimelineNotes([
    note({ about, end: '2026-06-20T00:00:00Z', id: 1, start: '2026-05-27T14:00:00Z' }),
    note({ guide: { kind: 'value', label: 'Nominal' }, id: 4 }),
  ]);
  expect(lane).toEqual([
    { color: '#d97706', id: 1, startMs: Date.parse('2026-05-27T14:00:00Z'), text: 'Contact started late' },
  ]);
});

test('a layout keeps only the chosen marks; another analysis’s marks come without what they say', () => {
  const described = timeline();
  described.verticalGuides[0].description = 'finding';
  described.rows[0].horizontalGuides[0].description = 'spec';
  const kept = keepAnnotations(described, new Set(['value:2:9']));
  expect(kept.verticalGuides).toEqual([]);
  expect(kept.rows[0].horizontalGuides).toHaveLength(1);
  const bare = withoutDescriptions(described);
  expect(bare.verticalGuides[0].description).toBeUndefined();
  expect(bare.rows[0].horizontalGuides[0].description).toBeUndefined();
  expect(described.verticalGuides[0].description).toBe('finding');
});

test('explained value marks on replaced rows are kept as unanchored annotations', () => {
  const previous = timeline();
  expect(getDisplacedValueAnnotations(previous, 5)).toEqual([]);
  previous.rows[0].horizontalGuides[0].description = 'Spec range';
  const [kept] = getDisplacedValueAnnotations(previous, 5, 'me');
  expect(kept).toMatchObject({
    createdBy: 'me',
    guide: { kind: 'value', label: 'Nominal', row: { id: 2, name: 'Battery' }, values: [28, 32] },
    id: 5,
    text: 'Spec range',
  });
});
