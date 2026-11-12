import { describe, expect, it } from 'vitest';
import type { AnalysisSourceBinding } from '../types/analysis';
import type { Layer, Row, Timeline } from '../types/timeline';
import {
  countUnboundLayers,
  getImportedPlanSourceIds,
  getUnboundLayerOptions,
  importViewTimeline,
  type ViewImportChoices,
} from './analysisViewImport';
import {
  createRow,
  createTimeline,
  createTimelineActivityLayer,
  createTimelineLineLayer,
  createYAxis,
} from './timeline';

const plan: AnalysisSourceBinding = { id: 'source-1', kind: 'plan', planId: 1 };
const simulation: AnalysisSourceBinding = { id: 'source-2', kind: 'simulation', simulationDatasetId: 3 };
const imported = (id: string, revisionId: number, sourceId = 40): AnalysisSourceBinding => ({
  id,
  kind: 'imported',
  revisionId,
  sourceId,
  sourceName: 'Tour',
});
const planSource = { id: 7, revisionId: 26, sourceId: 40, sourceName: 'Tour' };
const choose = (activitySourceId: string | null, resourceSourceId: string | null): ViewImportChoices => ({
  activitySourceId,
  resourceSourceId,
});

/**
 * A Plan view's timeline: sections and a root row, rendering options set away from the defaults, a resource row with
 * its own axis and guide, and layers that name the Plan, a plan source, and a source an Analysis can't have.
 */
function planViewTimeline(): Timeline {
  const timeline = createTimeline([], { id: 5, marginLeft: 321, marginRight: 12 });
  const timelines = [timeline];
  const axis = createYAxis(timelines, { label: { text: 'Charge' }, tickCount: 9 });
  const power = createRow(timelines, {
    height: 222,
    horizontalGuides: [{ id: 1, label: { text: 'Floor' }, y: 10, yAxisId: axis.id }],
    id: 2,
    layers: [createTimelineLineLayer(timelines, [axis], { id: 21, name: 'SOC', sourceId: 'plan' })],
    name: 'Power',
    yAxes: [axis],
  });
  const activities = createRow(timelines, {
    autoAdjustHeight: true,
    id: 1,
    layers: [createTimelineActivityLayer(timelines, { id: 11, name: 'Activities' })],
    name: 'Activities',
  });
  const mixed = createRow(timelines, {
    id: 3,
    layers: [
      { ...createTimelineActivityLayer(timelines, { id: 31, name: 'Tour passes' }), sourceId: 'imported:7' },
      { ...createTimelineActivityLayer(timelines, { id: 32, name: 'Events' }), chartType: 'externalEvent' } as Layer,
    ],
    name: 'Mixed',
  });
  const onlyEvents = createRow(timelines, {
    id: 4,
    layers: [{ ...createTimelineActivityLayer(timelines, { id: 41, name: 'DSN' }), sourceId: 'external-events' }],
    name: 'External only',
  });
  timeline.rows = [activities, power, mixed, onlyEvents];
  timeline.sections = [{ collapsed: true, color: '#abcdef', id: 9, name: 'Systems', rowIds: [2, 3] }];
  timeline.items = [
    { id: 1, type: 'row' },
    { id: 9, type: 'section' },
    { id: 4, type: 'row' },
  ];
  timeline.verticalGuides = [{ id: 1, label: { text: 'Launch' }, timestamp: '2030-001T00:00:00' }];
  return timeline;
}

