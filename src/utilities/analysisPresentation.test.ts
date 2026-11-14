import { expect, test } from 'vitest';
import type { AnalysisSourceBinding } from '../types/analysis';
import type { Row, Timeline } from '../types/timeline';
import {
  applyPresentation,
  getInitialRoleMapping,
  getPresentationRoles,
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
    horizontalGuides: [{ id: 0, label: { text: 'Upper limit' }, y: 900, yAxisId: 0 }],
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
    horizontalGuides: [],
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
    items: [
      { id: 0, type: 'row' },
      { id: 1, type: 'row' },
    ],
    rows: [power, contacts],
    verticalGuides: [{ id: 0, label: { text: 'Power drop at 14:03' }, timestamp: '2030-100T14:03:00' }],
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

test('roles are the sources the layers read; only the very same data is preselected', () => {
  const roles = getPresentationRoles(tourA(), sourceBindings);
  expect(roles.map(({ activityLayers, resourceLayers, sourceId }) => [sourceId, resourceLayers, activityLayers])).toEqual([
    ['source-1', 2, 0],
    ['source-2', 1, 0],
    ['source-3', 0, 1],
  ]);
  // Same logical source at another revision is not preselected; the same revision is.
  expect(getInitialRoleMapping(roles, targets)).toEqual({ 'source-1': null, 'source-2': null, 'source-3': 'source-9' });
});

test('a mixed-source overlay maps each layer through its own role, and reports what does not fit', () => {
  const current = createTimeline([], { id: 5 });
  const mapping = { 'source-1': 'source-7', 'source-2': 'source-8', 'source-3': 'source-9' };
  const result = applyPresentation(tourA(), current, sourceCatalogs, targetCatalogs, labels, {
    includeTimeGuides: false,
    mapping,
    resourceRenames: {},
  });
  const [power, contacts] = result.timeline.rows;
  // Predicted Power goes to Tour B predicted; executed Power is a string there, so it is left out, not retyped.
  expect(power.layers.map(({ name, sourceId }) => [name, sourceId])).toEqual([['Predicted', 'source-7']]);
  expect(contacts.layers[0].sourceId).toBe('source-9');
  // SOC was renamed in Tour B: left out with a mappable missing resource, and its axis goes with it.
  expect(power.yAxes.map(({ id }) => id)).toEqual([0]);
  expect(power.horizontalGuides).toHaveLength(1);
  const missing = result.issues.find(issue => issue.missingResource);
  expect(missing?.missingResource).toEqual({ name: 'BatterySOC', roleId: 'source-1', type: 'real' });
  expect(result.issues.find(issue => issue.layer === 'Executed')?.reason).toMatch(/string/);
  // Units differ: kept, not converted, and said so.
  expect(result.issues.find(issue => issue.layer === 'Predicted')).toMatchObject({ effect: 'warning' });
  // Time guides are findings about Tour A's data: not carried unless asked.
  expect(result.timeline.verticalGuides).toEqual([]);
  expect(result.timeline.id).toBe(5);
  expect([result.kept, result.total]).toEqual([2, 4]);
});

test('a chosen rename is read instead, and an unmapped role leaves its layers out', () => {
  const result = applyPresentation(tourA(), createTimeline([]), sourceCatalogs, targetCatalogs, labels, {
    includeTimeGuides: true,
    mapping: { 'source-1': 'source-7', 'source-2': null, 'source-3': null },
    resourceRenames: { [getResourceRenameKey('source-1', 'BatterySOC')]: 'Battery_SOC' },
  });
  expect(result.timeline.rows).toHaveLength(1);
  expect(result.timeline.rows[0].layers.map(layer => layer.filter.resource)).toEqual(['Power', 'Battery_SOC']);
  expect(result.timeline.items).toEqual([{ id: 0, type: 'row' }]);
  expect(result.timeline.verticalGuides).toHaveLength(1);
});
