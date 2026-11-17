import { describe, expect, test } from 'vitest';
import type { AnalysisSourceBinding } from '../types/analysis';
import type { Row, Timeline } from '../types/timeline';
import {
  applyPresentation,
  getFocusedLayers,
  getFocusKey,
  getInitialRoleMapping,
  getPresentationRoles,
  getRoleMatch,
  getResourceRenameKey,
  type SourceCatalog,
} from './analysisPresentation';
import { createTimeline } from './timeline';

const catalog = (resources: Record<string, [string, string | null]>, types: string[] = []): SourceCatalog => ({
  activityTypes: new Set(types),
  resources: new Map(Object.entries(resources).map(([key, [type, unit]]) => [key, { type, unit }])),
});

/** A presentation of Tour A: one row overlaying predicted Power (source-1) and execution Power (source-2), one contacts row. */
function tourA(): Timeline {
  const power: Row = {
    autoAdjustHeight: false,
    discreteOptions: {} as Row['discreteOptions'],
    expanded: true,
    height: 120,
    id: 0,
    layers: [
      { chartType: 'line', filter: { resource: 'Power' }, id: 0, name: 'Predicted', sourceId: 'source-1', yAxisId: 0 },
      { chartType: 'line', filter: { resource: 'Power' }, id: 1, name: 'Executed', sourceId: 'source-2', yAxisId: 0 },
      { chartType: 'line', filter: { resource: 'BatterySOC' }, id: 2, name: 'SOC', sourceId: 'source-1', yAxisId: 1 },
    ],
    name: 'Power',
    yAxes: [
      { color: '', id: 0, label: { text: 'W' }, scaleDomain: [0, 1000], tickCount: 4 },
      { color: '', id: 1, label: { text: '%' }, scaleDomain: [0, 100], tickCount: 4 },
    ] as Row['yAxes'],
  };
  const contacts: Row = {
    ...power,
    id: 1,
    layers: [
      {
        chartType: 'activity',
        filter: { activity: { static_types: ['ALLOCATION'] } },
        id: 3,
        name: 'Contacts',
        sourceId: 'source-3',
        yAxisId: null,
      },
    ],
    name: 'Contacts',
    yAxes: [],
  };
  return createTimeline([], {
    annotations: [
      { anchor: { kind: 'time', start: '2030-100T14:03:00' }, id: 0, label: 'Power drop at 14:03' },
      { anchor: { kind: 'value', rowId: 0, y: 900, yAxisId: 0 }, id: 1, label: 'Upper limit', reusable: true },
    ],
    items: [
      { id: 0, type: 'row' },
      { id: 1, type: 'row' },
    ],
    rows: [power, contacts],
  });
}

const sourceBindings: AnalysisSourceBinding[] = [
  { id: 'source-1', kind: 'imported', revisionId: 1, sourceId: 10 },
  { id: 'source-2', kind: 'imported', revisionId: 2, sourceId: 20 },
  { id: 'source-3', kind: 'imported', revisionId: 3, sourceId: 30 },
];
const sourceCatalogs = {
  'source-1': catalog({ BatterySOC: ['real', '%'], Power: ['real', 'W'] }),
  'source-2': catalog({ Power: ['real', 'W'] }),
  'source-3': catalog({}, ['ALLOCATION']),
};

// Tour B: its own predicted (rev 11), execution (rev 12) and schedule (still rev 3, the same data), bound as different ids.
const targets: AnalysisSourceBinding[] = [
  { id: 'source-7', kind: 'imported', revisionId: 11, sourceId: 10 },
  { id: 'source-8', kind: 'imported', revisionId: 12, sourceId: 20 },
  { id: 'source-9', kind: 'imported', revisionId: 3, sourceId: 30 },
];
const targetCatalogs = {
  'source-7': catalog({ Battery_SOC: ['real', '%'], Power: ['real', 'kW'] }),
  'source-8': catalog({ Power: ['string', null] }),
  'source-9': catalog({}, ['ALLOCATION']),
};
const labels = { 'source-7': 'Tour B predicted', 'source-8': 'Tour B executed', 'source-9': 'DSN schedule' };