describe('importing a Plan view timeline into an Analysis', () => {
  const bindings = [plan, simulation, imported('source-3', 26)];

  it('keeps the timeline whole, with its sections, rows, axes, guides and presentation settings', () => {
    const source = planViewTimeline();
    const { omitted, timeline } = importViewTimeline(source, 0, bindings, [planSource], choose('source-1', 'source-2'));

    expect(timeline.id).toBe(0); // the Analysis's own timeline id
    expect(timeline.marginLeft).toBe(321);
    expect(timeline.marginRight).toBe(12);
    expect(timeline.verticalGuides).toEqual(source.verticalGuides);
    expect(timeline.sections).toEqual(source.sections);
    // The row with only events is gone, from its place in the hierarchy as well.
    expect(timeline.rows.map(row => row.id)).toEqual([1, 2, 3]);
    expect(timeline.items).toEqual([
      { id: 1, type: 'row' },
      { id: 9, type: 'section' },
    ]);
    const power = timeline.rows.find(row => row.id === 2) as Row;
    expect(power.height).toBe(222);
    expect(power.yAxes).toEqual(source.rows[1].yAxes);
    expect(power.horizontalGuides).toEqual(source.rows[1].horizontalGuides);
    expect(timeline.rows[0].autoAdjustHeight).toBe(true);
    expect(omitted.map(({ layer }) => layer)).toEqual(['Events', 'DSN']);
    // The view that was read is not altered.
    expect(source.rows[1].layers[0].sourceId).toBe('plan');
    expect(source.id).toBe(5);
  });

  it("points the Plan's activity layers at the chosen plan, its resource layers at the simulation, and the imported layer at the bound revision", () => {
    const { kept, timeline } = importViewTimeline(
      planViewTimeline(),
      0,
      bindings,
      [planSource],
      choose('source-1', 'source-2'),
    );
    const sourceOf = (rowId: number, layerId: number) =>
      timeline.rows.find(row => row.id === rowId)?.layers.find(layer => layer.id === layerId)?.sourceId;
    expect(sourceOf(1, 11)).toBe('source-1'); // unbound activity layer: the plan
    expect(sourceOf(2, 21)).toBe('source-2'); // 'plan' resource layer: the simulation
    expect(sourceOf(3, 31)).toBe('source-3'); // imported:7 -> revision 26 -> this Analysis's binding
    expect(kept).toBe(3);
  });

  it('can read the Plan activity layers from a simulation instead', () => {
    const { timeline } = importViewTimeline(
      planViewTimeline(),
      0,
      bindings,
      [planSource],
      choose('source-2', 'source-2'),
    );
    expect(timeline.rows[0].layers[0].sourceId).toBe('source-2');
  });

  it('does not take a plan binding for resources, or a resource binding that is not there', () => {
    const { omitted } = importViewTimeline(
      planViewTimeline(),
      0,
      bindings,
      [planSource],
      choose('source-1', 'source-1'),
    );
    expect(omitted.find(({ layer }) => layer === 'SOC')?.reason).toMatch(/No source was chosen/);
    const unknown = importViewTimeline(planViewTimeline(), 0, bindings, [planSource], choose('source-9', null));
    expect(unknown.omitted.find(({ layer }) => layer === 'Activities')?.reason).toMatch(/No source was chosen/);
  });

  it('leaves out, and says why, every layer it cannot place; the rest still loads', () => {
    // An Analysis with two plans (which one?), no simulation, and a different revision of the view's source.
    const ambiguous = [
      plan,
      { id: 'source-4', kind: 'plan', planId: 2 } as AnalysisSourceBinding,
      imported('source-5', 99),
    ];
    const { kept, omitted, timeline } = importViewTimeline(
      planViewTimeline(),
      0,
      ambiguous,
      [planSource],
      choose(null, null),
    );
    expect(kept).toBe(0);
    expect(timeline.rows).toEqual([]);
    expect(Object.fromEntries(omitted.map(({ layer, reason }) => [layer, reason]))).toEqual({
      Activities: "No source was chosen for the Plan's activity layers",
      DSN: 'Source "external-events" is not available in an Analysis',
      Events: 'External events are not available in an Analysis',
      SOC: 'This Analysis has no simulation to read them from',
      'Tour passes': 'This Analysis has a different revision of "Tour" than the one this view used',
    });
    // The source isn't in the Analysis at all, and one the view names has been removed from its plan.
    const none = importViewTimeline(planViewTimeline(), 0, [plan], [planSource], choose('source-1', null));
    expect(none.omitted.find(({ layer }) => layer === 'Tour passes')?.reason).toBe('"Tour" is not in this Analysis');
    const gone = importViewTimeline(planViewTimeline(), 0, bindings, [], choose('source-1', 'source-2'));
    expect(gone.omitted.find(({ layer }) => layer === 'Tour passes')?.reason).toContain('imported:7');
  });

  it('never substitutes a newer revision, and tells two bound revisions apart', () => {
    const both = [imported('source-1', 26), imported('source-2', 27)];
    const { timeline } = importViewTimeline(planViewTimeline(), 0, both, [planSource], choose(null, null));
    expect(timeline.rows.find(row => row.id === 3)?.layers[0].sourceId).toBe('source-1');
    const newerOnly = [imported('source-2', 27)];
    const result = importViewTimeline(planViewTimeline(), 0, newerOnly, [planSource], choose(null, null));
    expect(result.timeline.rows.find(row => row.id === 3)).toBeUndefined();
  });

  it('drops an axis and its guides only when every layer that used it is left out', () => {
    const timeline = planViewTimeline();
    // A second layer on the same axis, on an unavailable source: the axis stays for the layer that is kept.
    timeline.rows[1].layers.push({
      ...timeline.rows[1].layers[0],
      id: 22,
      name: 'Other',
      sourceId: 'external-dataset:2',
    });
    const kept = importViewTimeline(timeline, 0, bindings, [], choose(null, 'source-2'));
    const power = kept.timeline.rows.find(row => row.id === 2) as Row;
    expect(power.layers.map(layer => layer.name)).toEqual(['SOC']);
    expect(power.yAxes).toHaveLength(1);
    expect(power.horizontalGuides).toHaveLength(1);
    // With no simulation to read it, the resource layer is left out, and the row and axis with it.
    const dropped = importViewTimeline(timeline, 0, [plan], [], choose('source-1', null));
    expect(dropped.timeline.rows.find(row => row.id === 2)).toBeUndefined();
  });

  it('keeps a row that had no layers', () => {
    const empty = createTimeline([], {
      items: [{ id: 1, type: 'row' }],
      rows: [createRow([], { id: 1, name: 'Empty' })],
    });
    const { timeline } = importViewTimeline(empty, 0, [], [], choose(null, null));
    expect(timeline.rows.map(row => row.name)).toEqual(['Empty']);
    expect(timeline.items).toEqual([{ id: 1, type: 'row' }]);
  });
});

describe('what an Analysis offers unbound layers', () => {
  it('preselects only the unambiguous choice', () => {
    expect(getUnboundLayerOptions([plan, simulation]).defaults).toEqual(choose('source-1', 'source-2'));
    // A simulation-only Analysis: its spans are the activities.
    expect(getUnboundLayerOptions([simulation]).defaults).toEqual(choose('source-2', 'source-2'));
    // Two plans: the person must say which.
    const twoPlans = [plan, { id: 'source-4', kind: 'plan', planId: 2 } as AnalysisSourceBinding, simulation];
    expect(getUnboundLayerOptions(twoPlans).defaults).toEqual(choose(null, 'source-2'));
    expect(getUnboundLayerOptions(twoPlans).activity.map(({ id }) => id)).toEqual(['source-1', 'source-4', 'source-2']);
    expect(getUnboundLayerOptions([imported('source-1', 26)]).defaults).toEqual(choose(null, null));
  });

  it('counts what in a timeline reads the Plan, and which plan sources it names', () => {
    const timeline = planViewTimeline();
    expect(countUnboundLayers(timeline)).toEqual({ activity: 1, resource: 1 });
    expect(getImportedPlanSourceIds(timeline)).toEqual([7]);
  });
});
