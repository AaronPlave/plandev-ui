import { describe, expect, test } from 'vitest';
import type { ResourceType } from '../types/simulation';
import type { Axis, HorizontalGuide, Layer, LineLayer, Row, Timeline } from '../types/timeline';
import {
  createRow,
  createTimelineResourceLayer,
  createYAxis,
  getResourceLayerPresentation,
  rebindResourceLayer,
} from './timeline';
import { PLAN_SOURCE_ID } from './timelineSources';

const real = (name: string, unit?: string): ResourceType => ({
  name,
  schema: { type: 'real', ...(unit ? { metadata: { unit: { value: unit } } } : {}) } as ResourceType['schema'],
});
const variant = (name: string): ResourceType => ({
  name,
  schema: { type: 'variant', variants: [{ key: 'A', label: 'A' }] } as ResourceType['schema'],
});

/** A row holding one resource layer (plus optional siblings), as a view would store it. */
function setup(resourceType: ResourceType, sourceId: string, sourceLabel: string) {
  const timelines: Timeline[] = [{ id: 0, items: [], marginLeft: 0, marginRight: 0, rows: [], sections: [], verticalGuides: [] }];
  const { layer, yAxis } = createTimelineResourceLayer(timelines, resourceType, sourceId, sourceLabel);
  const row: Row = createRow(timelines, { layers: [layer as Layer], yAxes: [yAxis] });
  timelines[0].rows = [row];
  return { layer: layer as Layer, row, timelines, yAxis };
}

const axisOf = (result: { layers: Layer[]; yAxes: Axis[] }, layerId: number) =>
  result.yAxes.find(axis => axis.id === result.layers.find(layer => layer.id === layerId)?.yAxisId);

