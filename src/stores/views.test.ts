import { describe, expect, test, vi } from 'vitest';
import type { ExternalEvent } from '../types/external-event';
import type { ExternalEventLayer, Timeline } from '../types/timeline';
import {
  applyExternalEventLayerFilter,
  createTimelineExternalEventLayer,
  externalEventSourceScopesEqual,
} from '../utilities/timeline';
import { getDefaultRowName, getUpdatedLayerWithFilters } from './views';

vi.mock('$env/dynamic/public', () => ({ env: {} }));
vi.mock('$app/environment', () => ({ browser: true }));

const externalEvent = (derivation_group_name: string, source_key: string, event_type_name: string, key: string) =>
  ({ pkey: { derivation_group_name, event_type_name, key, source_key } }) as ExternalEvent;

describe('external event source scope', () => {
  // The same type from two sources of one group and from another group.
  const events = [
    externalEvent('DG A', 'source-1', 'Pass', '1'),
    externalEvent('DG A', 'source-1', 'Pass', '2'),
    externalEvent('DG A', 'source-1', 'Handover', '3'),
    externalEvent('DG A', 'source-2', 'Pass', '4'),
    externalEvent('DG B', 'source-3', 'Pass', '5'),
    // Same source key in another group: scope is per group, never by key alone.
    externalEvent('DG B', 'source-1', 'Pass', '6'),
  ];
  const keys = (filter: ExternalEventLayer['filter']['externalEvent']) =>
    applyExternalEventLayerFilter(filter, events).externalEvents.map(event => event.pkey.key);
  const scope = [{ derivation_group_name: 'DG A', source_key: 'source-1' }];
  const timelines = [{ id: 0, items: [], marginLeft: 0, marginRight: 0, rows: [], sections: [], verticalGuides: [] }] as Timeline[];
  const pass = { attribute_schema: {}, name: 'Pass' };

  test('a browser leaf becomes a layer that shows only its group, source and type', () => {
    const { layer } = getUpdatedLayerWithFilters(timelines, 'externalEvent', [pass], {
      externalSources: scope,
      sourceId: null,
    });
    expect(layer.filter.externalEvent).toEqual({ external_sources: scope, static_types: ['Pass'] });
    expect(keys(layer.filter.externalEvent)).toEqual(['1', '2']);
  });

  test('legacy type-only filters keep matching the type across every source and group', () => {
    expect(keys({ static_types: ['Pass'] })).toEqual(['1', '2', '4', '5', '6']);
    expect(keys({})).toEqual([]);
    expect(keys({ external_sources: [], static_types: ['Pass'] })).toEqual(['1', '2', '4', '5', '6']);
  });

  test('the scope narrows every other criterion, and on its own selects its whole source', () => {
    expect(
      keys({
        dynamic_type_filters: [{ field: 'Type', id: 0, operator: 'includes', value: 'a' }],
        external_sources: scope,
      }),
    ).toEqual(['1', '2', '3']);
    expect(keys({ external_sources: scope })).toEqual(['1', '2', '3']);
    expect(
      keys({
        external_sources: [...scope, { derivation_group_name: 'DG B', source_key: 'source-3' }],
        static_types: ['Pass'],
      }),
    ).toEqual(['1', '2', '5']);
  });

  test('adding more types to a scoped layer keeps its scope and its other criteria', () => {
    const existing = createTimelineExternalEventLayer(timelines, {
      filter: {
        externalEvent: {
          external_sources: scope,
          other_filters: [{ field: 'Name', id: 0, operator: 'includes', value: '' }],
          static_types: ['Pass'],
        },
      },
    });
    const { layer } = getUpdatedLayerWithFilters(
      timelines,
      'externalEvent',
      [{ attribute_schema: {}, name: 'Handover' }],
      { externalSources: scope, sourceId: null },
      existing,
    );
    expect(layer.filter.externalEvent).toEqual({
      external_sources: scope,
      other_filters: [{ field: 'Name', id: 0, operator: 'includes', value: '' }],
      static_types: ['Pass', 'Handover'],
    });
  });

  test('a scoped layer survives a save/reload round trip', () => {
    const { layer } = getUpdatedLayerWithFilters(timelines, 'externalEvent', [pass], {
      externalSources: scope,
      sourceId: null,
    });
    const reloaded = JSON.parse(JSON.stringify(layer)) as ExternalEventLayer;
    expect(keys(reloaded.filter.externalEvent)).toEqual(['1', '2']);
  });

  test('items only merge into a layer that shows exactly the same external sources', () => {
    const other = { derivation_group_name: 'DG A', source_key: 'source-2' };
    expect(externalEventSourceScopesEqual(undefined, [])).toBe(true);
    expect(externalEventSourceScopesEqual(scope, [...scope])).toBe(true);
    expect(externalEventSourceScopesEqual([other, ...scope], [...scope, other])).toBe(true);
    expect(externalEventSourceScopesEqual(undefined, scope)).toBe(false);
    expect(externalEventSourceScopesEqual(scope, [other])).toBe(false);
    expect(externalEventSourceScopesEqual(scope, [{ derivation_group_name: 'DG B', source_key: 'source-1' }])).toBe(
      false,
    );
  });
});

describe('new resource layers are source-bound', () => {
  const timelines = [{ id: 0, items: [], marginLeft: 0, marginRight: 0, rows: [], sections: [], verticalGuides: [] }] as Timeline[];
  const soc = { name: '/battery/soc', schema: { type: 'real' as const } };

  test('a Plan catalog (Model Resources) item binds to the Plan simulation', () => {
    const { layer } = getUpdatedLayerWithFilters(timelines, 'resource', [soc], {});
    expect(layer).toMatchObject({ chartType: 'line', filter: { resource: '/battery/soc' }, sourceId: 'plan' });
    expect(JSON.parse(JSON.stringify(layer)).sourceId).toBe('plan');
  });

  test('a Sources item keeps the source it came from', () => {
    const { layer, yAxis } = getUpdatedLayerWithFilters(timelines, 'resource', [soc], {
      sourceId: 'external-dataset:50',
      sourceLabel: 'Dataset 50',
    });
    expect(layer.sourceId).toBe('external-dataset:50');
    expect(yAxis?.label.text).toBe('/battery/soc · Dataset 50');
  });
});

describe('default names of new external event rows', () => {
  const pass = { attribute_schema: {}, name: 'Pass' };
  const scoped = (derivation_group_name: string, source_key: string) => ({
    externalSources: [{ derivation_group_name, source_key }],
    sourceId: null,
  });

  test('the same source key in two derivation groups gives two distinct names', () => {
    expect(getDefaultRowName([pass], 'externalEvent', scoped('DG A', 'source-1'))).toBe('Pass · DG A / source-1');
    expect(getDefaultRowName([pass], 'externalEvent', scoped('DG B', 'source-1'))).toBe('Pass · DG B / source-1');
  });

  test('several sources are counted, and type-only items keep the legacy default', () => {
    expect(
      getDefaultRowName([pass], 'externalEvent', {
        externalSources: [...scoped('DG A', 'source-1').externalSources, ...scoped('DG B', 'source-1').externalSources],
      }),
    ).toBe('Pass · 2 sources');
    expect(getDefaultRowName([pass], 'externalEvent', {})).toBe('Pass');
    expect(getDefaultRowName([pass, { attribute_schema: {}, name: 'Eclipse' }], 'externalEvent')).toBe(
      'Externalevent Row',
    );
  });
});