test('roles are the sources the layers read; the same data is mapped, another revision of it suggested', () => {
  const roles = getPresentationRoles(tourA(), sourceBindings);
  expect(
    roles.map(({ activityLayers, resourceLayers, sourceId }) => [sourceId, resourceLayers, activityLayers]),
  ).toEqual([
    ['source-1', 2, 0],
    ['source-2', 1, 0],
    ['source-3', 0, 1],
  ]);
  expect(getInitialRoleMapping(roles, targets)).toEqual({
    'source-1': 'source-7',
    'source-2': 'source-8',
    'source-3': 'source-9',
  });
  // Said to be what it is: the same data, or another revision of the same source.
  expect(targets.map(target => getRoleMatch(roles[0], target))).toEqual(['revision', 'other', 'other']);
  expect(getRoleMatch(roles[2], targets[2])).toBe('same');
  // Two revisions of the same source in the target: ambiguous, so nothing is suggested.
  const two = [
    ...targets,
    { id: 'source-10', kind: 'imported', revisionId: 13, sourceId: 10 } as AnalysisSourceBinding,
  ];
  expect(getInitialRoleMapping(roles, two)['source-1']).toBeNull();
});

test('a mixed-source overlay maps each layer through its own role, and reports what does not fit', () => {
  const current = createTimeline([], { id: 5 });
  const mapping = { 'source-1': 'source-7', 'source-2': 'source-8', 'source-3': 'source-9' };
  const result = applyPresentation(tourA(), current, sourceCatalogs, targetCatalogs, labels, {
    mapping,
    resourceRenames: {},
  });
  const [power, contacts] = result.timeline.rows;
  // Predicted Power goes to Tour B predicted; executed Power is a string there, so it is left out, not retyped.
  expect(power.layers.map(({ name, sourceId }) => [name, sourceId])).toEqual([['Predicted', 'source-7']]);
  expect(contacts.layers[0].sourceId).toBe('source-9');
  // SOC was renamed in Tour B: left out with a mappable missing resource, and its axis goes with it.
  expect(power.yAxes.map(({ id }) => id)).toEqual([0]);
  const missing = result.issues.find(issue => issue.layer === 'SOC');
  expect(missing?.missingResource).toEqual({ name: 'BatterySOC', roleId: 'source-1', type: 'real' });
  // Another type is left out, and can be replaced by a resource of the type it drew.
  expect(result.issues.find(issue => issue.layer === 'Executed')).toMatchObject({
    effect: 'omitted',
    missingResource: { name: 'Power', roleId: 'source-2', type: 'real' },
  });
  // W in Tour A, kW in Tour B: kept, not converted. The axis is refreshed (its W range and label would mislabel kW)
  // and the 900 W limit is dropped rather than read as 900 kW.
  expect(result.issues.find(issue => issue.layer === 'Predicted')).toMatchObject({ effect: 'warning' });
  expect(result.timeline.annotations.some(({ anchor }) => anchor.kind === 'value')).toBe(false);
  expect(power.yAxes[0].scaleDomain).toBeUndefined();
  expect(power.yAxes[0].label.text).toBe('Power (kW) · Tour B predicted');
  // Which annotations come is decided when it replaces the target's timeline (mergeAnnotationsForLayout).
  expect(result.timeline.annotations.map(({ label }) => label)).toEqual(['Power drop at 14:03']);
  expect(result.timeline.id).toBe(5);
  expect([result.kept, result.total]).toEqual([2, 4]);
});

test('a chosen rename is read instead, and an unmapped role leaves its layers out', () => {
  const result = applyPresentation(tourA(), createTimeline([]), sourceCatalogs, targetCatalogs, labels, {
    mapping: { 'source-1': 'source-7', 'source-2': null, 'source-3': null },
    resourceRenames: { [getResourceRenameKey('source-1', 'BatterySOC')]: 'Battery_SOC' },
  });
  expect(result.timeline.rows).toHaveLength(1);
  expect(result.timeline.rows[0].layers.map(layer => layer.filter.resource)).toEqual(['Power', 'Battery_SOC']);
  expect(result.timeline.items).toEqual([{ id: 0, type: 'row' }]);
});

