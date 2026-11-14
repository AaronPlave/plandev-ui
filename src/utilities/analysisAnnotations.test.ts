import { expect, test } from 'vitest';
import type { AnalysisAnnotation } from '../types/analysis';
import { createTimeline } from './timeline';
import { syncGuideNotes, toTimelineNotes } from './analysisAnnotations';

const note = (extra: Partial<AnalysisAnnotation>): AnalysisAnnotation => ({
  createdAt: '2026-11-14T00:00:00Z',
  id: 1,
  text: 'Contact started late',
  ...extra,
});

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

test('a note on a time guide follows the guide, and keeps what it saw once the guide is gone', () => {
  const notes = [note({ guide: { id: 4, kind: 'time', label: '' } })];
  const [synced] = syncGuideNotes(notes, timeline());
  expect(synced).toMatchObject({
    end: '2026-05-27T18:10:00.000Z',
    guide: { id: 4, label: 'Planned contact' },
    start: '2026-05-27T14:10:00.000Z',
  });
  // Unchanged: the same array, so nothing is saved for nothing.
  expect(syncGuideNotes([synced], timeline())[0]).toBe(synced);
  const gone = syncGuideNotes([synced], createTimeline([]))[0];
  expect(gone.guide).toEqual({ id: undefined, kind: 'time', label: 'Planned contact' });
  expect(gone.start).toBe('2026-05-27T14:10:00.000Z');
});

test('a note on a value guide takes its values; replaced rows break the link even when ids match', () => {
  const notes = [note({ guide: { id: 9, kind: 'value', label: '', row: { id: 2, name: '' } } })];
  const [synced] = syncGuideNotes(notes, timeline());
  expect(synced.guide).toEqual({
    id: 9,
    kind: 'value',
    label: 'Nominal',
    row: { id: 2, name: 'Battery' },
    values: [28, 32],
  });
  expect(syncGuideNotes([synced], timeline(), true)[0].guide?.id).toBeUndefined();
});

test('the lane draws a flag, never a band over a record or a guide; only a marked interval is a bar', () => {
  const lane = toTimelineNotes([
    note({
      about: { data: 'revision:217', kind: 'activity', name: 'ALLOCATION', sourceId: 's', sourceLabel: 'PEF' },
      end: '2026-06-20T00:00:00Z',
      id: 1,
      start: '2026-05-27T14:00:00Z',
    }),
    note({
      end: '2026-05-27T18:00:00Z',
      guide: { id: 4, kind: 'time', label: 'x' },
      id: 2,
      start: '2026-05-27T14:00:00Z',
    }),
    note({ end: '2026-05-27T18:00:00Z', id: 3, start: '2026-05-27T14:00:00Z' }),
    note({ guide: { id: 9, kind: 'value', label: 'Nominal' }, id: 4 }),
  ]);
  expect(lane.map(({ endMs, id }) => [id, endMs !== undefined])).toEqual([
    [1, false],
    [2, false],
    [3, true],
  ]);
});
