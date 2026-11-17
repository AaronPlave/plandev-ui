import { expect, test } from 'vitest';
import type { Annotation, Row } from '../types/timeline';
import type { ViewDefinition } from '../types/view';
import { getHorizontalGuides, getVerticalGuides, setHorizontalGuides, setVerticalGuides } from './annotations';
import { migrateViewDefinitionV4toV5 } from './view';

test('v4 → v5: guides become annotations, time ids kept, value ones numbered after, guide fields removed', () => {
  const v4 = {
    plan: {
      timelines: [
        {
          id: 0,
          rows: [
            {
              horizontalGuides: [
                { description: 'spec', id: 0, label: { color: '#f00', text: 'Max' }, y: 5, yAxisId: 1 },
              ],
              id: 3,
              name: 'Battery',
            },
          ],
          verticalGuides: [
            { id: 7, label: { text: 'Launch' }, timestamp: '2026-001T00:00:00' },
            { description: 'why', id: 2, label: { color: '#0f0', text: 'Pass' }, timestamp: 'a', timestamp2: 'b' },
          ],
        },
      ],
    },
    version: 4,
  } as unknown as ViewDefinition;
  const { plan, version } = migrateViewDefinitionV4toV5(v4);
  const [timeline] = plan.timelines;
  expect(version).toBe(5);
  expect(timeline).not.toHaveProperty('verticalGuides');
  expect(timeline.rows[0]).not.toHaveProperty('horizontalGuides');
  expect(timeline.annotations).toEqual([
    { anchor: { kind: 'time', start: '2026-001T00:00:00' }, id: 7, label: 'Launch' },
    { anchor: { end: 'b', kind: 'time', start: 'a' }, color: '#0f0', description: 'why', id: 2, label: 'Pass' },
    {
      anchor: { kind: 'value', rowId: 3, rowName: 'Battery', y: 5, yAxisId: 1 },
      color: '#f00',
      description: 'spec',
      id: 8,
      label: 'Max',
    },
  ]);
});

test('guides made from annotations and set back keep what guides do not carry', () => {
  const row = { id: 3, name: 'Battery' } as Row;
  const annotations: Annotation[] = [
    { anchor: { kind: 'time', start: 'a' }, createdBy: 'me', id: 0, label: 'T', reusable: true },
    { anchor: { kind: 'value', rowId: 3, units: 'V', y: 1, yAxisId: 0 }, id: 1, label: 'V' },
    { anchor: { kind: 'general' }, id: 2, label: 'G' },
  ];
  const vertical = getVerticalGuides({ annotations });
  const horizontal = getHorizontalGuides({ annotations }, 3);
  expect(setHorizontalGuides(setVerticalGuides(annotations, vertical), row, horizontal)).toEqual([
    annotations[0],
    { ...annotations[1], anchor: { ...annotations[1].anchor, rowName: 'Battery' } },
    annotations[2],
  ]);

  // Moved, removed, added.
  const edited = setVerticalGuides(annotations, [
    { ...vertical[0], timestamp: 'b' },
    { id: 5, label: { text: 'N' }, timestamp: 'c' },
  ]);
  expect(edited.map(({ id }) => id)).toEqual([0, 1, 2, 5]);
  expect(edited[0]).toMatchObject({ anchor: { start: 'b' }, createdBy: 'me', reusable: true });
  expect(setHorizontalGuides(annotations, row, []).map(({ id }) => id)).toEqual([0, 2]);
});

test('v4 → v5 keeps value ranges and label styles; a v5 view is left as it is', async () => {
  const { applyViewDefinitionMigrations } = await import('./view');
  const v4 = {
    plan: {
      timelines: [
        {
          id: 0,
          rows: [
            {
              horizontalGuides: [{ id: 0, label: { position: 'right', text: 'Band' }, y: 1, y2: 3, yAxisId: 2 }],
              id: 1,
              name: 'Rate',
            },
          ],
          verticalGuides: [],
        },
      ],
    },
    version: 4,
  } as unknown as ViewDefinition;
  const { migratedViewDefinition, anyMigrationsApplied } = applyViewDefinitionMigrations(v4);
  expect(anyMigrationsApplied).toBe(true);
  expect(migratedViewDefinition?.plan.timelines[0].annotations).toEqual([
    {
      anchor: { kind: 'value', rowId: 1, rowName: 'Rate', y: 1, y2: 3, yAxisId: 2 },
      id: 0,
      label: 'Band',
      labelStyle: { position: 'right' },
    },
  ]);
  // Migrating again (a v5 view) adds nothing: no duplicated annotations.
  const again = applyViewDefinitionMigrations(migratedViewDefinition as ViewDefinition);
  expect(again.anyMigrationsApplied).toBe(false);
  expect(again.migratedViewDefinition?.plan.timelines[0].annotations).toHaveLength(1);
});