test('an activity layer none of whose types the target has is left out, not kept empty', () => {
  const result = applyPresentation(
    tourA(),
    createTimeline([]),
    sourceCatalogs,
    { ...targetCatalogs, 'source-9': catalog({}, ['STATION_VIEW']) },
    labels,
    { mapping: { 'source-3': 'source-9' }, resourceRenames: {} },
  );
  expect(result.timeline.rows.find(row => row.name === 'Contacts')).toBeUndefined();
  expect(result.issues.find(issue => issue.layer === 'Contacts')).toMatchObject({
    effect: 'omitted',
    reason: 'DSN schedule has no ALLOCATION',
  });
});

test('a source whose catalog could not be read is not checked, and says so rather than claiming it fits', () => {
  const unknown = { activityTypes: null, resources: null };
  const result = applyPresentation(
    tourA(),
    createTimeline([]),
    sourceCatalogs,
    { 'source-7': unknown, 'source-9': unknown },
    labels,
    { mapping: { 'source-1': 'source-7', 'source-3': 'source-9' }, resourceRenames: {} },
  );
  expect(result.issues.filter(issue => issue.effect === 'unverified').map(({ layer }) => layer)).toEqual([
    'Predicted',
    'SOC',
    'Contacts',
  ]);
  expect(result.kept).toBe(3);
});

test('a focused layer is kept only when the target has its records; else the person remaps or clears it', () => {
  const focused = tourA();
  focused.rows[1].layers[0].filter.activity = { static_types: ['ALLOCATION'], within: ['SEQ_A'] };
  focused.rows[1].layers[0].name = 'SEQ_A';
  const current = createTimeline([], { id: 5 });
  const mapping = { 'source-1': 'source-7', 'source-2': 'source-8', 'source-3': 'source-9' };
  const key = getFocusKey('source-9', ['SEQ_A']);
  const apply = (options: Partial<Parameters<typeof applyPresentation>[5]>) =>
    applyPresentation(focused, current, sourceCatalogs, targetCatalogs, labels, {
      mapping,
      resourceRenames: {},
      ...options,
    });
  const contacts = (timeline: Timeline) => timeline.rows.find(row => row.name === 'Contacts');

  expect(getFocusedLayers(focused)).toEqual([{ name: 'SEQ_A', roleId: 'source-3', within: ['SEQ_A'] }]);
  // Not checked yet: kept, and said to be unchecked.
  expect(apply({}).issues.some(issue => issue.effect === 'unverified' && issue.row === 'Contacts')).toBe(true);
  // The target has it: kept as it is.
  expect(contacts(apply({ focusChecks: { [key]: true } }).timeline)?.layers[0].filter.activity?.within).toEqual([
    'SEQ_A',
  ]);
  // It doesn't: left out, never shown empty, and the person is asked.
  const missing = apply({ focusChecks: { [key]: false } });
  expect(contacts(missing.timeline)).toBeUndefined();
  expect(missing.issues.find(issue => issue.missingFocus)?.missingFocus).toEqual({
    key,
    name: 'SEQ_A',
    targetId: 'source-9',
    within: ['SEQ_A'],
  });
  // Cleared: every record of its types. Remapped: the chosen record.
  const cleared = apply({ focusChecks: { [key]: false }, focusChoices: { [key]: '' } });
  expect(contacts(cleared.timeline)?.layers[0].filter.activity).toEqual({ static_types: ['ALLOCATION'] });
  const remapped = apply({ focusChecks: { [key]: false }, focusChoices: { [key]: 'SEQ_B' } });
  expect(contacts(remapped.timeline)?.layers[0].filter.activity?.within).toEqual(['SEQ_B']);
});

describe('describeViewContents', () => {
  test('says rows, the kinds of data drawn and the sources saved with', async () => {
    const { describeViewContents } = await import('./analysisPresentation');
    const rows = [
      { layers: [{ chartType: 'activity' }, { chartType: 'line' }] },
      { layers: [{ chartType: 'externalEvent' }] },
    ] as never;
    expect(describeViewContents(rows, { a: { name: 'cruise015' }, b: { name: 'TOL' }, c: {} })).toBe(
      '2 rows · activities, resources, external events · from cruise015, TOL +1',
    );
    expect(describeViewContents(null, null)).toBe('0 rows');
    expect(describeViewContents([{ layers: [] }] as never, null)).toBe('1 row');
  });
});