describe('resource layer rebinding', () => {
  test('same name and schema: keeps the layer, its styling and scale, and relabels the axis', () => {
    const { layer, row, timelines, yAxis } = setup(real('/battery/soc', '%'), 'external-dataset:50', 'Dataset 50');
    const styled = { ...(layer as LineLayer), lineColor: '#123456', lineWidth: 3 };
    const scaledAxis = { ...yAxis, domainFitMode: 'manual' as const, scaleDomain: [0, 100] };
    const result = rebindResourceLayer(
      timelines,
      { horizontalGuides: [], layers: [styled], yAxes: [scaledAxis] },
      styled,
      {
        previousResourceType: real('/battery/soc', '%'),
        resourceName: '/battery/soc',
        resourceType: real('/battery/soc', '%'),
        sourceId: 'external-dataset:51',
        sourceLabel: 'Dataset 51',
      },
    );
    const [rebound] = result.layers as LineLayer[];
    expect(rebound).toMatchObject({
      chartType: 'line',
      filter: { resource: '/battery/soc' },
      id: layer.id,
      lineColor: '#123456',
      lineWidth: 3,
      sourceId: 'external-dataset:51',
      yAxisId: yAxis.id,
    });
    expect(result.yAxes).toHaveLength(1);
    expect(axisOf(result, layer.id)).toMatchObject({
      domainFitMode: 'manual',
      label: { text: '/battery/soc (%) · Dataset 51' },
      scaleDomain: [0, 100],
    });
    expect(row.yAxes[0].label.text).toBe('/battery/soc (%) · Dataset 50');
  });

  test('same name, different unit: updates the unit and drops the old scale', () => {
    const { layer, timelines, yAxis } = setup(real('/power', 'W'), 'external-dataset:50', 'Dataset 50');
    const scaledAxis = { ...yAxis, domainFitMode: 'manual' as const, scaleDomain: [0, 100] };
    const result = rebindResourceLayer(
      timelines,
      { horizontalGuides: [], layers: [layer], yAxes: [scaledAxis] },
      layer,
      {
        previousResourceType: real('/power', 'W'),
        resourceName: '/power',
        resourceType: real('/power', 'kW'),
        sourceId: 'external-dataset:51',
        sourceLabel: 'Dataset 51',
      },
    );
    const axis = axisOf(result, layer.id);
    expect(axis?.label.text).toBe('/power (kW) · Dataset 51');
    expect(axis?.domainFitMode).toBe('fitTimeWindow');
    expect(axis?.scaleDomain).toBeUndefined();
    expect(result.layers[0].chartType).toBe('line');
  });

  test('same name, different schema family: converts the layer the way creation would', () => {
    const { layer, timelines, yAxis } = setup(real('/mode'), 'external-dataset:50', 'Dataset 50');
    const result = rebindResourceLayer(timelines, { horizontalGuides: [], layers: [layer], yAxes: [yAxis] }, layer, {
      previousResourceType: real('/mode'),
      resourceName: '/mode',
      resourceType: variant('/mode'),
      sourceId: 'external-dataset:51',
      sourceLabel: 'Dataset 51',
    });
    const created = createTimelineResourceLayer(timelines, variant('/mode'), 'external-dataset:51', 'Dataset 51');
    const [rebound] = result.layers;
    expect(rebound).toMatchObject({
      chartType: created.layer?.chartType,
      filter: { resource: '/mode' },
      id: layer.id,
      sourceId: 'external-dataset:51',
    });
    expect(rebound).not.toHaveProperty('lineColor');
    expect(axisOf(result, layer.id)).toMatchObject({
      label: { text: created.yAxis.label.text },
      tickCount: created.yAxis.tickCount,
    });

    // And back: a discrete x-range becomes a line again for a numeric resource.
    const back = rebindResourceLayer(timelines, result, rebound, {
      previousResourceType: variant('/mode'),
      resourceName: '/mode',
      resourceType: real('/mode'),
      sourceId: 'external-dataset:50',
      sourceLabel: 'Dataset 50',
    });
    expect(back.layers[0].chartType).toBe('line');
    expect(axisOf(back, layer.id)?.tickCount).toBe(5);
  });

  test('a shared axis is left to its other layers and the rebound layer gets its own', () => {
    const { layer, row, timelines, yAxis } = setup(real('/battery/soc', '%'), 'external-dataset:50', 'Dataset 50');
    const sibling = { ...layer, id: layer.id + 1, sourceId: PLAN_SOURCE_ID };
    const otherAxis = createYAxis(timelines, { label: { text: 'Other' } });
    const layers = [layer, sibling];
    const yAxes = [yAxis, otherAxis];
    const result = rebindResourceLayer(timelines, { horizontalGuides: [], layers, yAxes }, layer, {
      previousResourceType: real('/battery/soc', '%'),
      resourceName: '/mode',
      resourceType: variant('/mode'),
      sourceId: 'external-dataset:51',
      sourceLabel: 'Dataset 51',
    });
    expect(result.layers[1]).toBe(sibling);
    expect(result.yAxes.slice(0, 2)).toEqual(yAxes);
    expect(result.yAxes).toHaveLength(3);
    expect(axisOf(result, layer.id)?.label.text).toBe('/mode · Dataset 51');
    expect(row.layers).toHaveLength(1);
  });

  test('a resource the new source lacks clears the selection without inventing a presentation', () => {
    const { layer, timelines, yAxis } = setup(real('/battery/soc', '%'), 'external-dataset:50', 'Dataset 50');
    const result = rebindResourceLayer(timelines, { horizontalGuides: [], layers: [layer], yAxes: [yAxis] }, layer, {
      previousResourceType: real('/battery/soc', '%'),
      resourceName: '',
      resourceType: null,
      sourceId: 'external-dataset:51',
      sourceLabel: 'Dataset 51',
    });
    expect(result.layers[0]).toMatchObject({ filter: { resource: '' }, sourceId: 'external-dataset:51' });
    expect(result.yAxes).toEqual([yAxis]);
  });

  test('rebinding to the legacy lookup removes the binding, and the result survives save/reload', () => {
    const { layer, timelines, yAxis } = setup(real('/battery/soc', '%'), 'external-dataset:50', 'Dataset 50');
    const result = rebindResourceLayer(timelines, { horizontalGuides: [], layers: [layer], yAxes: [yAxis] }, layer, {
      previousResourceType: real('/battery/soc', '%'),
      resourceName: '/battery/soc',
      resourceType: real('/battery/soc', '%'),
    });
    expect(result.layers[0]).not.toHaveProperty('sourceId');
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  test('creation and rebinding share one presentation; the Plan source is not repeated on its axes', () => {
    expect(getResourceLayerPresentation(real('/battery/soc', '%'), PLAN_SOURCE_ID, 'Simulation').axisLabel).toBe(
      '/battery/soc (%)',
    );
    expect(getResourceLayerPresentation(variant('/mode'), 'external-dataset:50', 'Dataset 50')).toEqual({
      axisLabel: '/mode · Dataset 50',
      chartType: 'x-range',
      family: 'discrete',
      tickCount: 0,
      unit: undefined,
    });
  });
});

describe('horizontal guides during resource rebinding', () => {
  const guideOn = (yAxisId: number, y: number, id = 0): HorizontalGuide => ({
    id,
    label: { text: `${y}` },
    y,
    yAxisId,
  });
  const toB = (resourceType: ResourceType | null, resourceName = resourceType?.name ?? '') => ({
    resourceName,
    resourceType,
    sourceId: 'external-dataset:51',
    sourceLabel: 'Dataset 51',
  });

  test('same name, family and unit: the guide stays, unchanged, on the same axis', () => {
    const { layer, timelines, yAxis } = setup(real('/soc', '%'), 'external-dataset:50', 'Dataset 50');
    const guide = guideOn(yAxis.id, 50);
    const result = rebindResourceLayer(
      timelines,
      { horizontalGuides: [guide], layers: [layer], yAxes: [yAxis] },
      layer,
      {
        previousResourceType: real('/soc', '%'),
        ...toB(real('/soc', '%')),
      },
    );
    expect(result.horizontalGuides).toEqual([guide]);
    expect(result.layers[0].yAxisId).toBe(yAxis.id);
  });

  test('a unit change removes the guide (500 W is not 500 kW) and relabels and resets the axis', () => {
    const { layer, timelines, yAxis } = setup(real('/power', 'W'), 'external-dataset:50', 'Dataset 50');
    const scaled = { ...yAxis, domainFitMode: 'manual' as const, scaleDomain: [0, 1000] };
    const result = rebindResourceLayer(
      timelines,
      { horizontalGuides: [guideOn(yAxis.id, 500)], layers: [layer], yAxes: [scaled] },
      layer,
      { previousResourceType: real('/power', 'W'), ...toB(real('/power', 'kW')) },
    );
    expect(result.horizontalGuides).toEqual([]);
    expect(axisOf(result, layer.id)).toMatchObject({
      domainFitMode: 'fitTimeWindow',
      label: { text: '/power (kW) · Dataset 51' },
    });
    expect(axisOf(result, layer.id)?.scaleDomain).toBeUndefined();
  });

  test('another resource with the same family and unit still removes the guide', () => {
    const { layer, timelines, yAxis } = setup(real('/soc', '%'), 'external-dataset:50', 'Dataset 50');
    const result = rebindResourceLayer(
      timelines,
      { horizontalGuides: [guideOn(yAxis.id, 50)], layers: [layer], yAxes: [yAxis] },
      layer,
      { previousResourceType: real('/soc', '%'), ...toB(real('/dod', '%')) },
    );
    expect(result.horizontalGuides).toEqual([]);
  });

  test('a schema family change removes the guide and makes the layer an x-range', () => {
    const { layer, timelines, yAxis } = setup(real('/mode'), 'external-dataset:50', 'Dataset 50');
    const result = rebindResourceLayer(
      timelines,
      { horizontalGuides: [guideOn(yAxis.id, 1)], layers: [layer], yAxes: [yAxis] },
      layer,
      { previousResourceType: real('/mode'), ...toB(variant('/mode')) },
    );
    expect(result.horizontalGuides).toEqual([]);
    expect(result.layers[0].chartType).toBe('x-range');
  });

  test('on a shared axis the guide stays for the other layer and the rebound layer gets a guide-less axis', () => {
    const { layer, timelines, yAxis } = setup(real('/power', 'W'), 'external-dataset:50', 'Dataset 50');
    const sibling = { ...layer, id: layer.id + 1 };
    const guide = guideOn(yAxis.id, 500);
    const result = rebindResourceLayer(
      timelines,
      { horizontalGuides: [guide], layers: [layer, sibling], yAxes: [yAxis] },
      layer,
      { previousResourceType: real('/power', 'W'), ...toB(real('/power', 'kW')) },
    );
    expect(result.yAxes[0]).toBe(yAxis);
    expect(result.layers[1]).toBe(sibling);
    expect(result.horizontalGuides).toEqual([guide]);
    const ownAxis = axisOf(result, layer.id);
    expect(ownAxis?.id).not.toBe(yAxis.id);
    expect(result.horizontalGuides.some(g => g.yAxisId === ownAxis?.id)).toBe(false);
  });

  test('losing the resource removes the guides of its own axis, but not of a shared one', () => {
    const { layer, timelines, yAxis } = setup(real('/soc', '%'), 'external-dataset:50', 'Dataset 50');
    const guide = guideOn(yAxis.id, 50);
    const otherGuide = guideOn(yAxis.id + 100, 3, 1);
    const unshared = rebindResourceLayer(
      timelines,
      { horizontalGuides: [guide, otherGuide], layers: [layer], yAxes: [yAxis] },
      layer,
      { previousResourceType: real('/soc', '%'), ...toB(null, '') },
    );
    expect(unshared.layers[0].filter.resource).toBe('');
    expect(unshared.yAxes).toEqual([yAxis]);
    expect(unshared.horizontalGuides).toEqual([otherGuide]);

    const sibling = { ...layer, id: layer.id + 1 };
    const shared = rebindResourceLayer(
      timelines,
      { horizontalGuides: [guide], layers: [layer, sibling], yAxes: [yAxis] },
      layer,
      { previousResourceType: real('/soc', '%'), ...toB(null, '') },
    );
    expect(shared.horizontalGuides).toEqual([guide]);
  });
});
