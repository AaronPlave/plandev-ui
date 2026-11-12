import { keyBy } from 'lodash-es';
import { describe, expect, test } from 'vitest';
import {
  ViewDefaultSectionColor,
  ViewDiscreteLayerColorPresets,
  ViewLineLayerColorPresets,
  ViewXRangeLayerSchemePresets,
} from '../constants/view';
import type { ActivityDirective, ActivityType } from '../types/activity';
import type { ExternalEvent } from '../types/external-event';
import type { DefaultEffectiveArgumentsMap } from '../types/parameter';
import type { Resource, ResourceType, ResourceValue, Span, SpanUtilityMaps, SpansMap } from '../types/simulation';
import type { Tag } from '../types/tags';
import type { ValueSchema } from '../types/schema';
import type { DiscreteTreeNode, InterpolationMode, TimeRange, Timeline, XRangeLayer } from '../types/timeline';
import { createSpanUtilityMaps } from './activities';
import { convertUTCToMs } from './time';
import {
  DEFAULT_INTERPOLATION,
  DEFAULT_LINE_FILL_OPACITY,
  applyActivityLayerFilter,
  applyTimelineItemDrop,
  createHorizontalGuide,
  createRow,
  createSection,
  createTimeline,
  createTimelineActivityLayer,
  createTimelineExternalEventLayer,
  DEFAULT_LINE_OPACITY,
  DEFAULT_LINE_STYLE,
  DEFAULT_POINT_SHAPE,
  DEFAULT_SHOW_POINTS_MODE,
  selectMarkerPoints,
  clampGuideBand,
  clampLineSize,
  clampOpacity,
  createTimelineLineLayer,
  createTimelineXRangeLayer,
  createVerticalGuide,
  createYAxis,
  directiveInView,
  duplicateRow,
  duplicateSection,
  externalEventInView,
  formatBandDuration,
  generateDiscreteTreeUtil,
  getContrastingTextColor,
  getContrastRatio,
  getHorizontalGuideBand,
  getLineCurve,
  getLineDashArray,
  getLineFillBaselineY,
  getLineLayerStacks,
  getLogConstant,
  getLogTickValues,
  getMarkerGlyphExtents,
  getMatchingTypesForActivityLayerFilter,
  getNextSectionID,
  getPointSpriteSize,
  getPointSymbolSize,
  getRenderableTimelineItems,
  getResourceForLayer,
  getRowSection,
  getSmallestMagnitudeForAxis,
  getTimeRangeAroundTime,
  getUniqueColorForActivityLayer,
  getUniqueColorForLineLayer,
  getUniqueColorSchemeForXRangeLayer,
  getXRangeColorScale,
  getXRangeValueDomain,
  getYAxisBounds,
  getYScale,
  insertRowAfterInTimelineHierarchy,
  isActivityLayer,
  isDroppableHoldPoint,
  isExternalEventLayer,
  isNumericResourceSchema,
  isLineLayer,
  isXRangeLayer,
  matchesDynamicFilter,
  moveTimelineItemInHierarchy,
  paginateNodes,
  removeRowFromTimelineHierarchy,
  resolveSectionDropEdge,
  spanInView,
  stackLineLayerValues,
  thinTicksByPixelSpacing,
  toTimelineDropEdge,
  ungroupAllTimelineSections,
} from './timeline';

const testActivityTypes: ActivityType[] = [
  {
    computed_attributes_value_schema: {
      items: {},
      type: 'struct',
    },
    description: '',
    name: 'child',
    parameters: {
      counter: {
        order: 0,
        schema: {
          type: 'int',
        },
      },
    },
    required_parameters: [],
    subsystem_tag: null,
  },
  {
    computed_attributes_value_schema: {
      items: {},
      type: 'struct',
    },
    description: '',
    name: 'parent',
    parameters: {
      label: {
        order: 0,
        schema: {
          type: 'string',
        },
      },
    },
    required_parameters: [],
    subsystem_tag: {
      color: '#FFFFFF',
      created_at: '2022-08-03T18:21:51',
      id: 1,
      name: 'subsystem1',
      owner: 'user1',
    },
  },
  {
    computed_attributes_value_schema: {
      items: {
        biteSizeWasBig: {
          type: 'boolean',
        },
        newFlag: {
          type: 'variant',
          variants: [
            {
              key: 'A',
              label: 'A',
            },
            {
              key: 'B',
              label: 'B',
            },
          ],
        },
      },
      type: 'struct',
    },
    description: '',
    name: 'BiteBanana',
    parameters: {
      biteSize: {
        order: 0,
        schema: {
          metadata: {
            banannotation: {
              value: 'Specifies the size of bite to take',
            },
            unit: {
              value: 'm',
            },
          },
          type: 'real',
        },
      },
    },
    required_parameters: [],
    subsystem_tag: null,
  },
  {
    computed_attributes_value_schema: {
      type: 'int',
    },
    description: '',
    name: 'BakeBananaBread',
    parameters: {
      glutenFree: {
        order: 2,
        schema: {
          type: 'boolean',
        },
      },
      tbSugar: {
        order: 1,
        schema: {
          type: 'int',
        },
      },
      temperature: {
        order: 0,
        schema: {
          type: 'real',
        },
      },
    },
    required_parameters: ['tbSugar', 'glutenFree'],
    subsystem_tag: null,
  },
];

const testDefaultArgumentsMap: DefaultEffectiveArgumentsMap = {
  BakeBananaBread: { temperature: 350 },
  BiteBanana: { biteSize: 1 },
  child: { counter: 0 },
  parent: { label: 'unlabeled' },
};

const testSpans: Span[] = [
  generateSpan({
    duration: '03:00:00',
    durationMs: 10800000,
    endMs: 1,
    parent_id: 1,
    span_id: 2,
    startMs: 0,
    start_offset: '00:10:00',
    type: 'child',
  }),
  generateSpan({
    duration: '02:00:00',
    durationMs: 7200000,
    endMs: 1,
    parent_id: null,
    span_id: 1,
    startMs: 0,
    start_offset: '00:00:00',
    type: 'parent',
  }),
  generateSpan({
    duration: '04:00:00',
    durationMs: 14400000,
    endMs: 1,
    parent_id: 1,
    span_id: 3,
    startMs: 0,
    start_offset: '00:05:00',
    type: 'child',
  }),
  generateSpan({
    attributes: {
      arguments: {},
      computedAttributes: {},
      directiveId: 1,
    },
    duration: '04:00:00',
    durationMs: 14400000,
    endMs: 1,
    parent_id: null,
    span_id: 4,
    startMs: 0,
    start_offset: '00:05:00',
    type: 'BiteBanana',
  }),
  generateSpan({
    attributes: {
      arguments: {},
      computedAttributes: {},
      directiveId: 2,
    },
    duration: '04:00:00',
    durationMs: 14400000,
    endMs: 1,
    parent_id: null,
    span_id: 5,
    startMs: 0,
    start_offset: '00:05:00',
    type: 'BiteBanana',
  }),
];
const testDirectives: ActivityDirective[] = [
  generateActivityDirective({
    id: 1,
    name: 'Bar',
    start_offset: '00:10:00',
    start_time_ms: 0,
    type: 'BiteBanana',
  }),
  generateActivityDirective({
    id: 2,
    name: 'Charlie',
    start_offset: '00:10:00',
    start_time_ms: 0,
    type: 'BiteBanana',
  }),
];

const testExternalEvents: ExternalEvent[] = [generateExternalEvent({})];

const testSpansMap: SpansMap = keyBy(testSpans, 'span_id');
const testSpansUtilityMap: SpanUtilityMaps = createSpanUtilityMaps(testSpans);

function generateTimelines() {
  // Create test timelines
  const timeline1 = createTimeline([]);
  const timeline2 = createTimeline([timeline1]);
  return [timeline1, timeline2];
}

function populateTimelineRows(timelines: Timeline[]) {
  timelines.forEach(timeline => {
    timeline.rows.push(createRow(timelines));
    timeline.rows.push(createRow(timelines));
  });
}

function populateTimelineVerticalGuides(timelines: Timeline[]) {
  timelines.forEach(timeline => {
    timeline.verticalGuides.push(createVerticalGuide(timelines, ''));
    timeline.verticalGuides.push(createVerticalGuide(timelines, ''));
  });
}

function populateTimelineLayers(timelines: Timeline[]) {
  timelines.forEach(timeline => {
    timeline.rows.forEach(row => {
      row.layers.push(createTimelineActivityLayer(timelines));
      row.layers.push(createTimelineLineLayer(timelines, row.yAxes));
      row.layers.push(createTimelineXRangeLayer(timelines, row.yAxes));
      row.layers.push(createTimelineExternalEventLayer(timelines));
    });
  });
  return timelines;
}

function populateTimelineHorizontalGuides(timelines: Timeline[]) {
  timelines.forEach(timeline => {
    timeline.rows.forEach(row => {
      row.horizontalGuides.push(createHorizontalGuide(timelines, row.yAxes));
      row.horizontalGuides.push(createHorizontalGuide(timelines, row.yAxes));
    });
  });
  return timelines;
}

function populateTimelineYAxes(timelines: Timeline[]) {
  timelines.forEach(timeline => {
    timeline.rows.forEach(row => {
      row.yAxes.push(createYAxis(timelines));
    });
  });
  return timelines;
}

function generateActivityDirective(properties: Partial<ActivityDirective>): ActivityDirective {
  return {
    anchor_id: 0,
    anchored_to_start: true,
    arguments: {},
    created_at: '',
    created_by: 'foo',
    id: 1,
    last_modified_arguments_at: '',
    last_modified_at: '',
    metadata: {},
    name: '',
    plan_id: 1,
    source_scheduling_goal_id: null,
    source_scheduling_goal_invocation_id: null,
    start_offset: '0',
    start_time_ms: 0,
    tags: [],
    type: 'BiteBanana',
    ...properties,
  };
}

function generateTag(properties: Partial<Tag>): Tag {
  return { color: '#FFFFFF', created_at: '', id: -1, name: '', owner: '', ...properties };
}

function generateSpan(properties: Partial<Span>): Span {
  return {
    attributes: { arguments: {}, computedAttributes: {} },
    dataset_id: 1,
    duration: '',
    durationMs: 1,
    endMs: 1,
    parent_id: null,
    span_id: 1,
    startMs: 0,
    start_offset: '',
    type: 'foo',
    ...properties,
  };
}

function generateExternalEvent(properties: Partial<ExternalEvent>): ExternalEvent {
  return {
    attributes: {},
    duration: '',
    duration_ms: 0,
    pkey: {
      derivation_group_name: 'test_derivation_group',
      event_type_name: 'test_event_type',
      key: 'test_event',
      source_key: 'test_source',
    },
    source: undefined,
    start_ms: 0,
    start_time: '',
    ...properties,
  };
}

test('createTimeline', () => {
  const timelines = generateTimelines();
  expect(timelines[0].id).toBe(0);
  expect(timelines[1].id).toBe(1);
});

test('createRow', () => {
  const timelines = generateTimelines();
  populateTimelineRows(timelines);

  // Check length
  expect(timelines[0].rows.length).toBe(2);
  expect(timelines[1].rows.length).toBe(2);

  // Check IDs
  expect(timelines[0].rows[0].id).toBe(0);
  expect(timelines[0].rows[1].id).toBe(1);
  expect(timelines[1].rows[0].id).toBe(2);
  expect(timelines[1].rows[1].id).toBe(3);
});

test('createTimelineLayers', () => {
  const timelines = generateTimelines();
  populateTimelineRows(timelines);
  populateTimelineYAxes(timelines);
  populateTimelineLayers(timelines);

  // Check IDs
  expect(timelines[0].rows[0].layers[0].chartType).toBe('activity');
  expect(timelines[0].rows[0].layers[0].id).toBe(0);
  expect(timelines[0].rows[0].layers[0].yAxisId).toBe(null);
  expect(timelines[0].rows[0].layers[1].chartType).toBe('line');
  expect(timelines[0].rows[0].layers[1].id).toBe(1);
  expect(timelines[0].rows[0].layers[1].yAxisId).toBe(0);
  expect(timelines[0].rows[0].layers[2].chartType).toBe('x-range');
  expect(timelines[0].rows[0].layers[2].id).toBe(2);
  expect(timelines[0].rows[0].layers[2].yAxisId).toBe(0);
  expect(timelines[0].rows[0].layers[3].chartType).toBe('externalEvent');
  expect(timelines[0].rows[0].layers[3].id).toBe(3);
  expect(timelines[0].rows[0].layers[3].yAxisId).toBe(null);

  expect(timelines[1].rows[0].layers[0].chartType).toBe('activity');
  expect(timelines[1].rows[0].layers[0].id).toBe(8);
  expect(timelines[1].rows[0].layers[0].yAxisId).toBe(null);
  expect(timelines[1].rows[0].layers[1].chartType).toBe('line');
  expect(timelines[1].rows[0].layers[1].id).toBe(9);
  expect(timelines[1].rows[0].layers[1].yAxisId).toBe(2);
  expect(timelines[1].rows[0].layers[2].chartType).toBe('x-range');
  expect(timelines[1].rows[0].layers[2].id).toBe(10);
  expect(timelines[1].rows[0].layers[2].yAxisId).toBe(2);
  expect(timelines[1].rows[0].layers[3].chartType).toBe('externalEvent');
  expect(timelines[1].rows[0].layers[3].id).toBe(11);
  expect(timelines[1].rows[0].layers[3].yAxisId).toBe(null);
});

test('createTimelineLineLayer', () => {
  const layer = createTimelineLineLayer([], []);
  expect(layer.showFill).toBe(false);
  expect(layer.fillColor).toBeUndefined();
  expect(layer.fillOpacity).toBe(DEFAULT_LINE_FILL_OPACITY);

  const filledLayer = createTimelineLineLayer([], [], { fillColor: '#ff0000', fillOpacity: 0.5, showFill: true });
  expect(filledLayer.showFill).toBe(true);
  expect(filledLayer.fillColor).toBe('#ff0000');
  expect(filledLayer.fillOpacity).toBe(0.5);

  // A fully transparent fill is a valid choice and must not fall back to the default
  expect(createTimelineLineLayer([], [], { fillOpacity: 0 }).fillOpacity).toBe(0);
});

describe('clampOpacity with the area fill default', () => {
  test('Should pass through values already within 0-1', () => {
    expect(clampOpacity(0, DEFAULT_LINE_FILL_OPACITY)).toBe(0);
    expect(clampOpacity(0.25, DEFAULT_LINE_FILL_OPACITY)).toBe(0.25);
    expect(clampOpacity(1, DEFAULT_LINE_FILL_OPACITY)).toBe(1);
  });

  test('Should clamp values outside 0-1 since canvas ignores an out of range globalAlpha', () => {
    expect(clampOpacity(1.5, DEFAULT_LINE_FILL_OPACITY)).toBe(1);
    expect(clampOpacity(-1, DEFAULT_LINE_FILL_OPACITY)).toBe(0);
  });

  test('Should fall back to the supplied default for non-finite values', () => {
    // A cleared number input reports NaN, which canvas would ignore and leave the fill opaque
    expect(clampOpacity(NaN, DEFAULT_LINE_FILL_OPACITY)).toBe(DEFAULT_LINE_FILL_OPACITY);
    expect(clampOpacity(Infinity, DEFAULT_LINE_FILL_OPACITY)).toBe(DEFAULT_LINE_FILL_OPACITY);
    expect(clampOpacity(-Infinity, DEFAULT_LINE_FILL_OPACITY)).toBe(DEFAULT_LINE_FILL_OPACITY);
  });
});

describe('getLineFillBaselineY', () => {
  const drawHeight = 100; // Yields a y scale range of [92, 8] given CANVAS_PADDING_Y

  test('Should return the position of zero when zero is within the scale domain', () => {
    expect(getLineFillBaselineY(getYScale([0, 10], drawHeight), drawHeight)).toBe(92);
    expect(getLineFillBaselineY(getYScale([-10, 10], drawHeight), drawHeight)).toBe(50);
  });

  test('Should clamp to the canvas when zero is outside of the scale domain', () => {
    expect(getLineFillBaselineY(getYScale([10, 20], drawHeight), drawHeight)).toBe(drawHeight);
    expect(getLineFillBaselineY(getYScale([-20, -10], drawHeight), drawHeight)).toBe(0);
  });

  test('Should return null when the scale domain is empty', () => {
    expect(getLineFillBaselineY(getYScale([], drawHeight), drawHeight)).toBeNull();
  });
});

test('createTimelineHorizontalGuides', () => {
  const timelines = generateTimelines();
  populateTimelineRows(timelines);
  populateTimelineYAxes(timelines);
  populateTimelineHorizontalGuides(timelines);

  // Check IDs
  expect(timelines[0].rows[0].horizontalGuides[0].id).toBe(0);
  expect(timelines[0].rows[1].horizontalGuides[0].id).toBe(2);
});

test('createVerticalGuide', () => {
  const timelines = generateTimelines();
  populateTimelineVerticalGuides(timelines);

  // Check IDs
  expect(timelines[0].verticalGuides[0].id).toBe(0);
  expect(timelines[1].verticalGuides[0].id).toBe(2);
});

test('getYAxisBounds', () => {
  const timelines = generateTimelines();
  populateTimelineRows(timelines);
  populateTimelineYAxes(timelines);
  populateTimelineLayers(timelines);

  const layer1 = timelines[0].rows[0].layers[1];
  const layer2 = timelines[0].rows[0].layers[2];
  layer1.filter.resource = 'resourceWithValues';
  layer2.filter.resource = 'resourceWithNoValues';
  const yAxis = timelines[0].rows[0].yAxes[0];
  const layers = timelines[0].rows[0].layers;
  const resourceWithValues: Resource = {
    name: 'resourceWithValues',
    schema: {
      items: { initial: { type: 'real' }, rate: { type: 'real' } },
      type: 'struct',
    },
    values: [
      { x: 1, y: 10 },
      { x: 2, y: 11 },
      { x: 3, y: 12 },
      { x: 4, y: 13 },
      { x: 5, y: 14 },
      { x: 6, y: 15 },
    ],
  };
  const resourceWithNoValues: Resource = {
    name: 'resourceWithNoValues',
    schema: {
      items: { initial: { type: 'real' }, rate: { type: 'real' } },
      type: 'struct',
    },
    values: [],
  };
  const resources: Resource[] = [resourceWithValues, resourceWithNoValues];
  expect(getYAxisBounds(yAxis, [], [])).toEqual([]);
  expect(getYAxisBounds(yAxis, layers, [])).toEqual([]);
  expect(getYAxisBounds(yAxis, layers, resources)).toEqual([10, 15]);
  expect(getYAxisBounds(yAxis, layers, [resourceWithNoValues])).toEqual([]);
  expect(
    getYAxisBounds({ ...yAxis, domainFitMode: 'manual', scaleDomain: [0, 10] }, layers, [resourceWithNoValues]),
  ).toEqual([0, 10]);
  expect(getYAxisBounds(yAxis, layers, resources, { end: 4, start: 3 })).toEqual([11, 14]);
  expect(getYAxisBounds({ ...yAxis, domainFitMode: 'fitPlan' }, layers, resources, { end: 4, start: 3 })).toEqual([
    10, 15,
  ]);
});

test('duplicateRow', () => {
  const timelines = generateTimelines();
  populateTimelineRows(timelines);
  populateTimelineYAxes(timelines);
  populateTimelineLayers(timelines);

  const firstRow = timelines[0].rows[0];
  const duplicatedRow = duplicateRow(firstRow, timelines, timelines[0].id);
  expect(duplicatedRow).to.not.be.null;
  if (duplicatedRow && timelines && timelines[0].rows) {
    const lastTimeline = timelines.at(-1);
    if (lastTimeline) {
      const lastRow = lastTimeline.rows.at(-1);
      if (lastRow) {
        expect(duplicatedRow.id).toEqual(lastRow.id + 1);
        expect(duplicatedRow.layers.length).toEqual(firstRow.layers.length);
        expect(duplicatedRow.horizontalGuides.length).toEqual(firstRow.horizontalGuides.length);
        expect(duplicatedRow.yAxes.length).toEqual(firstRow.yAxes.length);
        expect(duplicatedRow.name).toEqual(`${firstRow.name} (copy)`);
      }
    }
  }
});

test('getResourceForLayer', () => {
  const resourceA: ResourceType = {
    name: 'resourceA',
    schema: {
      items: { initial: { type: 'real' }, rate: { type: 'real' } },
      metadata: {
        description: { value: 'This is resource A' },
      },
      type: 'struct',
    },
  };
  const resourceB: ResourceType = {
    name: 'resourceB',
    schema: {
      items: { initial: { type: 'real' }, rate: { type: 'real' } },
      metadata: {
        description: { value: 'This is resource B' },
      },
      type: 'struct',
    },
  };
  const layer = createTimelineLineLayer([], []);
  expect(getResourceForLayer(layer, [resourceA, resourceB])).to.deep.equal(undefined);

  const layer2 = createTimelineLineLayer([], []);
  expect(getResourceForLayer(layer2, [])).to.deep.equal(undefined);

  const layer3 = createTimelineLineLayer([], []);
  layer3.filter.resource = 'resourceA';
  expect(getResourceForLayer(layer3, [resourceA, resourceB])).to.deep.equal(resourceA);

  // The same name from two sources: a layer only resolves to the resource from its own source.
  const fromDatasetA = { ...resourceA, sourceId: 'external-dataset:1' };
  const fromDatasetB = { ...resourceA, sourceId: 'external-dataset:2' };
  const layer4 = { ...createTimelineLineLayer([], []), sourceId: 'external-dataset:2' };
  layer4.filter.resource = 'resourceA';
  expect(getResourceForLayer(layer4, [resourceA, fromDatasetA, fromDatasetB])).toBe(fromDatasetB);
  expect(getResourceForLayer(layer4, [resourceA, fromDatasetA])).toBeUndefined();
  expect(getResourceForLayer(layer3, [fromDatasetA, fromDatasetB, resourceA])).toBe(resourceA);
});

// TODO - should we make a test case for filtering the sources in an ExternalEventsLayer?

test('directiveInView', () => {
  const viewTimeRange: TimeRange = { end: 1716332383895 + 60000, start: 1716332383895 }; // One minute duration
  expect(directiveInView(generateActivityDirective({ start_time_ms: -1 }), viewTimeRange)).toBe(false);
  expect(directiveInView(generateActivityDirective({ start_time_ms: 1716332383894 }), viewTimeRange)).toBe(false);
  expect(directiveInView(generateActivityDirective({ start_time_ms: 1716332383895 }), viewTimeRange)).toBe(true);
  expect(directiveInView(generateActivityDirective({ start_time_ms: 1716332383896 }), viewTimeRange)).toBe(true);
  expect(directiveInView(generateActivityDirective({ start_time_ms: 1716332383895 + 60000 }), viewTimeRange)).toBe(
    false,
  );
  expect(directiveInView(generateActivityDirective({ start_time_ms: 1716332383895 + 60001 }), viewTimeRange)).toBe(
    false,
  );
});

test('spanInView', () => {
  const viewTimeRange: TimeRange = { end: 1716332383895 + 60000, start: 1716332383895 }; // One minute duration
  expect(spanInView(generateSpan({ durationMs: 1, endMs: 1, startMs: 0 }), viewTimeRange)).toBe(false);
  expect(spanInView(generateSpan({ durationMs: 3, endMs: 1716332383896, startMs: 1716332383893 }), viewTimeRange)).toBe(
    true,
  );
  expect(spanInView(generateSpan({ durationMs: 1, endMs: 1716332383896, startMs: 1716332383895 }), viewTimeRange)).toBe(
    true,
  );
  expect(spanInView(generateSpan({ durationMs: 1, endMs: 1716332383897, startMs: 1716332383896 }), viewTimeRange)).toBe(
    true,
  );
  expect(
    spanInView(
      generateSpan({ durationMs: 1, endMs: 1716332383895 + 60001, startMs: 1716332383895 + 60000 }),
      viewTimeRange,
    ),
  ).toBe(false);
  expect(spanInView(generateSpan({ durationMs: 1, endMs: 9716332383896, startMs: 9716332383895 }), viewTimeRange)).toBe(
    false,
  );
});

test('externalEventInView', () => {
  const viewTimeRange: TimeRange = { end: 1716332383895 + 60000, start: 1716332383895 }; // One minute duration
  expect(externalEventInView(generateExternalEvent({ duration_ms: 1, start_ms: 0 }), viewTimeRange)).toBe(false);
  expect(externalEventInView(generateExternalEvent({ duration_ms: 3, start_ms: 1716332383893 }), viewTimeRange)).toBe(
    true,
  );
  expect(externalEventInView(generateExternalEvent({ duration_ms: 1, start_ms: 1716332383895 }), viewTimeRange)).toBe(
    true,
  );
  expect(externalEventInView(generateExternalEvent({ duration_ms: 1, start_ms: 1716332383896 }), viewTimeRange)).toBe(
    true,
  );
  expect(externalEventInView(generateExternalEvent({ duration_ms: 1, start_ms: 9716332383895 }), viewTimeRange)).toBe(
    false,
  );
  expect(
    externalEventInView(generateExternalEvent({ duration_ms: 1, start_ms: 1716332383895 + 60000 }), viewTimeRange),
  ).toBe(false);
  expect(externalEventInView(generateExternalEvent({ duration_ms: 1, start_ms: 9716332383895 }), viewTimeRange)).toBe(
    false,
  );
});

test('isActivityLayer', () => {
  expect(isActivityLayer(createTimelineActivityLayer([]))).toBe(true);
  expect(isActivityLayer(createTimelineLineLayer([], []))).toBe(false);
  expect(isActivityLayer(createTimelineXRangeLayer([], []))).toBe(false);
  expect(isActivityLayer(createTimelineExternalEventLayer([]))).toBe(false);
});

test('isLineLayer', () => {
  expect(isLineLayer(createTimelineActivityLayer([]))).toBe(false);
  expect(isLineLayer(createTimelineLineLayer([], []))).toBe(true);
  expect(isLineLayer(createTimelineXRangeLayer([], []))).toBe(false);
  expect(isLineLayer(createTimelineExternalEventLayer([]))).toBe(false);
});

test('isXRangeLayer', () => {
  expect(isXRangeLayer(createTimelineActivityLayer([]))).toBe(false);
  expect(isXRangeLayer(createTimelineLineLayer([], []))).toBe(false);
  expect(isXRangeLayer(createTimelineXRangeLayer([], []))).toBe(true);
  expect(isXRangeLayer(createTimelineExternalEventLayer([]))).toBe(false);
});

test('isExternalEventLayer', () => {
  expect(isExternalEventLayer(createTimelineActivityLayer([]))).toBe(false);
  expect(isExternalEventLayer(createTimelineLineLayer([], []))).toBe(false);
  expect(isExternalEventLayer(createTimelineXRangeLayer([], []))).toBe(false);
  expect(isExternalEventLayer(createTimelineExternalEventLayer([]))).toBe(true);
});

test('paginateNodes', () => {
  const testNodes: DiscreteTreeNode[] = [];
  for (let i = 0; i < 1000; i++) {
    testNodes.push({
      activity_type: 'aggregation',
      children: [],
      expanded: false,
      id: 'foo',
      isLeaf: false,
      items: [],
      label: 'bar',
      type: 'Activity',
    });
  }
  expect(paginateNodes([], 'activity', '', {})).to.deep.eq([]);
  const paginatedNodes = paginateNodes(testNodes, 'activity', 'foo', { 'foo_[0 … 99]_page': true });
  expect(paginatedNodes).toHaveLength(10);
  expect(paginatedNodes[0].id).toBe('foo_[0 … 99]_page');
  expect(paginatedNodes[0].expanded).toBe(true);
  expect(paginatedNodes[9].id).toBe('foo_[900 … 999]_page');
});

test('generateDiscreteTree', () => {
  const time = Date.now();

  // empty
  expect(
    generateDiscreteTreeUtil(
      [],
      [],
      [],
      {},
      'flat',
      'event_type_name',
      false,
      testSpansUtilityMap,
      testSpansMap,
      false,
      false,
      {
        end: time + 10000,
        start: time,
      },
      false,
      false,
    ),
  ).to.deep.equal([]);

  // Directives, spans, and external events
  expect(
    generateDiscreteTreeUtil(
      testDirectives,
      testSpans,
      testExternalEvents,
      { BiteBanana: true, BiteBanana_1: true, parent: true, parent_1: true, parent_1_child: true },
      'flat',
      'event_type_name',
      false,
      testSpansUtilityMap,
      testSpansMap,
      true,
      true,
      {
        end: time + 10000,
        start: time,
      },
      true,
      true,
    ),
  ).to.deep.equal([
    {
      activity_type: undefined,
      children: [
        {
          activity_type: 'aggregation',
          children: [
            {
              activity_type: 'directive',
              children: [],
              expanded: true,
              id: 'BiteBanana_1',
              isLeaf: true,
              items: [
                {
                  directive: {
                    anchor_id: 0,
                    anchored_to_start: true,
                    arguments: {},
                    created_at: '',
                    created_by: 'foo',
                    id: 1,
                    last_modified_arguments_at: '',
                    last_modified_at: '',
                    metadata: {},
                    name: 'Bar',
                    plan_id: 1,
                    source_scheduling_goal_id: null,
                    source_scheduling_goal_invocation_id: null,
                    start_offset: '00:10:00',
                    start_time_ms: 0,
                    tags: [],
                    type: 'BiteBanana',
                  },
                  span: {
                    attributes: {
                      arguments: {},
                      computedAttributes: {},
                      directiveId: 1,
                    },
                    dataset_id: 1,
                    duration: '04:00:00',
                    durationMs: 14400000,
                    endMs: 1,
                    parent_id: null,
                    span_id: 4,
                    startMs: 0,
                    start_offset: '00:05:00',
                    type: 'BiteBanana',
                  },
                },
              ],
              label: 'Bar',
              type: 'Activity',
            },
            {
              activity_type: 'directive',
              children: [],
              expanded: false,
              id: 'BiteBanana_2',
              isLeaf: true,
              items: [
                {
                  directive: {
                    anchor_id: 0,
                    anchored_to_start: true,
                    arguments: {},
                    created_at: '',
                    created_by: 'foo',
                    id: 2,
                    last_modified_arguments_at: '',
                    last_modified_at: '',
                    metadata: {},
                    name: 'Charlie',
                    plan_id: 1,
                    source_scheduling_goal_id: null,
                    source_scheduling_goal_invocation_id: null,
                    start_offset: '00:10:00',
                    start_time_ms: 0,
                    tags: [],
                    type: 'BiteBanana',
                  },
                  span: {
                    attributes: {
                      arguments: {},
                      computedAttributes: {},
                      directiveId: 2,
                    },
                    dataset_id: 1,
                    duration: '04:00:00',
                    durationMs: 14400000,
                    endMs: 1,
                    parent_id: null,
                    span_id: 5,
                    startMs: 0,
                    start_offset: '00:05:00',
                    type: 'BiteBanana',
                  },
                },
              ],
              label: 'Charlie',
              type: 'Activity',
            },
          ],
          expanded: true,
          id: 'BiteBanana',
          isLeaf: false,
          items: [
            {
              directive: {
                anchor_id: 0,
                anchored_to_start: true,
                arguments: {},
                created_at: '',
                created_by: 'foo',
                id: 1,
                last_modified_arguments_at: '',
                last_modified_at: '',
                metadata: {},
                name: 'Bar',
                plan_id: 1,
                source_scheduling_goal_id: null,
                source_scheduling_goal_invocation_id: null,
                start_offset: '00:10:00',
                start_time_ms: 0,
                tags: [],
                type: 'BiteBanana',
              },
              span: {
                attributes: {
                  arguments: {},
                  computedAttributes: {},
                  directiveId: 1,
                },
                dataset_id: 1,
                duration: '04:00:00',
                durationMs: 14400000,
                endMs: 1,
                parent_id: null,
                span_id: 4,
                startMs: 0,
                start_offset: '00:05:00',
                type: 'BiteBanana',
              },
            },
            {
              directive: {
                anchor_id: 0,
                anchored_to_start: true,
                arguments: {},
                created_at: '',
                created_by: 'foo',
                id: 2,
                last_modified_arguments_at: '',
                last_modified_at: '',
                metadata: {},
                name: 'Charlie',
                plan_id: 1,
                source_scheduling_goal_id: null,
                source_scheduling_goal_invocation_id: null,
                start_offset: '00:10:00',
                start_time_ms: 0,
                tags: [],
                type: 'BiteBanana',
              },
              span: {
                attributes: {
                  arguments: {},
                  computedAttributes: {},
                  directiveId: 2,
                },
                dataset_id: 1,
                duration: '04:00:00',
                durationMs: 14400000,
                endMs: 1,
                parent_id: null,
                span_id: 5,
                startMs: 0,
                start_offset: '00:05:00',
                type: 'BiteBanana',
              },
            },
          ],
          label: 'BiteBanana',
          type: 'Activity',
        },
        {
          activity_type: 'aggregation',
          children: [],
          expanded: false,
          id: 'child',
          isLeaf: false,
          items: [
            {
              span: {
                attributes: {
                  arguments: {},
                  computedAttributes: {},
                },
                dataset_id: 1,
                duration: '03:00:00',
                durationMs: 10800000,
                endMs: 1,
                parent_id: 1,
                span_id: 2,
                startMs: 0,
                start_offset: '00:10:00',
                type: 'child',
              },
            },
            {
              span: {
                attributes: {
                  arguments: {},
                  computedAttributes: {},
                },
                dataset_id: 1,
                duration: '04:00:00',
                durationMs: 14400000,
                endMs: 1,
                parent_id: 1,
                span_id: 3,
                startMs: 0,
                start_offset: '00:05:00',
                type: 'child',
              },
            },
          ],
          label: 'child',
          type: 'Activity',
        },
        {
          activity_type: 'aggregation',
          children: [
            {
              activity_type: 'span',
              children: [
                {
                  activity_type: 'aggregation',
                  children: [
                    {
                      activity_type: 'span',
                      children: [],
                      expanded: false,
                      id: 'parent_1_child_2',
                      isLeaf: true,
                      items: [
                        {
                          span: {
                            attributes: {
                              arguments: {},
                              computedAttributes: {},
                            },
                            dataset_id: 1,
                            duration: '03:00:00',
                            durationMs: 10800000,
                            endMs: 1,
                            parent_id: 1,
                            span_id: 2,
                            startMs: 0,
                            start_offset: '00:10:00',
                            type: 'child',
                          },
                        },
                      ],
                      label: 'child',
                      type: 'Activity',
                    },
                    {
                      activity_type: 'span',
                      children: [],
                      expanded: false,
                      id: 'parent_1_child_3',
                      isLeaf: true,
                      items: [
                        {
                          span: {
                            attributes: {
                              arguments: {},
                              computedAttributes: {},
                            },
                            dataset_id: 1,
                            duration: '04:00:00',
                            durationMs: 14400000,
                            endMs: 1,
                            parent_id: 1,
                            span_id: 3,
                            startMs: 0,
                            start_offset: '00:05:00',
                            type: 'child',
                          },
                        },
                      ],
                      label: 'child',
                      type: 'Activity',
                    },
                  ],
                  expanded: true,
                  id: 'parent_1_child',
                  isLeaf: false,
                  items: [
                    {
                      span: {
                        attributes: {
                          arguments: {},
                          computedAttributes: {},
                        },
                        dataset_id: 1,
                        duration: '03:00:00',
                        durationMs: 10800000,
                        endMs: 1,
                        parent_id: 1,
                        span_id: 2,
                        startMs: 0,
                        start_offset: '00:10:00',
                        type: 'child',
                      },
                    },
                    {
                      span: {
                        attributes: {
                          arguments: {},
                          computedAttributes: {},
                        },
                        dataset_id: 1,
                        duration: '04:00:00',
                        durationMs: 14400000,
                        endMs: 1,
                        parent_id: 1,
                        span_id: 3,
                        startMs: 0,
                        start_offset: '00:05:00',
                        type: 'child',
                      },
                    },
                  ],
                  label: 'child',
                  type: 'Activity',
                },
              ],
              expanded: true,
              id: 'parent_1',
              isLeaf: false,
              items: [
                {
                  span: {
                    attributes: {
                      arguments: {},
                      computedAttributes: {},
                    },
                    dataset_id: 1,
                    duration: '02:00:00',
                    durationMs: 7200000,
                    endMs: 1,
                    parent_id: null,
                    span_id: 1,
                    startMs: 0,
                    start_offset: '00:00:00',
                    type: 'parent',
                  },
                },
              ],
              label: 'parent',
              type: 'Activity',
            },
          ],
          expanded: true,
          id: 'parent',
          isLeaf: false,
          items: [
            {
              span: {
                attributes: {
                  arguments: {},
                  computedAttributes: {},
                },
                dataset_id: 1,
                duration: '02:00:00',
                durationMs: 7200000,
                endMs: 1,
                parent_id: null,
                span_id: 1,
                startMs: 0,
                start_offset: '00:00:00',
                type: 'parent',
              },
            },
          ],
          label: 'parent',
          type: 'Activity',
        },
      ],
      expanded: false,
      id: '!!activity-agg',
      isLeaf: false,
      items: [
        {
          directive: {
            anchor_id: 0,
            anchored_to_start: true,
            arguments: {},
            created_at: '',
            created_by: 'foo',
            id: 1,
            last_modified_arguments_at: '',
            last_modified_at: '',
            metadata: {},
            name: 'Bar',
            plan_id: 1,
            source_scheduling_goal_id: null,
            source_scheduling_goal_invocation_id: null,
            start_offset: '00:10:00',
            start_time_ms: 0,
            tags: [],
            type: 'BiteBanana',
          },
          span: {
            attributes: {
              arguments: {},
              computedAttributes: {},
              directiveId: 1,
            },
            dataset_id: 1,
            duration: '04:00:00',
            durationMs: 14400000,
            endMs: 1,
            parent_id: null,
            span_id: 4,
            startMs: 0,
            start_offset: '00:05:00',
            type: 'BiteBanana',
          },
        },
        {
          directive: {
            anchor_id: 0,
            anchored_to_start: true,
            arguments: {},
            created_at: '',
            created_by: 'foo',
            id: 2,
            last_modified_arguments_at: '',
            last_modified_at: '',
            metadata: {},
            name: 'Charlie',
            plan_id: 1,
            source_scheduling_goal_id: null,
            source_scheduling_goal_invocation_id: null,
            start_offset: '00:10:00',
            start_time_ms: 0,
            tags: [],
            type: 'BiteBanana',
          },
          span: {
            attributes: {
              arguments: {},
              computedAttributes: {},
              directiveId: 2,
            },
            dataset_id: 1,
            duration: '04:00:00',
            durationMs: 14400000,
            endMs: 1,
            parent_id: null,
            span_id: 5,
            startMs: 0,
            start_offset: '00:05:00',
            type: 'BiteBanana',
          },
        },
        {
          span: {
            attributes: {
              arguments: {},
              computedAttributes: {},
            },
            dataset_id: 1,
            duration: '03:00:00',
            durationMs: 10800000,
            endMs: 1,
            parent_id: 1,
            span_id: 2,
            startMs: 0,
            start_offset: '00:10:00',
            type: 'child',
          },
        },
        {
          span: {
            attributes: {
              arguments: {},
              computedAttributes: {},
            },
            dataset_id: 1,
            duration: '04:00:00',
            durationMs: 14400000,
            endMs: 1,
            parent_id: 1,
            span_id: 3,
            startMs: 0,
            start_offset: '00:05:00',
            type: 'child',
          },
        },
        {
          span: {
            attributes: {
              arguments: {},
              computedAttributes: {},
            },
            dataset_id: 1,
            duration: '02:00:00',
            durationMs: 7200000,
            endMs: 1,
            parent_id: null,
            span_id: 1,
            startMs: 0,
            start_offset: '00:00:00',
            type: 'parent',
          },
        },
      ],
      label: 'Activities',
      type: 'Activity',
    },
    {
      activity_type: undefined,
      children: [
        {
          activity_type: undefined,
          children: [
            {
              activity_type: undefined,
              children: [],
              expanded: false,
              id: 'test_event',
              isLeaf: true,
              items: [
                {
                  externalEvent: {
                    attributes: {},
                    duration: '',
                    duration_ms: 0,
                    pkey: {
                      derivation_group_name: 'test_derivation_group',
                      event_type_name: 'test_event_type',
                      key: 'test_event',
                      source_key: 'test_source',
                    },
                    source: undefined,
                    start_ms: 0,
                    start_time: '',
                  },
                },
              ],
              label: 'test_event',
              type: 'ExternalEvent',
            },
          ],
          expanded: false,
          id: 'test_event_type',
          isLeaf: false,
          items: [
            {
              externalEvent: {
                attributes: {},
                duration: '',
                duration_ms: 0,
                pkey: {
                  derivation_group_name: 'test_derivation_group',
                  event_type_name: 'test_event_type',
                  key: 'test_event',
                  source_key: 'test_source',
                },
                source: undefined,
                start_ms: 0,
                start_time: '',
              },
            },
          ],
          label: 'test_event_type',
          type: 'ExternalEvent',
        },
      ],
      expanded: false,
      id: '!!ex-ev-agg',
      isLeaf: false,
      items: [
        {
          externalEvent: {
            attributes: {},
            duration: '',
            duration_ms: 0,
            pkey: {
              derivation_group_name: 'test_derivation_group',
              event_type_name: 'test_event_type',
              key: 'test_event',
              source_key: 'test_source',
            },
            source: undefined,
            start_ms: 0,
            start_time: '',
          },
        },
      ],
      label: 'External Events',
      type: 'ExternalEvent',
    },
  ]);
});

test('getUniqueColorForActivityLayer', () => {
  expect(getUniqueColorForActivityLayer(createRow([]))).toBe(ViewDiscreteLayerColorPresets[0]);
  const row2 = createRow([]);
  row2.layers = [createTimelineActivityLayer([])];
  expect(getUniqueColorForActivityLayer(row2)).toBe(ViewDiscreteLayerColorPresets[1]);
});

test('getUniqueColorForLineLayer', () => {
  expect(getUniqueColorForLineLayer(createRow([]))).toBe(ViewLineLayerColorPresets[0]);
  const row2 = createRow([]);
  row2.layers = [createTimelineLineLayer([], [])];
  expect(getUniqueColorForLineLayer(row2)).toBe(ViewLineLayerColorPresets[1]);
});

test('getUniqueColorSchemeForXRangeLayer', () => {
  expect(
    Object.keys(ViewXRangeLayerSchemePresets).indexOf(getUniqueColorSchemeForXRangeLayer(createRow([]))),
  ).toBeGreaterThan(-1);
  const row2 = createRow([]);
  row2.layers = [createTimelineXRangeLayer([], [])];
  const existingScheme = (row2.layers[0] as XRangeLayer).colorScheme;
  expect(getUniqueColorSchemeForXRangeLayer(row2)).not.toBe(existingScheme);
});

describe('getTimeRangeAroundTime', () => {
  const hourInMs = 3600000;
  const TEST_TIME = convertUTCToMs(`2024-10-14T16:06:00Z`);

  test('Should return TimeRange centered on time with +/- 1 day, unbounded', () => {
    const timeRange = getTimeRangeAroundTime(TEST_TIME, 48 * hourInMs);
    expect(timeRange).toStrictEqual({
      end: convertUTCToMs(`2024-10-15T16:06:00Z`), //1 day after TEST_TIME
      start: convertUTCToMs(`2024-10-13T16:06:00Z`), //1 day before TEST_TIME
    });
    expect(timeRange.end - timeRange.start).toBe(48 * hourInMs);
  });

  test('Should return TimeRange centered on time with +/- 1 hour, unbounded', () => {
    const timeRange = getTimeRangeAroundTime(TEST_TIME, 2 * hourInMs);
    expect(timeRange).toStrictEqual({
      end: convertUTCToMs(`2024-10-14T17:06:00Z`), //1 hour after TEST_TIME
      start: convertUTCToMs(`2024-10-14T15:06:00Z`), //1 hour before TEST_TIME
    });
    expect(timeRange.end - timeRange.start).toBe(2 * hourInMs);
  });

  test('Should return TimeRange with 48 hour span with time in it, bounded by the start', () => {
    const timeRange = getTimeRangeAroundTime(TEST_TIME, 48 * hourInMs, {
      end: convertUTCToMs(`2024-10-20T00:00:00Z`),
      start: convertUTCToMs(`2024-10-14T00:00:00Z`),
    });

    expect(timeRange).toStrictEqual({
      end: convertUTCToMs(`2024-10-16T00:00:00Z`), //bounded start + 48 hours
      start: convertUTCToMs(`2024-10-14T00:00:00Z`), //bounded start
    });
    expect(timeRange.end - timeRange.start).toBe(48 * hourInMs);
  });

  test('Should return TimeRange with 48 hour span with time in it, bounded by the end', () => {
    const timeRange = getTimeRangeAroundTime(TEST_TIME, 48 * hourInMs, {
      end: convertUTCToMs(`2024-10-14T11:59:59Z`),
      start: convertUTCToMs(`2024-10-10T00:00:00Z`),
    });
    expect(timeRange).toStrictEqual({
      end: convertUTCToMs(`2024-10-14T11:59:59Z`), //bounded end
      start: convertUTCToMs(`2024-10-12T11:59:59Z`), //bounded end - 48 hours
    });
    expect(timeRange.end - timeRange.start).toBe(48 * hourInMs);
  });
});

describe('applyActivityLayerFilter', () => {
  const tags: Tag[] = [generateTag({ id: 1 }), generateTag({ id: 2 })];
  const directives: ActivityDirective[] = [
    generateActivityDirective({ id: 1, name: 'Foo', source_scheduling_goal_id: 1, type: 'parent' }),
    generateActivityDirective({
      arguments: { newFlag: 'A' },
      id: 2,
      source_scheduling_goal_id: 2,
      tags: [{ tag: tags[1] }],
      type: 'BiteBanana',
    }),
    generateActivityDirective({ id: 3, tags: tags.map(tag => ({ tag })), type: 'PeelBanana' }),
    generateActivityDirective({ arguments: { newFlag: 'B' }, id: 4, type: 'BiteBanana' }),
  ];
  const spans: Span[] = [
    generateSpan({ parent_id: 1, span_id: 2, type: 'child' }),
    generateSpan({ parent_id: null, span_id: 1, type: 'parent' }),
    generateSpan({ parent_id: 1, span_id: 3, type: 'child' }),
    generateSpan({
      attributes: { arguments: { newFlag: 'A' }, computedAttributes: {} },
      parent_id: null,
      span_id: 4,
      type: 'BiteBanana',
    }),
    generateSpan({ parent_id: null, span_id: 5, type: 'PeelBanana' }),
    generateSpan({
      attributes: { arguments: { newFlag: 'B' }, computedAttributes: {} },
      parent_id: null,
      span_id: 6,
      type: 'BiteBanana',
    }),
  ];

  test('Should return all directives and spans if no filters applied', () => {
    expect(
      applyActivityLayerFilter(undefined, testDirectives, testSpans, testActivityTypes, testDefaultArgumentsMap),
    ).to.deep.eq({
      directives: testDirectives,
      spans: testSpans,
    });
    expect(
      applyActivityLayerFilter({}, testDirectives, testSpans, testActivityTypes, testDefaultArgumentsMap),
    ).to.deep.eq({
      directives: testDirectives,
      spans: testSpans,
    });
  });

  test('Should apply static type filters', () => {
    expect(
      applyActivityLayerFilter(
        { static_types: ['parent', 'BiteBanana'] },
        directives,
        spans,
        testActivityTypes,
        testDefaultArgumentsMap,
      ),
    ).to.deep.eq({
      directives: [directives[0], directives[1], directives[3]],
      spans: [spans[1], spans[3], spans[5]],
    });
  });

  test('Should apply dynamic type filters', () => {
    expect(
      applyActivityLayerFilter(
        {
          dynamic_type_filters: [
            {
              field: 'Type',
              id: 1,
              operator: 'includes',
              value: 'banana',
            },
          ],
        },
        directives,
        spans,
        testActivityTypes,
        testDefaultArgumentsMap,
      ),
    ).to.deep.eq({
      directives: [directives[1], directives[2], directives[3]],
      spans: [spans[3], spans[4], spans[5]],
    });

    expect(
      applyActivityLayerFilter(
        {
          dynamic_type_filters: [
            {
              field: 'Type',
              id: 1,
              operator: 'equals',
              value: 'BiteBanana',
            },
          ],
        },
        directives,
        spans,
        testActivityTypes,
        testDefaultArgumentsMap,
      ),
    ).to.deep.eq({
      directives: [directives[1], directives[3]],
      spans: [spans[3], spans[5]],
    });

    expect(
      applyActivityLayerFilter(
        {
          dynamic_type_filters: [
            {
              field: 'Subsystem',
              id: 1,
              operator: 'equals',
              value: 1,
            },
          ],
        },
        directives,
        spans,
        testActivityTypes,
        testDefaultArgumentsMap,
      ),
    ).to.deep.eq({
      directives: [directives[0]],
      spans: [spans[1]],
    });
  });

  test('Should apply other filters', () => {
    expect(
      applyActivityLayerFilter(
        {
          other_filters: [
            {
              field: 'Name',
              id: 1,
              operator: 'includes',
              value: 'oo',
            },
          ],
        },
        directives,
        spans,
        testActivityTypes,
        testDefaultArgumentsMap,
      ),
    ).to.deep.eq({
      directives: [directives[0]],
      spans: [],
    });

    expect(
      applyActivityLayerFilter(
        {
          other_filters: [
            {
              field: 'Parameter',
              id: 1,
              operator: 'equals',
              subfield: { name: 'newFlag', type: 'variant' },
              value: 'A',
            },
          ],
        },
        directives,
        spans,
        testActivityTypes,
        testDefaultArgumentsMap,
      ),
    ).to.deep.eq({
      directives: [directives[1]],
      spans: [spans[3]],
    });

    expect(
      applyActivityLayerFilter(
        {
          other_filters: [
            {
              field: 'SchedulingGoalId',
              id: 1,
              operator: 'equals',
              value: 1,
            },
          ],
        },
        directives,
        spans,
        testActivityTypes,
        testDefaultArgumentsMap,
      ),
    ).to.deep.eq({
      directives: [directives[0]],
      spans: [],
    });

    expect(
      applyActivityLayerFilter(
        {
          other_filters: [
            {
              field: 'Tags',
              id: 1,
              operator: 'includes',
              value: [1],
            },
          ],
        },
        directives,
        spans,
        testActivityTypes,
        testDefaultArgumentsMap,
      ),
    ).to.deep.eq({
      directives: [directives[2]],
      spans: [],
    });
  });
});

test('getMatchingTypesForActivityLayerFilter', () => {
  expect(getMatchingTypesForActivityLayerFilter({}, [])).to.deep.eq([]);
  expect(getMatchingTypesForActivityLayerFilter({}, testActivityTypes)).to.deep.eq(testActivityTypes);
  expect(
    getMatchingTypesForActivityLayerFilter({ static_types: ['parent', 'BiteBanana'] }, testActivityTypes),
  ).to.deep.eq([
    testActivityTypes.find(t => t.name === 'parent'),
    testActivityTypes.find(t => t.name === 'BiteBanana'),
  ]);
  expect(getMatchingTypesForActivityLayerFilter({ static_types: ['Foo'] }, testActivityTypes)).to.deep.eq([]);
  expect(
    getMatchingTypesForActivityLayerFilter(
      {
        dynamic_type_filters: [
          {
            field: 'Type',
            id: 1,
            operator: 'includes',
            value: 'banana',
          },
        ],
      },
      testActivityTypes,
    ),
  ).to.deep.eq(testActivityTypes.filter(t => t.name.toLowerCase().indexOf('banana') > -1));
});

test('matchesDynamicFilter', () => {
  expect(matchesDynamicFilter('Foo', 'equals', 'Foo')).toBeTruthy();
  expect(matchesDynamicFilter('Foo', 'does_not_equal', 'Bar')).toBeTruthy();
  expect(matchesDynamicFilter('Foo', 'includes', '')).toBeFalsy();
  expect(matchesDynamicFilter('Foo', 'includes', 'oo')).toBeTruthy();
  expect(matchesDynamicFilter([], 'includes', [1])).toBeFalsy();
  expect(matchesDynamicFilter([1, 2, 3], 'includes', [1])).toBeTruthy();
  expect(matchesDynamicFilter('Foo', 'does_not_include', '')).toBeTruthy();
  expect(matchesDynamicFilter('Foo', 'does_not_include', 'oo')).toBeFalsy();
  expect(matchesDynamicFilter([], 'does_not_include', [1])).toBeTruthy();
  expect(matchesDynamicFilter([1, 2, 3], 'does_not_include', [1])).toBeFalsy();
  expect(matchesDynamicFilter(2, 'is_greater_than', 1)).toBeTruthy();
  expect(matchesDynamicFilter('2', 'is_greater_than', '1')).toBeTruthy();
  expect(matchesDynamicFilter(2, 'is_less_than', 1)).toBeFalsy();
  expect(matchesDynamicFilter('2', 'is_less_than', '1')).toBeFalsy();
  expect(matchesDynamicFilter(2, 'is_within', [1, 3])).toBeTruthy();
  expect(matchesDynamicFilter(2, 'is_not_within', [1, 3])).toBeFalsy();
  // @ts-expect-error forcing the case where an invalid operator is specified
  expect(matchesDynamicFilter(2, 'is_definitely_somewhere_near', [1, 3])).toBeFalsy();
});

describe('Timeline sections', () => {
  /** Root order: row r0, section [r1, r2], row r3. */
  function buildSectionedTimeline() {
    const timeline = createTimeline([]);
    const r0 = createRow([timeline]);
    timeline.rows.push(r0);
    const r1 = createRow([timeline]);
    timeline.rows.push(r1);
    const r2 = createRow([timeline]);
    timeline.rows.push(r2);
    const r3 = createRow([timeline]);
    timeline.rows.push(r3);

    const section = createSection([timeline], { rowIds: [r1.id, r2.id] });
    timeline.sections.push(section);

    timeline.items = [
      { id: r0.id, type: 'row' },
      { id: section.id, type: 'section' },
      { id: r3.id, type: 'row' },
    ];

    return { r0, r1, r2, r3, section, timeline };
  }

  test('getNextSectionID returns max + 1 across all timelines', () => {
    const a = createTimeline([]);
    const b = createTimeline([a]);
    expect(getNextSectionID([a, b])).toBe(0);

    a.sections.push(createSection([a], { id: 0 }));
    b.sections.push(createSection([a, b], { id: 5 }));
    expect(getNextSectionID([a, b])).toBe(6);
  });

  test('createSection returns sensible defaults and a unique id', () => {
    const timeline = createTimeline([]);
    const section = createSection([timeline]);
    expect(section).toMatchObject({
      collapsed: false,
      color: ViewDefaultSectionColor,
      id: 0,
      name: 'Section',
      rowIds: [],
    });

    timeline.sections.push(section);
    const next = createSection([timeline]);
    expect(next.id).toBe(1);
  });

  test('getRowSection finds the owning section, or null for root rows', () => {
    const { r0, r1, section, timeline } = buildSectionedTimeline();
    expect(getRowSection(timeline, r1.id)).toBe(section);
    expect(getRowSection(timeline, r0.id)).toBeNull();
    expect(getRowSection(timeline, 999)).toBeNull();
  });

  test('createSection defaults to a real color so every section renders the same way', () => {
    expect(createSection([createTimeline([])]).color).toBe(ViewDefaultSectionColor);
  });

  test('getContrastingTextColor picks the foreground that actually scores higher', () => {
    // Dark bands take light text, light bands take dark text.
    expect(getContrastingTextColor('#000000')).toBe('#ffffff');
    expect(getContrastingTextColor('#ffffff')).toBe('#1b1d1f');

    // The presets are pale, so they all resolve to dark text.
    expect(getContrastingTextColor('#fcdd8f')).toBe('#1b1d1f');
    expect(getContrastingTextColor('#A3A3A3')).toBe('#1b1d1f');

    // Mid-tone blue is the case a naive lightness threshold gets wrong.
    expect(getContrastingTextColor('#0000ff')).toBe('#ffffff');
  });

  test('getContrastingTextColor clears WCAG AA for every built-in preset', () => {
    ViewDiscreteLayerColorPresets.forEach(color => {
      expect(getContrastRatio(color, getContrastingTextColor(color))).toBeGreaterThanOrEqual(4.5);
    });
  });

  test('getContrastingTextColor returns the best available foreground even when neither hits AA', () => {
    // #ff0000 scores 4.23 against near-black and 4.00 against white, so nothing reaches AA. A
    // band in such a color cannot carry AA text at all; the helper returns the better of the two.
    const best = getContrastRatio('#ff0000', getContrastingTextColor('#ff0000'));
    expect(best).toBeCloseTo(4.23, 1);
    expect(best).toBeGreaterThanOrEqual(getContrastRatio('#ff0000', '#ffffff'));
    expect(best).toBeGreaterThanOrEqual(3);
  });

  test('getContrastingTextColor tolerates short hex and a missing hash', () => {
    expect(getContrastingTextColor('#000')).toBe('#ffffff');
    expect(getContrastingTextColor('fff')).toBe('#1b1d1f');
  });

  test('getContrastRatio spans 1 to 21', () => {
    expect(getContrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1);
    expect(getContrastRatio('#7a7a7a', '#7a7a7a')).toBeCloseTo(1, 5);
  });

  test('duplicateSection copies the section, its rows, and its styling', () => {
    const { r1, r2, section, timeline } = buildSectionedTimeline();
    section.color = '#ff0000';
    section.collapsed = true;

    const result = duplicateSection(section, timeline, [timeline]);

    expect(result).not.toBeNull();
    expect(result?.section.name).toBe('Section (copy)');
    expect(result?.section.color).toBe('#ff0000');
    expect(result?.section.collapsed).toBe(true);
    expect(result?.section.id).not.toBe(section.id);

    // Both rows are copied, and the copy owns the new row ids rather than the originals.
    expect(result?.rows).toHaveLength(2);
    expect(result?.section.rowIds).toEqual(result?.rows.map(r => r.id));
    expect(result?.section.rowIds).not.toContain(r1.id);
    expect(result?.section.rowIds).not.toContain(r2.id);
  });

  test('duplicateSection gives every copied row a distinct id', () => {
    const { section, timeline } = buildSectionedTimeline();
    const result = duplicateSection(section, timeline, [timeline]);
    const ids = result?.rows.map(r => r.id) ?? [];

    // Regression guard: duplicating rows one at a time against the same timeline list
    // hands out the same id twice unless each copy is fed back into the working list.
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(undefined);
  });

  test('duplicateSection returns null when the timeline is not in the list', () => {
    const { section, timeline } = buildSectionedTimeline();
    expect(duplicateSection(section, timeline, [])).toBeNull();
  });

  test('duplicateSection copies an empty section', () => {
    const timeline = createTimeline([]);
    const section = createSection([timeline], { name: 'Empty' });
    timeline.sections.push(section);

    const result = duplicateSection(section, timeline, [timeline]);

    expect(result?.rows).toEqual([]);
    expect(result?.section.rowIds).toEqual([]);
    expect(result?.section.name).toBe('Empty (copy)');
  });

  test('removeRowFromTimelineHierarchy drops a root-level row from items', () => {
    const { r0, r1, r2, r3, section, timeline } = buildSectionedTimeline();
    const { items, sections } = removeRowFromTimelineHierarchy(timeline, r0.id);

    expect(items).toEqual([
      { id: section.id, type: 'section' },
      { id: r3.id, type: 'row' },
    ]);
    // A root-level removal must leave the sections untouched.
    expect(sections[0].rowIds).toEqual([r1.id, r2.id]);
  });

  test('removeRowFromTimelineHierarchy drops a grouped row from its section', () => {
    const { r0, r1, r2, r3, section, timeline } = buildSectionedTimeline();
    const { items, sections } = removeRowFromTimelineHierarchy(timeline, r1.id);

    expect(sections[0].rowIds).toEqual([r2.id]);
    expect(items).toEqual([
      { id: r0.id, type: 'row' },
      { id: section.id, type: 'section' },
      { id: r3.id, type: 'row' },
    ]);
  });

  test('removeRowFromTimelineHierarchy is a no-op for an unknown row', () => {
    const { timeline } = buildSectionedTimeline();
    const { items, sections } = removeRowFromTimelineHierarchy(timeline, 999);

    expect(items).toEqual(timeline.items);
    expect(sections).toEqual(timeline.sections);
  });

  test('insertRowAfterInTimelineHierarchy places a row next to a root-level neighbor', () => {
    const { r0, r1, r2, r3, section, timeline } = buildSectionedTimeline();
    const { items, sections } = insertRowAfterInTimelineHierarchy(timeline, r0.id, 42);

    expect(items).toEqual([
      { id: r0.id, type: 'row' },
      { id: 42, type: 'row' },
      { id: section.id, type: 'section' },
      { id: r3.id, type: 'row' },
    ]);
    expect(sections[0].rowIds).toEqual([r1.id, r2.id]);
  });

  test('insertRowAfterInTimelineHierarchy places a row inside its neighbor’s section', () => {
    const { r1, r2, timeline } = buildSectionedTimeline();
    const { items, sections } = insertRowAfterInTimelineHierarchy(timeline, r1.id, 42);

    // The new row joins the section rather than appearing at the root level.
    expect(sections[0].rowIds).toEqual([r1.id, 42, r2.id]);
    expect(items).toEqual(timeline.items);
  });

  test('insertRowAfterInTimelineHierarchy appends when the neighbor is not in the hierarchy', () => {
    const { r0, r3, section, timeline } = buildSectionedTimeline();
    const { items } = insertRowAfterInTimelineHierarchy(timeline, 999, 42);

    expect(items).toEqual([
      { id: r0.id, type: 'row' },
      { id: section.id, type: 'section' },
      { id: r3.id, type: 'row' },
      { id: 42, type: 'row' },
    ]);
  });
});

describe('resolveSectionDropEdge', () => {
  // A section header as the geometry helper sees it.
  const header = { bottom: 128, height: 28, top: 100 };

  test('a dragged section splits the header in half', () => {
    expect(resolveSectionDropEdge(header, 101, 'section')).toBe('top');
    expect(resolveSectionDropEdge(header, 113, 'section')).toBe('top');
    expect(resolveSectionDropEdge(header, 115, 'section')).toBe('bottom');
    expect(resolveSectionDropEdge(header, 127, 'section')).toBe('bottom');
  });

  test('a dragged row reorders only from the top band', () => {
    // 28px header -> an 8px band (28/3 clamped to the 8px maximum).
    expect(resolveSectionDropEdge(header, 100, 'row')).toBe('top');
    expect(resolveSectionDropEdge(header, 107, 'row')).toBe('top');
    expect(resolveSectionDropEdge(header, 108, 'row')).toBeNull();
    expect(resolveSectionDropEdge(header, 120, 'row')).toBeNull();
  });

  test('a dragged row has no bottom band', () => {
    // Regression guard: a bottom band drew a line under the header, pointing at the slot before
    // the section's first row, then inserted the row after the whole section.
    expect(resolveSectionDropEdge(header, header.bottom - 1, 'row')).toBeNull();
    expect(resolveSectionDropEdge(header, header.bottom, 'row')).toBeNull();
  });

  test('the band is clamped so it stays usable at any header height', () => {
    // Too short for a proportional band: it floors at 4px rather than vanishing.
    const short = { bottom: 109, height: 9, top: 100 };
    expect(resolveSectionDropEdge(short, 103, 'row')).toBe('top');
    expect(resolveSectionDropEdge(short, 105, 'row')).toBeNull();

    // Tall enough that a third would swallow most of the header: it caps at 8px.
    const tall = { bottom: 200, height: 100, top: 100 };
    expect(resolveSectionDropEdge(tall, 107, 'row')).toBe('top');
    expect(resolveSectionDropEdge(tall, 109, 'row')).toBeNull();
  });
});

describe('toTimelineDropEdge', () => {
  test('passes through the two edges a timeline understands', () => {
    expect(toTimelineDropEdge('top')).toBe('top');
    expect(toTimelineDropEdge('bottom')).toBe('bottom');
  });

  test('rejects everything else', () => {
    // The hitbox helper is typed for all four sides even when only two are requested.
    expect(toTimelineDropEdge('left')).toBeNull();
    expect(toTimelineDropEdge('right')).toBeNull();
    expect(toTimelineDropEdge(null)).toBeNull();
    expect(toTimelineDropEdge(undefined)).toBeNull();
  });
});

describe('applyTimelineItemDrop', () => {
  /**
   * A hierarchy of: row 10, section 100 [rows 11, 12], row 13, section 200 [row 14].
   * Ids are spread apart so a mix-up between a row id and a section id cannot pass by accident.
   */
  function buildHierarchy() {
    return {
      items: [
        { id: 10, type: 'row' },
        { id: 100, type: 'section' },
        { id: 13, type: 'row' },
        { id: 200, type: 'section' },
      ] as Timeline['items'],
      sections: [
        { collapsed: false, color: null, id: 100, name: 'A', rowIds: [11, 12] },
        { collapsed: false, color: null, id: 200, name: 'B', rowIds: [14] },
      ] as Timeline['sections'],
    };
  }

  const row = (id: number, sourceSectionId: number | null = null) =>
    ({ itemId: id, itemType: 'row', sourceSectionId }) as const;
  const section = (id: number) => ({ itemId: id, itemType: 'section', sourceSectionId: null }) as const;
  const atRow = (id: number, sectionId: number | null = null) => ({ itemId: id, itemType: 'row', sectionId }) as const;
  const atSection = (id: number) => ({ itemId: id, itemType: 'section', sectionId: null }) as const;

  test('reorders a root row above and below another root row', () => {
    const above = applyTimelineItemDrop(buildHierarchy(), { edge: 'top', source: row(13), target: atRow(10) });
    expect(above?.items).toEqual([
      { id: 13, type: 'row' },
      { id: 10, type: 'row' },
      { id: 100, type: 'section' },
      { id: 200, type: 'section' },
    ]);

    const below = applyTimelineItemDrop(buildHierarchy(), { edge: 'bottom', source: row(10), target: atRow(13) });
    expect(below?.items).toEqual([
      { id: 100, type: 'section' },
      { id: 13, type: 'row' },
      { id: 10, type: 'row' },
      { id: 200, type: 'section' },
    ]);
  });

  test('drops a root row into a section, appended to its rows', () => {
    const next = applyTimelineItemDrop(buildHierarchy(), { edge: null, source: row(10), target: atSection(100) });

    expect(next?.sections[0].rowIds).toEqual([11, 12, 10]);
    // The row leaves the root level rather than being listed in both places.
    expect(next?.items).toEqual([
      { id: 100, type: 'section' },
      { id: 13, type: 'row' },
      { id: 200, type: 'section' },
    ]);
  });

  test('drops a row into an empty section', () => {
    const hierarchy = buildHierarchy();
    hierarchy.sections[1].rowIds = [];

    const next = applyTimelineItemDrop(hierarchy, { edge: null, source: row(10), target: atSection(200) });

    expect(next?.sections[1].rowIds).toEqual([10]);
  });

  test('moves a row out of a section back to the root level', () => {
    const next = applyTimelineItemDrop(buildHierarchy(), {
      edge: 'top',
      source: row(11, 100),
      target: atRow(10),
    });

    expect(next?.sections[0].rowIds).toEqual([12]);
    expect(next?.items).toEqual([
      { id: 11, type: 'row' },
      { id: 10, type: 'row' },
      { id: 100, type: 'section' },
      { id: 13, type: 'row' },
      { id: 200, type: 'section' },
    ]);
  });

  test('moves a row from one section to another', () => {
    const next = applyTimelineItemDrop(buildHierarchy(), {
      edge: 'bottom',
      source: row(11, 100),
      target: atRow(14, 200),
    });

    expect(next?.sections[0].rowIds).toEqual([12]);
    expect(next?.sections[1].rowIds).toEqual([14, 11]);
    // A move between sections never touches the root ordering.
    expect(next?.items).toEqual(buildHierarchy().items);
  });

  test('reorders rows within one section', () => {
    const next = applyTimelineItemDrop(buildHierarchy(), {
      edge: 'top',
      source: row(12, 100),
      target: atRow(11, 100),
    });

    expect(next?.sections[0].rowIds).toEqual([12, 11]);
  });

  test('reorders a section against another section', () => {
    const next = applyTimelineItemDrop(buildHierarchy(), {
      edge: 'top',
      source: section(200),
      target: atSection(100),
    });

    expect(next?.items).toEqual([
      { id: 10, type: 'row' },
      { id: 200, type: 'section' },
      { id: 100, type: 'section' },
      { id: 13, type: 'row' },
    ]);
    // Reordering a section carries its rows with it - they are addressed by the section, not by items.
    expect(next?.sections[1].rowIds).toEqual([14]);
  });

  test('appends rather than inserting next-to-last when the target is gone', () => {
    // Regression guard: findIndex returning -1 used to fall through to splice(-1, 0, …), which
    // silently drops the item one place from the end instead of at it.
    const next = applyTimelineItemDrop(buildHierarchy(), { edge: 'bottom', source: row(10), target: atRow(999) });

    expect(next?.items).toEqual([
      { id: 100, type: 'section' },
      { id: 13, type: 'row' },
      { id: 200, type: 'section' },
      { id: 10, type: 'row' },
    ]);
  });

  test('appends to the target section when the neighbouring row is gone', () => {
    const next = applyTimelineItemDrop(buildHierarchy(), {
      edge: 'bottom',
      source: row(10),
      target: atRow(999, 200),
    });

    expect(next?.sections[1].rowIds).toEqual([14, 10]);
  });

  test('is a no-op when an item is dropped on itself', () => {
    expect(applyTimelineItemDrop(buildHierarchy(), { edge: 'top', source: row(10), target: atRow(10) })).toBeNull();
    expect(
      applyTimelineItemDrop(buildHierarchy(), { edge: 'bottom', source: section(100), target: atSection(100) }),
    ).toBeNull();
  });

  test('is a no-op when a row is dropped onto the section it already belongs to', () => {
    expect(
      applyTimelineItemDrop(buildHierarchy(), { edge: null, source: row(11, 100), target: atSection(100) }),
    ).toBeNull();
  });

  test('a row already in a section can still leave it by an edge of its own header', () => {
    // The no-op above must not swallow this: the same row and the same section header, but aimed
    // at the reorder band rather than at the section itself.
    const next = applyTimelineItemDrop(buildHierarchy(), {
      edge: 'top',
      source: row(11, 100),
      target: atSection(100),
    });

    expect(next?.sections[0].rowIds).toEqual([12]);
    expect(next?.items).toEqual([
      { id: 10, type: 'row' },
      { id: 11, type: 'row' },
      { id: 100, type: 'section' },
      { id: 13, type: 'row' },
      { id: 200, type: 'section' },
    ]);
  });

  test('refuses to nest a section inside a section', () => {
    expect(
      applyTimelineItemDrop(buildHierarchy(), { edge: 'bottom', source: section(200), target: atRow(11, 100) }),
    ).toBeNull();
  });

  test('a section dropped on a root row still reorders', () => {
    const next = applyTimelineItemDrop(buildHierarchy(), { edge: 'top', source: section(200), target: atRow(10) });

    expect(next?.items).toEqual([
      { id: 200, type: 'section' },
      { id: 10, type: 'row' },
      { id: 100, type: 'section' },
      { id: 13, type: 'row' },
    ]);
  });

  test('never mutates the hierarchy it was given', () => {
    const hierarchy = buildHierarchy();
    const itemsBefore = JSON.stringify(hierarchy.items);
    const sectionsBefore = JSON.stringify(hierarchy.sections);

    applyTimelineItemDrop(hierarchy, { edge: null, source: row(11, 100), target: atSection(200) });

    expect(JSON.stringify(hierarchy.items)).toBe(itemsBefore);
    expect(JSON.stringify(hierarchy.sections)).toBe(sectionsBefore);
  });

  test('tolerates a timeline with no items or sections yet', () => {
    const next = applyTimelineItemDrop(
      { items: [], sections: [] },
      {
        edge: 'top',
        source: row(10),
        target: atRow(999),
      },
    );

    expect(next).toEqual({ items: [{ id: 10, type: 'row' }], sections: [] });
  });
});

describe('moveTimelineItemInHierarchy', () => {
  /** Root order: row 10, section 100 [rows 11, 12, 13], section 200 [row 14]. */
  function buildHierarchy() {
    return {
      items: [
        { id: 10, type: 'row' },
        { id: 100, type: 'section' },
        { id: 200, type: 'section' },
      ] as Timeline['items'],
      sections: [
        { collapsed: false, color: null, id: 100, name: 'A', rowIds: [11, 12, 13] },
        { collapsed: false, color: null, id: 200, name: 'B', rowIds: [14] },
      ] as Timeline['sections'],
    };
  }

  test('moves a root row past its neighbour', () => {
    const next = moveTimelineItemInHierarchy(buildHierarchy(), 'row', 10, 'down');

    expect(next?.items).toEqual([
      { id: 100, type: 'section' },
      { id: 10, type: 'row' },
      { id: 200, type: 'section' },
    ]);
  });

  test('moves a section past its neighbour in both directions', () => {
    expect(moveTimelineItemInHierarchy(buildHierarchy(), 'section', 200, 'up')?.items).toEqual([
      { id: 10, type: 'row' },
      { id: 200, type: 'section' },
      { id: 100, type: 'section' },
    ]);
    expect(moveTimelineItemInHierarchy(buildHierarchy(), 'section', 100, 'up')?.items).toEqual([
      { id: 100, type: 'section' },
      { id: 10, type: 'row' },
      { id: 200, type: 'section' },
    ]);
  });

  test('moves a grouped row within its own section', () => {
    const down = moveTimelineItemInHierarchy(buildHierarchy(), 'row', 11, 'down');
    expect(down?.sections[0].rowIds).toEqual([12, 11, 13]);
    // The root order is untouched by a move inside a section.
    expect(down?.items).toEqual(buildHierarchy().items);

    const up = moveTimelineItemInHierarchy(buildHierarchy(), 'row', 13, 'up');
    expect(up?.sections[0].rowIds).toEqual([11, 13, 12]);
  });

  test('a grouped row cannot step out of its section', () => {
    // The first and last rows of a section have nowhere left to go. Moving out is a drag, not a
    // one-step nudge, so these are refusals rather than escapes to the root level.
    expect(moveTimelineItemInHierarchy(buildHierarchy(), 'row', 11, 'up')).toBeNull();
    expect(moveTimelineItemInHierarchy(buildHierarchy(), 'row', 13, 'down')).toBeNull();
    expect(moveTimelineItemInHierarchy(buildHierarchy(), 'row', 14, 'up')).toBeNull();
  });

  test('refuses to move past either end of the root order', () => {
    expect(moveTimelineItemInHierarchy(buildHierarchy(), 'row', 10, 'up')).toBeNull();
    expect(moveTimelineItemInHierarchy(buildHierarchy(), 'section', 200, 'down')).toBeNull();
  });

  test('refuses to move something that is not there', () => {
    expect(moveTimelineItemInHierarchy(buildHierarchy(), 'row', 999, 'up')).toBeNull();
    expect(moveTimelineItemInHierarchy(buildHierarchy(), 'section', 999, 'down')).toBeNull();
  });

  test('does not confuse a row id with a section id', () => {
    // Ids are unique per kind, not across kinds, so a lookup that ignores the type can move the
    // wrong thing. Here a row and a section deliberately share the id 100.
    const hierarchy = buildHierarchy();
    hierarchy.items = [
      { id: 100, type: 'row' },
      { id: 100, type: 'section' },
    ];

    expect(moveTimelineItemInHierarchy(hierarchy, 'section', 100, 'up')?.items).toEqual([
      { id: 100, type: 'section' },
      { id: 100, type: 'row' },
    ]);
  });

  test('never mutates the hierarchy it was given', () => {
    const hierarchy = buildHierarchy();
    const before = JSON.stringify(hierarchy);

    moveTimelineItemInHierarchy(hierarchy, 'row', 11, 'down');
    moveTimelineItemInHierarchy(hierarchy, 'section', 100, 'down');

    expect(JSON.stringify(hierarchy)).toBe(before);
  });
});

describe('getRenderableTimelineItems', () => {
  function buildTimeline() {
    return {
      items: [
        { id: 10, type: 'row' },
        { id: 100, type: 'section' },
      ] as Timeline['items'],
      rows: [{ id: 10 }, { id: 11 }] as Timeline['rows'],
      sections: [{ collapsed: false, color: null, id: 100, name: 'A', rowIds: [11] }] as Timeline['sections'],
    };
  }

  test('passes a consistent hierarchy through untouched', () => {
    const timeline = buildTimeline();
    expect(getRenderableTimelineItems(timeline)).toEqual(timeline.items);
  });

  test('drops a ref to a section that no longer exists', () => {
    const timeline = buildTimeline();
    timeline.sections = [];

    expect(getRenderableTimelineItems(timeline)).toEqual([{ id: 10, type: 'row' }]);
  });

  test('drops a ref to a row that no longer exists', () => {
    const timeline = buildTimeline();
    timeline.rows = [{ id: 11 }] as Timeline['rows'];

    expect(getRenderableTimelineItems(timeline)).toEqual([{ id: 100, type: 'section' }]);
  });

  test('drops a duplicate ref, keeping the first', () => {
    // The crash this exists for: a ghost `section-0` left in items, plus a new section that
    // reuses id 0, is two entries keyed `section-0` - which throws out of the keyed each.
    const timeline = buildTimeline();
    timeline.items = [
      { id: 100, type: 'section' },
      { id: 10, type: 'row' },
      { id: 100, type: 'section' },
    ];

    expect(getRenderableTimelineItems(timeline)).toEqual([
      { id: 100, type: 'section' },
      { id: 10, type: 'row' },
    ]);
  });

  test('a row and a section may share an id without colliding', () => {
    // Ids are unique per kind, not across kinds, so the two refs are distinct items.
    const timeline = buildTimeline();
    timeline.items = [
      { id: 100, type: 'section' },
      { id: 100, type: 'row' },
    ];
    timeline.rows = [{ id: 100 }] as Timeline['rows'];

    expect(getRenderableTimelineItems(timeline)).toHaveLength(2);
  });

  test('drops a root ref to a row a section has also claimed', () => {
    const timeline = buildTimeline();
    timeline.items = [
      { id: 11, type: 'row' },
      { id: 100, type: 'section' },
    ];

    // Row 11 belongs to section 100; listing it at the root as well drew it twice.
    expect(getRenderableTimelineItems(timeline)).toEqual([{ id: 100, type: 'section' }]);
  });

  test('tolerates a timeline with nothing in it', () => {
    expect(getRenderableTimelineItems({ items: [], rows: [], sections: [] })).toEqual([]);
  });
});

describe('ungroupAllTimelineSections', () => {
  test('replaces each section with the rows it held, in place', () => {
    const next = ungroupAllTimelineSections({
      items: [
        { id: 10, type: 'row' },
        { id: 100, type: 'section' },
        { id: 13, type: 'row' },
        { id: 200, type: 'section' },
      ],
      sections: [
        { collapsed: false, color: null, id: 100, name: 'A', rowIds: [11, 12] },
        { collapsed: false, color: null, id: 200, name: 'B', rowIds: [14] },
      ],
    });

    // Regression guard: emptying `sections` alone left rows 11, 12 and 14 referenced by nothing,
    // so they vanished from the timeline while still sitting in `timeline.rows`.
    expect(next.items).toEqual([
      { id: 10, type: 'row' },
      { id: 11, type: 'row' },
      { id: 12, type: 'row' },
      { id: 13, type: 'row' },
      { id: 14, type: 'row' },
    ]);
    expect(next.sections).toEqual([]);
  });

  test('leaves no section refs behind for a reused id to collide with', () => {
    const next = ungroupAllTimelineSections({
      items: [{ id: 0, type: 'section' }],
      sections: [{ collapsed: false, color: null, id: 0, name: 'A', rowIds: [] }],
    });

    expect(next.items).toEqual([]);
  });

  test('is a no-op on a timeline with no sections', () => {
    const items = [{ id: 10, type: 'row' as const }];
    expect(ungroupAllTimelineSections({ items, sections: [] })).toEqual({ items, sections: [] });
  });
});

describe('clampOpacity', () => {
  test('leaves in-range values untouched', () => {
    expect(clampOpacity(0)).toEqual(0);
    expect(clampOpacity(0.35)).toEqual(0.35);
    expect(clampOpacity(1)).toEqual(1);
  });

  test('clamps out-of-range values into 0-1', () => {
    expect(clampOpacity(-2)).toEqual(0);
    expect(clampOpacity(4)).toEqual(1);
  });

  test('falls back for non-finite input, since canvas ignores a bad globalAlpha', () => {
    expect(clampOpacity(NaN)).toEqual(DEFAULT_LINE_OPACITY);
    expect(clampOpacity(Infinity)).toEqual(DEFAULT_LINE_OPACITY);
    expect(clampOpacity(undefined)).toEqual(DEFAULT_LINE_OPACITY);
    expect(clampOpacity(NaN, 0.5)).toEqual(0.5);
  });
});

describe('clampLineSize', () => {
  test('leaves valid sizes untouched', () => {
    expect(clampLineSize(0, 1)).toEqual(0);
    expect(clampLineSize(3.5, 1)).toEqual(3.5);
  });

  test('falls back for negative or non-finite sizes', () => {
    expect(clampLineSize(-1, 1)).toEqual(1);
    expect(clampLineSize(NaN, 1)).toEqual(1);
    expect(clampLineSize(undefined, 2)).toEqual(2);
  });
});

describe('getLineDashArray', () => {
  test('returns an empty pattern for solid lines', () => {
    expect(getLineDashArray('solid')).toEqual([]);
  });

  test('returns a pattern for dashed and dotted lines', () => {
    expect(getLineDashArray('dashed').length).toBeGreaterThan(0);
    expect(getLineDashArray('dotted').length).toBeGreaterThan(0);
    expect(getLineDashArray('dashed')).not.toEqual(getLineDashArray('dotted'));
  });

  test('falls back to solid for an unknown style so a stale pattern is not reused', () => {
    // @ts-expect-error forcing the case where a hand-edited view supplies an unknown style
    expect(getLineDashArray('squiggly')).toEqual([]);
    expect(getLineDashArray(undefined)).toEqual([]);
  });
});

describe('getLineCurve', () => {
  test('step and linear share a curve, since the staircase comes from the data', () => {
    expect(getLineCurve('step')).toBe(getLineCurve('linear'));
  });

  test('smooth uses a different curve than the other modes', () => {
    expect(getLineCurve('smooth')).not.toBe(getLineCurve('linear'));
  });

  test('falls back to the default curve for a missing or unknown mode', () => {
    expect(getLineCurve(undefined)).toBe(getLineCurve(DEFAULT_INTERPOLATION));
    // @ts-expect-error forcing the case where a hand-edited view supplies an unknown mode
    expect(getLineCurve('bezier')).toBe(getLineCurve(DEFAULT_INTERPOLATION));
  });
});

describe('getMarkerGlyphExtents', () => {
  test('line keeps its historical 2px of ink, centered on the moment it marks', () => {
    const { left, right, size } = getMarkerGlyphExtents('line', 16);
    expect(size).toEqual(2);
    expect(left).toEqual(right);
    expect(left + right).toEqual(size);
  });

  // A dot, a diamond and a line at the same x must share a center, or switching style visibly nudges
  // the mark sideways -- which is exactly what a left-anchored line used to do
  test('every style straddles the moment, so switching style never moves the mark', () => {
    for (const style of ['line', 'dot', 'diamond'] as const) {
      const { left, right } = getMarkerGlyphExtents(style, 16);
      expect(left).toEqual(right);
    }
  });

  test('an unknown or missing style falls back to line rather than to a point shape', () => {
    expect(getMarkerGlyphExtents(undefined, 16)).toEqual(getMarkerGlyphExtents('line', 16));
    // @ts-expect-error forcing the case where a hand-edited view supplies an unknown style
    expect(getMarkerGlyphExtents('star', 16)).toEqual(getMarkerGlyphExtents('line', 16));
  });

  test('point styles straddle the instant, so they do not read as arriving late', () => {
    for (const style of ['dot', 'diamond'] as const) {
      const { left, right, size } = getMarkerGlyphExtents(style, 16);
      expect(left + right).toEqual(size);
      expect(size).toBeGreaterThan(2);
    }
  });

  // Equal bounding boxes would not read as equal weight: a diamond fills half its box where a circle
  // fills about 0.785 of it, so matching their boxes makes the diamond look lighter
  test('a diamond is drawn larger than a dot, to carry the same visual weight', () => {
    const dot = getMarkerGlyphExtents('dot', 16);
    const diamond = getMarkerGlyphExtents('diamond', 16);
    expect(diamond.size).toBeGreaterThan(dot.size);
    // Areas within a few percent of each other: pi*(d/2)^2 for the circle, D^2/2 for the diamond
    const dotArea = Math.PI * (dot.size / 2) ** 2;
    const diamondArea = diamond.size ** 2 / 2;
    expect(Math.abs(diamondArea - dotArea) / dotArea).toBeLessThan(0.1);
  });

  test('point styles scale with the subrow height', () => {
    expect(getMarkerGlyphExtents('dot', 24).size).toBeGreaterThan(getMarkerGlyphExtents('dot', 16).size);
  });

  // Unclamped, a tall subrow gets a marker that collides with its neighbour and a short one gets a
  // marker too small to click.
  test('point styles stay within a usable size at extreme subrow heights', () => {
    expect(getMarkerGlyphExtents('dot', 1).size).toBeGreaterThanOrEqual(4);
    expect(getMarkerGlyphExtents('dot', 5000).size).toBeLessThanOrEqual(14);
  });

  test('never returns a fractional total width, which would blur the marker', () => {
    for (const height of [16, 17, 18, 21, 24, 33]) {
      expect(Number.isInteger(getMarkerGlyphExtents('dot', height).size)).toBe(true);
    }
  });
});

describe('stackLineLayerValues', () => {
  function series(layerId: number, values: [number, number | null][], interpolation: 'step' | 'linear' = 'step') {
    return {
      interpolation,
      layerId,
      resourceName: `r${layerId}`,
      values: values.map(([x, y]) => ({ x, y })),
    };
  }

  test('stacks in the order supplied, so the first series is the bottom', () => {
    const [bottom, top] = stackLineLayerValues([
      series(0, [
        [0, 1],
        [10, 1],
      ]),
      series(1, [
        [0, 2],
        [10, 2],
      ]),
    ]);
    expect(bottom.values.map(v => [v.y0, v.y])).toEqual([
      [0, 1],
      [0, 1],
    ]);
    expect(top.values.map(v => [v.y0, v.y])).toEqual([
      [1, 3],
      [1, 3],
    ]);
  });

  test('each layer fills between the total below it and the total through it, leaving no seams', () => {
    const stacked = stackLineLayerValues([
      series(0, [
        [0, 5],
        [10, 5],
      ]),
      series(1, [
        [0, 3],
        [10, 3],
      ]),
      series(2, [
        [0, 2],
        [10, 2],
      ]),
    ]);
    for (let i = 1; i < stacked.length; i++) {
      expect(stacked[i].values.map(v => v.y0)).toEqual(stacked[i - 1].values.map(v => v.y));
    }
    // Topmost series is the stack total
    expect(stacked[2].values[0].y).toEqual(10);
  });

  // The union grid is what makes this exact. On any other spacing the sum of two piecewise-linear
  // series is only an approximation of the true sum.
  test('resamples onto the union of every x, and sums linear series exactly there', () => {
    const [, top] = stackLineLayerValues([
      series(
        0,
        [
          [0, 0],
          [10, 10],
        ],
        'linear',
      ),
      series(
        1,
        [
          [0, 100],
          [4, 100],
          [10, 100],
        ],
        'linear',
      ),
    ]);
    expect(top.values.map(v => v.x)).toEqual([0, 4, 10]);
    // Bottom series ramps 0->10 over 0..10, so it is exactly 4 at x=4
    expect(top.values[1].y).toEqual(104);
  });

  test('a step series holds its value across another series x values', () => {
    const [bottom] = stackLineLayerValues([
      series(0, [
        [0, 7],
        [10, 7],
      ]),
      series(1, [
        [0, 0],
        [5, 0],
        [10, 0],
      ]),
    ]);
    expect(bottom.values.map(v => [v.x, v.y])).toEqual([
      [0, 7],
      [5, 7],
      [10, 7],
    ]);
  });

  // A discrete segment boundary has two values at the same x. Taking the incoming segment's value is
  // what matches the drawn staircase; taking the outgoing one would lag the stack by a segment.
  test('at a shared x a step series takes the incoming segment value', () => {
    const [bottom] = stackLineLayerValues([
      series(0, [
        [0, 1],
        [5, 1],
        [5, 9],
        [10, 9],
      ]),
    ]);
    expect(bottom.values.find(v => v.x === 5)?.y).toEqual(9);
  });

  test('a gap low in the stack makes every total above it unknown, rather than closing up', () => {
    const [bottom, top] = stackLineLayerValues([
      series(0, [
        [0, 1],
        [5, null],
        [10, 1],
      ]),
      series(1, [
        [0, 4],
        [5, 4],
        [10, 4],
      ]),
    ]);
    expect(bottom.values.find(v => v.x === 5)?.y).toBeNull();
    expect(top.values.find(v => v.x === 5)?.y).toBeNull();
    // and recovers once the lower series is defined again
    expect(top.values.find(v => v.x === 10)?.y).toEqual(5);
  });

  test('a gap high in the stack leaves the totals below it intact', () => {
    const [bottom, top] = stackLineLayerValues([
      series(0, [
        [0, 1],
        [5, 1],
        [10, 1],
      ]),
      series(1, [
        [0, 4],
        [5, null],
        [10, 4],
      ]),
    ]);
    expect(bottom.values.every(v => v.y === 1)).toBe(true);
    expect(top.values.find(v => v.x === 5)?.y).toBeNull();
  });

  test('is undefined outside a series own time range rather than extrapolating', () => {
    const [, top] = stackLineLayerValues([
      series(0, [
        [5, 1],
        [8, 1],
      ]),
      series(1, [
        [0, 2],
        [10, 2],
      ]),
    ]);
    expect(top.values.find(v => v.x === 0)?.y).toBeNull();
    expect(top.values.find(v => v.x === 10)?.y).toBeNull();
    expect(top.values.find(v => v.x === 5)?.y).toEqual(3);
  });

  test('negative values reduce the running total so the top reads as the net sum', () => {
    const [, top] = stackLineLayerValues([
      series(0, [
        [0, 10],
        [10, 10],
      ]),
      series(1, [
        [0, -4],
        [10, -4],
      ]),
    ]);
    expect(top.values[0].y).toEqual(6);
  });

  test('drops hold values for an interpolating series before summing', () => {
    // Same data, read two ways: as a staircase it is 1 until x=5, as a ramp it is 3 at x=5
    const stepped = stackLineLayerValues([
      series(0, [
        [0, 1],
        [5, 1],
        [5, 5],
        [10, 5],
      ]),
    ]);
    const ramped = stackLineLayerValues([
      series(
        0,
        [
          [0, 1],
          [5, 1],
          [5, 5],
          [10, 5],
        ],
        'linear',
      ),
    ]);
    expect(stepped[0].values.find(v => v.x === 0)?.y).toEqual(1);
    expect(ramped[0].values.find(v => v.x === 0)?.y).toEqual(1);
    // The staircase holds 1 right up to the boundary; the ramp is already climbing before it
    const steppedMid = stepped[0].values.filter(v => v.x > 0 && v.x < 5).every(v => v.y === 1);
    expect(steppedMid).toBe(true);
    expect(ramped[0].values.find(v => v.x === 10)?.y).toEqual(5);
  });

  test('a single series stacks to itself, so enabling stacking on one layer changes nothing', () => {
    const values: [number, number][] = [
      [0, 3],
      [5, 7],
      [10, 2],
    ];
    const [only] = stackLineLayerValues([series(0, values)]);
    expect(only.values.map(v => v.y)).toEqual([3, 7, 2]);
    expect(only.values.every(v => v.y0 === 0)).toBe(true);
  });

  test('returns an empty list for no series and empty values for an empty series', () => {
    expect(stackLineLayerValues([])).toEqual([]);
    expect(stackLineLayerValues([series(0, [])])[0].values).toEqual([]);
  });

  test('every series shares the same grid, which is what keeps y0 index-aligned to y', () => {
    const stacked = stackLineLayerValues([
      series(0, [
        [0, 1],
        [3, 1],
      ]),
      series(1, [
        [1, 1],
        [4, 1],
      ]),
      series(2, [
        [2, 1],
        [5, 1],
      ]),
    ]);
    const grid = stacked[0].values.map(v => v.x);
    expect(grid).toEqual([0, 1, 2, 3, 4, 5]);
    for (const s of stacked) {
      expect(s.values.map(v => v.x)).toEqual(grid);
    }
  });
});

describe('getYAxisBounds with a stacked axis', () => {
  const resource: Resource = {
    name: 'r',
    schema: { type: 'real' },
    values: [
      { x: 0, y: 200 },
      { x: 10, y: 230 },
    ],
  };
  const layer = { chartType: 'line', filter: { resource: 'r' }, id: 1, name: '', yAxisId: 7 } as any;
  const stacks = {
    1: {
      baseline: [0, 0],
      resource: {
        ...resource,
        values: [
          { x: 0, y: 200 },
          { x: 10, y: 230 },
        ],
      },
    },
  };

  test('measures a stacked layer by its cumulative series, not its own values', () => {
    const axis = { domainFitMode: 'fitPlan', id: 7, stack: true } as any;
    const bounds = getYAxisBounds(axis, [layer], [resource], undefined, {
      1: {
        baseline: [0, 0],
        resource: {
          ...resource,
          values: [
            { x: 0, y: 999 },
            { x: 10, y: 999 },
          ],
        },
      },
    });
    expect(bounds[1]).toEqual(999);
  });

  // A stacked band covering 95% of the total renders as a sliver of it if the baseline is off-axis
  test('pulls zero into the domain so the bands encode proportion', () => {
    const axis = { domainFitMode: 'fitPlan', id: 7, stack: true } as any;
    expect(getYAxisBounds(axis, [layer], [resource], undefined, stacks)).toEqual([0, 230]);
  });

  test('leaves a manual domain alone, since that is the operator overriding the fit', () => {
    const axis = { domainFitMode: 'manual', id: 7, scaleDomain: [200, 230], stack: true } as any;
    expect(getYAxisBounds(axis, [layer], [resource], undefined, stacks)).toEqual([200, 230]);
  });

  test('keeps zero as the upper bound when a stack total is negative', () => {
    const axis = { domainFitMode: 'fitPlan', id: 7, stack: true } as any;
    const negative = {
      1: {
        baseline: [0, 0],
        resource: {
          ...resource,
          values: [
            { x: 0, y: -5 },
            { x: 10, y: -20 },
          ],
        },
      },
    };
    expect(getYAxisBounds(axis, [layer], [resource], undefined, negative)).toEqual([-20, 0]);
  });

  test('does not pull zero in for an unstacked axis', () => {
    const axis = { domainFitMode: 'fitPlan', id: 7 } as any;
    expect(getYAxisBounds(axis, [layer], [resource])).toEqual([200, 230]);
  });
});

describe('clampGuideBand', () => {
  const SIZE = 100;

  /** Everything but the anchor, which order deliberately does change. */
  const geometry = (band: ReturnType<typeof clampGuideBand>) => {
    const { anchorAtStart, ...rest } = band ?? {};
    void anchorAtStart;
    return rest;
  };

  test('normalizes edge order, so a region dragged backwards is not empty', () => {
    expect(geometry(clampGuideBand(70, 20, SIZE))).toEqual(geometry(clampGuideBand(20, 70, SIZE)));
    expect(clampGuideBand(70, 20, SIZE)).toEqual({
      anchorAtStart: false,
      end: 70,
      showEndEdge: true,
      showStartEdge: true,
      start: 20,
    });
  });

  // The one thing normalizing the order destroys, and the render needs it: the solid edge marks the
  // guide's own value, so a band typed backwards has to come back solid on the right.
  test('reports which edge the first argument ended up on', () => {
    expect(clampGuideBand(20, 70, SIZE)?.anchorAtStart).toBe(true);
    expect(clampGuideBand(70, 20, SIZE)?.anchorAtStart).toBe(false);
    // Equal bounds are one edge, so calling it the start keeps a solid line rather than a dashed one
    expect(clampGuideBand(50, 50, SIZE)?.anchorAtStart).toBe(true);
  });

  // Clamping must not move the anchor: the guide's value is still the one it always was, even with that
  // edge scrolled out of view
  test('keeps the anchor edge through clamping', () => {
    expect(clampGuideBand(-50, 40, SIZE)?.anchorAtStart).toBe(true);
    expect(clampGuideBand(40, -50, SIZE)?.anchorAtStart).toBe(false);
  });

  test('clamps to the drawable extent and reports the clamped edge as not shown', () => {
    expect(geometry(clampGuideBand(-50, 40, SIZE))).toEqual({
      end: 40,
      showEndEdge: true,
      showStartEdge: false,
      start: 0,
    });
    expect(geometry(clampGuideBand(60, 500, SIZE))).toEqual({
      end: SIZE,
      showEndEdge: false,
      showStartEdge: true,
      start: 60,
    });
  });

  test('reports neither edge when the band engulfs the whole extent', () => {
    expect(geometry(clampGuideBand(-100, 500, SIZE))).toEqual({
      end: SIZE,
      showEndEdge: false,
      showStartEdge: false,
      start: 0,
    });
  });

  test('returns null when the band is entirely outside the extent', () => {
    expect(clampGuideBand(-200, -100, SIZE)).toBeNull();
    expect(clampGuideBand(200, 300, SIZE)).toBeNull();
  });

  test('returns null for non-finite edges rather than a NaN geometry', () => {
    expect(clampGuideBand(NaN, 40, SIZE)).toBeNull();
    expect(clampGuideBand(40, Infinity, SIZE)).toBeNull();
  });

  test('keeps a zero-width band, so equal bounds stay visible as a line', () => {
    expect(geometry(clampGuideBand(50, 50, SIZE))).toEqual({
      end: 50,
      showEndEdge: true,
      showStartEdge: true,
      start: 50,
    });
  });

  test('keeps a band flush against either boundary', () => {
    expect(clampGuideBand(0, 10, SIZE)?.showStartEdge).toBe(true);
    expect(clampGuideBand(90, SIZE, SIZE)?.showEndEdge).toBe(true);
  });
});

describe('getHorizontalGuideBand', () => {
  const DRAW_HEIGHT = 100;
  // Domain 0-100 over a 100px row, so a value maps to (100 - value) in pixels
  const scale = getYScale([0, 100], DRAW_HEIGHT) as ReturnType<typeof getYScale>;

  test('returns null for a single-value guide, which stays a line', () => {
    expect(getHorizontalGuideBand(50, undefined, scale, DRAW_HEIGHT)).toBeNull();
  });

  test('spans between the two values', () => {
    const band = getHorizontalGuideBand(40, 80, scale, DRAW_HEIGHT);
    expect(band).not.toBeNull();
    expect(band?.height).toBeGreaterThan(0);
  });

  // An operator typing the bounds of a nominal range should not have to know which box is which
  test('has the same geometry whichever order the two values are given in', () => {
    const forward = getHorizontalGuideBand(40, 80, scale, DRAW_HEIGHT);
    const reversed = getHorizontalGuideBand(80, 40, scale, DRAW_HEIGHT);
    expect(forward?.y).toEqual(reversed?.y);
    expect(forward?.height).toEqual(reversed?.height);
  });

  // A y scale runs the opposite way from the values it maps, so the guide's own value is the *upper*
  // edge only when it is the larger of the two. Pin it: getting this backwards would draw the solid
  // edge at y2 and contradict the editor row, which shows y.
  test('puts the anchor at the upper edge only when the guide value is the larger', () => {
    expect(getHorizontalGuideBand(80, 40, scale, DRAW_HEIGHT)?.anchorAtStart).toBe(true);
    expect(getHorizontalGuideBand(40, 80, scale, DRAW_HEIGHT)?.anchorAtStart).toBe(false);
  });

  test('clamps to the row so a half-off-scale band still shades the part that is on scale', () => {
    const band = getHorizontalGuideBand(50, 5000, scale, DRAW_HEIGHT);
    expect(band).not.toBeNull();
    expect(band!.y).toBeGreaterThanOrEqual(0);
    expect(band!.y + band!.height).toBeLessThanOrEqual(DRAW_HEIGHT);
  });

  test('returns null when the band is entirely off scale, rather than a zero-height rect', () => {
    expect(getHorizontalGuideBand(5000, 6000, scale, DRAW_HEIGHT)).toBeNull();
    expect(getHorizontalGuideBand(-6000, -5000, scale, DRAW_HEIGHT)).toBeNull();
  });

  test('returns null for non-finite bounds rather than painting a NaN rect', () => {
    expect(getHorizontalGuideBand(NaN, 50, scale, DRAW_HEIGHT)).toBeNull();
    expect(getHorizontalGuideBand(50, NaN, scale, DRAW_HEIGHT)).toBeNull();
    expect(getHorizontalGuideBand(50, Infinity, scale, DRAW_HEIGHT)).toBeNull();
  });

  test('works on a log axis, where zero and negatives still have a position', () => {
    const logScale = getYScale([-100, 100], DRAW_HEIGHT, 'log', 1);
    const band = getHorizontalGuideBand(-10, 10, logScale, DRAW_HEIGHT);
    expect(band).not.toBeNull();
    expect(band!.height).toBeGreaterThan(0);
  });

  test('a zero-width band still produces a rect, so equal bounds do not silently vanish', () => {
    const band = getHorizontalGuideBand(50, 50, scale, DRAW_HEIGHT);
    expect(band).not.toBeNull();
    expect(band!.height).toEqual(0);
  });
});

describe('isDroppableHoldPoint', () => {
  const holdA = { is_hold: true, x: 20, y: 1 };
  const holdB = { is_hold: true, x: 40, y: 2 };
  const values: ResourceValue[] = [{ x: 10, y: 1 }, holdA, { x: 20, y: 2 }, holdB];

  test('drops a hold value that is not the last', () => {
    expect(isDroppableHoldPoint(values, 1)).toBe(true);
  });

  test('keeps values that are not holds', () => {
    expect(isDroppableHoldPoint(values, 0)).toBe(false);
    expect(isDroppableHoldPoint(values, 2)).toBe(false);
  });

  // Without this the plotted line would stop at the last segment's start rather than the profile's
  // end, visibly truncating every interpolated layer by one segment.
  test('keeps the final value even when it is a hold', () => {
    expect(isDroppableHoldPoint(values, 3)).toBe(false);
  });

  test('keeps a lone hold value, which is also a profile end', () => {
    expect(isDroppableHoldPoint([holdA], 0)).toBe(false);
  });

  test('is false out of range rather than throwing', () => {
    expect(isDroppableHoldPoint(values, 99)).toBe(false);
    expect(isDroppableHoldPoint([], 0)).toBe(false);
  });
});

describe('getPointSpriteSize', () => {
  test('leaves room around the point so taller shapes are not clipped', () => {
    expect(getPointSpriteSize(2)).toBeGreaterThan(4);
    expect(getPointSpriteSize(10)).toBeGreaterThan(20);
  });

  test('returns whole pixels so the sprite canvas is not fractionally sized', () => {
    expect(Number.isInteger(getPointSpriteSize(2))).toBe(true);
    expect(Number.isInteger(getPointSpriteSize(3))).toBe(true);
  });

  test('grows with the radius', () => {
    expect(getPointSpriteSize(4)).toBeGreaterThan(getPointSpriteSize(2));
  });
});

describe('getPointSymbolSize', () => {
  test('returns the area of the equivalent circle, since d3 symbols are sized by area', () => {
    expect(getPointSymbolSize(2)).toBeCloseTo(Math.PI * 4);
    expect(getPointSymbolSize(0)).toEqual(0);
  });
});

describe('createTimelineLineLayer', () => {
  test('defaults every style option to the current rendering so saved views are unchanged', () => {
    const layer = createTimelineLineLayer([], []);
    expect(layer.interpolation).toEqual(DEFAULT_INTERPOLATION);
    expect(layer.interpolation).toEqual('step');
    expect(layer.lineStyle).toEqual(DEFAULT_LINE_STYLE);
    expect(layer.lineStyle).toEqual('solid');
    expect(layer.opacity).toEqual(DEFAULT_LINE_OPACITY);
    expect(layer.opacity).toEqual(1);
    expect(layer.pointShape).toEqual(DEFAULT_POINT_SHAPE);
    expect(layer.pointShape).toEqual('circle');
    expect(layer.showPoints).toEqual(DEFAULT_SHOW_POINTS_MODE);
    expect(layer.showPoints).toEqual('auto');
    // Left unset so points and fill track lineColor until the user overrides them, matching how the
    // layer rendered when point and fill color were not separately configurable
    expect(layer.pointColor).toBeUndefined();
    expect(layer.fillColor).toBeUndefined();
  });

  test('allows the style options to be overridden', () => {
    const layer = createTimelineLineLayer([], [], {
      interpolation: 'linear',
      lineStyle: 'dashed',
      opacity: 0.5,
      pointShape: 'diamond',
      showPoints: 'never',
    });
    expect(layer.opacity).toEqual(0.5);
    expect(layer.interpolation).toEqual('linear');
    expect(layer.lineStyle).toEqual('dashed');
    expect(layer.pointShape).toEqual('diamond');
    expect(layer.showPoints).toEqual('never');
  });
});

describe('thinTicksByPixelSpacing', () => {
  // Identity scale so tick values double as pixel positions, keeping the spacing math readable
  const identity = (value: number) => value;

  test('keeps ticks that are far enough apart', () => {
    expect(thinTicksByPixelSpacing([0, 20, 40, 60], identity, 14)).toEqual([0, 20, 40, 60]);
  });

  test('drops ticks that would overlap, keeping the first of each cluster', () => {
    expect(thinTicksByPixelSpacing([0, 2, 4, 20, 22, 40], identity, 14)).toEqual([0, 20, 40]);
  });

  test('always keeps both extremes, evicting a neighbor that collides with the last', () => {
    const thinned = thinTicksByPixelSpacing([0, 20, 39, 40], identity, 14);
    expect(thinned[0]).toEqual(0);
    expect(thinned.at(-1)).toEqual(40);
    expect(thinned).not.toContain(39);
  });

  test('passes through short tick lists untouched', () => {
    expect(thinTicksByPixelSpacing([], identity, 14)).toEqual([]);
    expect(thinTicksByPixelSpacing([5], identity, 14)).toEqual([5]);
    expect(thinTicksByPixelSpacing([5, 6], identity, 14)).toEqual([5, 6]);
  });

  test('drops ticks the scale cannot place at all', () => {
    // A log axis now places zero, so the only unplottable case left is a scale with no domain
    const emptyScale = getYScale([], 100, 'log');
    expect(thinTicksByPixelSpacing([0, 1, 100], value => emptyScale(value))).toEqual([]);
    const logScale = getYScale([0, 100], 100, 'log', getLogConstant(0.5));
    expect(thinTicksByPixelSpacing([0, 1, 100], value => logScale(value))).toContain(0);
  });
});

describe('getLogConstant', () => {
  test('uses the smallest non-zero magnitude in the data', () => {
    expect(getLogConstant(0.01)).toBeCloseTo(0.01);
    expect(getLogConstant(1)).toBeCloseTo(1);
    expect(getLogConstant(2500)).toBeCloseTo(2500);
  });

  test('falls back to d3 default when there is nothing to derive from', () => {
    // All-zero data offers no magnitude to size the linear region with
    expect(getLogConstant(undefined)).toEqual(1);
    expect(getLogConstant(0)).toEqual(1);
    expect(getLogConstant(NaN)).toEqual(1);
    expect(getLogConstant(-5)).toEqual(1);
  });
});

describe('getYScale log axis', () => {
  const drawHeight = 100; // Yields a range of [92, 8] given CANVAS_PADDING_Y

  test('places zero instead of dropping it, which a true log scale cannot do', () => {
    // The bug this whole design exists to avoid: on a true log scale yScale(0) is -Infinity, so every
    // sample sitting at zero silently vanished from the plot
    const scale = getYScale([0, 10000], drawHeight, 'log', getLogConstant(0.01));
    expect(scale(0)).toEqual(92);
    expect(Number.isFinite(scale(0))).toBe(true);
  });

  test('places negative values, so a signed resource keeps its full trace', () => {
    const scale = getYScale([-100, 30], drawHeight, 'log', getLogConstant(0.1));
    for (const value of [-100, -10, -1, 0, 1, 10, 30]) {
      expect(Number.isFinite(scale(value))).toBe(true);
    }
    expect(scale(-100)).toBeGreaterThan(scale(30));
  });

  test('spaces decades near-uniformly, the way a log axis should', () => {
    const scale = getYScale([0, 10000], drawHeight, 'log', getLogConstant(0.01));
    const positions = [0.01, 0.1, 1, 10, 100, 1000, 10000].map(value => scale(value));
    const gaps = positions.slice(1).map((position, index) => positions[index] - position);
    // A true log scale over this domain and range spaces decades exactly 14px apart. Every decade
    // above the lowest must land within a pixel of that, which is what makes symlog an honest
    // stand-in; only the lowest is allowed to compress where the linear region blends in.
    for (const gap of gaps.slice(1)) {
      expect(gap).toBeGreaterThan(13);
      expect(gap).toBeLessThan(15);
    }
    expect(gaps[0]).toBeGreaterThan(9);
  });

  test('never returns a non-finite position for any real value in the domain', () => {
    // Guards the extrema-jitter symptom: which samples survive decimation shifts with zoom, so any
    // unplottable value made troughs flicker in and out as bin boundaries moved
    const scale = getYScale([0, 10000], drawHeight, 'log', getLogConstant(0.01));
    for (const value of [0, 1e-9, 0.005, 0.01, 1, 9999, 10000]) {
      expect(Number.isFinite(scale(value))).toBe(true);
    }
  });

  test('defaults to linear when no scale type is given', () => {
    const scale = getYScale([0, 100], drawHeight);
    expect(scale(50)).toEqual(50);
  });
});

describe('getLogTickValues', () => {
  test('returns a ladder of powers of the base within the domain', () => {
    expect(getLogTickValues([1, 1000], 10)).toEqual([1, 10, 100, 1000]);
    expect(getLogTickValues([1, 64], 2)).toEqual([1, 2, 4, 8, 16, 32, 64]);
  });

  test('includes zero when the domain contains it', () => {
    expect(getLogTickValues([0, 1000], 10)).toContain(0);
  });

  test('ladders both sides of zero for a signed domain', () => {
    const ticks = getLogTickValues([-1000, 1000], 10);
    expect(ticks).toContain(-100);
    expect(ticks).toContain(0);
    expect(ticks).toContain(100);
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b));
  });

  test('always anchors the domain extremes', () => {
    const ticks = getLogTickValues([0.5, 750], 10);
    expect(ticks[0]).toEqual(0.5);
    expect(ticks.at(-1)).toEqual(750);
  });

  test('falls back to base 10 for a nonsensical base rather than looping or dividing by zero', () => {
    expect(getLogTickValues([1, 1000], 1)).toEqual(getLogTickValues([1, 1000], 10));
    expect(getLogTickValues([1, 1000], 0)).toEqual(getLogTickValues([1, 1000], 10));
    expect(getLogTickValues([1, 1000], NaN)).toEqual(getLogTickValues([1, 1000], 10));
  });

  test('handles degenerate domains without throwing', () => {
    expect(getLogTickValues([], 10)).toEqual([]);
    expect(getLogTickValues([NaN, 10], 10)).toEqual([]);
  });

  // A constant-valued resource makes both bounds the same number. Returning nothing left the axis with
  // no labels at all, which is worse than the linear scale it replaced -- that still labels its one
  // value.
  test('labels the single value of a constant resource rather than leaving the axis blank', () => {
    expect(getLogTickValues([5, 5], 10)).toEqual([5]);
    expect(getLogTickValues([0, 0], 10)).toEqual([0]);
  });
});

describe('getLineFillBaselineY on a log axis', () => {
  const drawHeight = 100;

  test('fills to zero, which symlog can place', () => {
    const scale = getYScale([0, 10000], drawHeight, 'log', getLogConstant(0.01));
    expect(getLineFillBaselineY(scale, drawHeight)).toEqual(92);
  });

  test('still returns null for an empty domain', () => {
    expect(getLineFillBaselineY(getYScale([], drawHeight, 'log'), drawHeight)).toBeNull();
  });
});

describe('getSmallestMagnitudeForAxis', () => {
  const resource: Resource = {
    name: 'signed',
    schema: { type: 'real' },
    values: [
      { x: 1, y: 0 },
      { x: 2, y: -0.25 },
      { x: 3, y: 100 },
    ],
  };

  test('ignores zero and uses absolute value, so a negative sample can set the floor', () => {
    const layer = createTimelineLineLayer([], []);
    layer.filter.resource = 'signed';
    const axis = createYAxis([], { domainFitMode: 'fitPlan', id: layer.yAxisId as number });
    expect(getSmallestMagnitudeForAxis(axis, [layer], [resource])).toEqual(0.25);
  });

  test('returns undefined when an axis has no non-zero data to derive from', () => {
    const layer = createTimelineLineLayer([], []);
    layer.filter.resource = 'allZero';
    const axis = createYAxis([], { domainFitMode: 'fitPlan', id: layer.yAxisId as number });
    const allZero: Resource = { name: 'allZero', schema: { type: 'real' }, values: [{ x: 1, y: 0 }] };
    expect(getSmallestMagnitudeForAxis(axis, [layer], [allZero])).toBeUndefined();
  });
});

describe('isNumericResourceSchema', () => {
  // This is the gate that decides whether a layer can join a stack, so a wrong answer here does not
  // throw -- it silently leaves a layer out of a total, or sums something meaningless into one.
  test('accepts the schemas that plot against a numeric scale', () => {
    expect(isNumericResourceSchema({ type: 'int' })).toBe(true);
    expect(isNumericResourceSchema({ type: 'real' })).toBe(true);
    expect(isNumericResourceSchema({ type: 'duration' })).toBe(true);
  });

  test('accepts a real-valued struct, which is how a profile carries initial and rate', () => {
    expect(
      isNumericResourceSchema({
        items: { initial: { type: 'real' }, rate: { type: 'real' } },
        type: 'struct',
      } as ValueSchema),
    ).toBe(true);
  });

  test('rejects a struct that is not a real profile', () => {
    expect(isNumericResourceSchema({ items: { initial: { type: 'real' } }, type: 'struct' } as ValueSchema)).toBe(
      false,
    );
    expect(
      isNumericResourceSchema({
        items: { initial: { type: 'string' }, rate: { type: 'real' } },
        type: 'struct',
      } as ValueSchema),
    ).toBe(false);
  });

  // A boolean's 0/1 encodes false/true and an enum's y position is an arbitrary rung, so summing
  // either produces a number that means nothing
  test('rejects the schemas whose values are categorical rather than magnitudes', () => {
    expect(isNumericResourceSchema({ type: 'boolean' })).toBe(false);
    expect(isNumericResourceSchema({ type: 'string' })).toBe(false);
    expect(isNumericResourceSchema({ type: 'variant', variants: [] } as unknown as ValueSchema)).toBe(false);
  });
});

describe('getLineLayerStacks', () => {
  function lineLayer(id: number, resourceName: string, yAxisId: number, interpolation?: InterpolationMode) {
    return { chartType: 'line', filter: { resource: resourceName }, id, interpolation, name: '', yAxisId } as any;
  }
  function numericResource(name: string, values: { x: number; y: number }[]): Resource {
    return { name, schema: { type: 'real' }, values };
  }

  const axisStacked = createYAxis([], { domainFitMode: 'fitPlan', id: 1, stack: true });
  const axisPlain = createYAxis([], { domainFitMode: 'fitPlan', id: 1 });
  const a = numericResource('a', [
    { x: 0, y: 10 },
    { x: 10, y: 20 },
  ]);
  const b = numericResource('b', [
    { x: 0, y: 1 },
    { x: 10, y: 2 },
  ]);

  test('returns nothing for an axis that has not opted in, so nothing changes by default', () => {
    expect(getLineLayerStacks([axisPlain], [lineLayer(1, 'a', 1), lineLayer(2, 'b', 1)], [a, b])).toEqual({});
  });

  // Stacking one series against nothing is the identity, and the resample would be pure cost
  test('returns nothing when fewer than two layers would be stacked', () => {
    expect(getLineLayerStacks([axisStacked], [lineLayer(1, 'a', 1)], [a])).toEqual({});
  });

  test('keys the result by layer id, with a baseline index-aligned to its own values', () => {
    const stacks = getLineLayerStacks([axisStacked], [lineLayer(1, 'a', 1), lineLayer(2, 'b', 1)], [a, b]);
    expect(Object.keys(stacks).sort()).toEqual(['1', '2']);
    expect(stacks[1].resource.values).toEqual([
      { x: 0, y: 10 },
      { x: 10, y: 20 },
    ]);
    expect(stacks[1].baseline).toEqual([0, 0]);
    // The second layer sits on the first, so its line is the running total and its baseline is layer 1
    expect(stacks[2].resource.values).toEqual([
      { x: 0, y: 11 },
      { x: 10, y: 22 },
    ]);
    expect(stacks[2].baseline).toEqual([10, 20]);
    expect(stacks[2].baseline.length).toEqual(stacks[2].resource.values.length);
  });

  // Layer order is stack order, so reversing the layers has to reverse which one is on the bottom
  test('stacks bottom-up in layer order', () => {
    const stacks = getLineLayerStacks([axisStacked], [lineLayer(2, 'b', 1), lineLayer(1, 'a', 1)], [a, b]);
    expect(stacks[2].baseline).toEqual([0, 0]);
    expect(stacks[1].baseline).toEqual([1, 2]);
  });

  test('carries each layer own resource name and schema onto its stacked series', () => {
    const stacks = getLineLayerStacks([axisStacked], [lineLayer(1, 'a', 1), lineLayer(2, 'b', 1)], [a, b]);
    expect(stacks[1].resource.name).toEqual('a');
    expect(stacks[2].resource.name).toEqual('b');
    expect(stacks[2].resource.schema).toEqual({ type: 'real' });
  });

  // The stacking pass emits values already in the shape the layer draws, so tagging them would make
  // LayerLine drop points and pull the line out of alignment with its own baseline
  test('leaves the stacked values untagged so they are not thinned a second time', () => {
    const held = numericResource('held', [
      { x: 0, y: 5 },
      { x: 10, y: 5 },
    ]);
    (held.values[1] as ResourceValue).is_hold = true;
    const stacks = getLineLayerStacks([axisStacked], [lineLayer(1, 'held', 1), lineLayer(2, 'b', 1)], [held, b]);
    expect(stacks[1].resource.values.every(value => value.is_hold === undefined)).toBe(true);
  });

  // A layer whose resource cannot be summed is left out entirely rather than contributing a
  // meaningless number, which also means it keeps drawing normally
  test('skips a layer whose resource is not numeric, and gives up if that leaves one layer', () => {
    const enumResource: Resource = { name: 'e', schema: { type: 'string' }, values: [{ x: 0, y: 'ON' }] };
    expect(getLineLayerStacks([axisStacked], [lineLayer(1, 'a', 1), lineLayer(2, 'e', 1)], [a, enumResource])).toEqual(
      {},
    );
    const stacks = getLineLayerStacks(
      [axisStacked],
      [lineLayer(1, 'a', 1), lineLayer(2, 'e', 1), lineLayer(3, 'b', 1)],
      [a, enumResource, b],
    );
    expect(Object.keys(stacks).sort()).toEqual(['1', '3']);
    expect(stacks[3].baseline).toEqual([10, 20]);
  });

  test('skips a layer with no loaded resource', () => {
    expect(getLineLayerStacks([axisStacked], [lineLayer(1, 'a', 1), lineLayer(2, 'missing', 1)], [a])).toEqual({});
  });

  test('ignores layers bound to a different axis, and layers that are not line layers', () => {
    const otherAxisLayer = lineLayer(3, 'b', 2);
    const xRangeLayer = { chartType: 'x-range', filter: { resource: 'b' }, id: 4, name: '', yAxisId: 1 } as any;
    expect(getLineLayerStacks([axisStacked], [lineLayer(1, 'a', 1), otherAxisLayer, xRangeLayer], [a, b])).toEqual({});
  });

  test('stacks each axis independently', () => {
    const secondAxis = createYAxis([], { domainFitMode: 'fitPlan', id: 2, stack: true });
    const c = numericResource('c', [
      { x: 0, y: 100 },
      { x: 10, y: 100 },
    ]);
    const stacks = getLineLayerStacks(
      [axisStacked, secondAxis],
      [lineLayer(1, 'a', 1), lineLayer(2, 'b', 1), lineLayer(3, 'c', 2), lineLayer(4, 'b', 2)],
      [a, b, c],
    );
    expect(stacks[2].baseline).toEqual([10, 20]);
    // Layer 4 stacks on c, not on anything from the first axis
    expect(stacks[4].baseline).toEqual([100, 100]);
  });

  // Each series resamples with its own interpolation mode, so a step resource and a linear one stack
  // together correctly instead of one being forced into the other shape
  test('respects each layer own interpolation mode', () => {
    const stepped = numericResource('stepped', [
      { x: 0, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 20 },
      { x: 20, y: 20 },
    ]);
    const ramp = numericResource('ramp', [
      { x: 0, y: 0 },
      { x: 20, y: 20 },
    ]);
    const stacks = getLineLayerStacks(
      [axisStacked],
      [lineLayer(1, 'stepped', 1, 'step'), lineLayer(2, 'ramp', 1, 'linear')],
      [stepped, ramp],
    );
    // At x=10 the step layer is still 10 on the way in, and the ramp has reached its own midpoint
    const atTen = stacks[2].resource.values.filter(value => value.x === 10);
    expect(atTen[atTen.length - 1].y).toEqual(30);
  });
});

describe('getYAxisBounds stats', () => {
  const signed: Resource = {
    name: 'signed',
    schema: { type: 'real' },
    values: [
      { x: 1, y: 0 },
      { x: 2, y: -0.25 },
      { x: 3, y: 100 },
    ],
  };
  const layer = { chartType: 'line', filter: { resource: 'signed' }, id: 1, name: '', yAxisId: 7 } as any;
  const axis = createYAxis([], { domainFitMode: 'fitPlan', id: 7 });

  // Collected during the domain walk so a log axis costs one pass over its values rather than two
  test('collects the smallest non-zero magnitude alongside the domain', () => {
    const stats: { smallestMagnitude?: number } = {};
    expect(getYAxisBounds(axis, [layer], [signed], undefined, {}, stats)).toEqual([-0.25, 100]);
    expect(stats.smallestMagnitude).toEqual(0.25);
  });

  test('leaves the stat unset when there is no non-zero data to derive it from', () => {
    const allZero: Resource = { name: 'signed', schema: { type: 'real' }, values: [{ x: 1, y: 0 }] };
    const stats: { smallestMagnitude?: number } = {};
    getYAxisBounds(axis, [layer], [allZero], undefined, {}, stats);
    expect(stats.smallestMagnitude).toBeUndefined();
  });

  test('collects nothing when no stats object is passed, which is the default', () => {
    expect(() => getYAxisBounds(axis, [layer], [signed])).not.toThrow();
  });

  // The domain of a stacked axis comes off the cumulative series, so the constant that sizes the
  // scale linear region has to be read off the same values
  test('reads a stacked layer stat off its cumulative series, matching the domain', () => {
    const stacks = {
      1: {
        baseline: [0, 0],
        resource: {
          name: 'signed',
          schema: { type: 'real' as const },
          values: [
            { x: 1, y: 4 },
            { x: 2, y: 8 },
          ],
        },
      },
    };
    const stats: { smallestMagnitude?: number } = {};
    expect(getYAxisBounds(axis, [layer], [signed], undefined, stacks, stats)).toEqual([4, 8]);
    expect(stats.smallestMagnitude).toEqual(4);
  });

  // fitTimeWindow narrows the domain, and the constant has to narrow with it or the scale linear
  // region will not match what is on screen
  test('honors the fitTimeWindow window, so the stat matches the domain on screen', () => {
    const windowed = createYAxis([], { domainFitMode: 'fitTimeWindow', id: 7 });
    const stats: { smallestMagnitude?: number } = {};
    getYAxisBounds(windowed, [layer], [signed], { end: 3, start: 3 }, {}, stats);
    expect(stats.smallestMagnitude).toEqual(100);
  });
});

describe('getXRangeValueDomain', () => {
  test('enumerates a boolean schema as the strings the layer draws', () => {
    expect(getXRangeValueDomain({ type: 'boolean' })).toEqual(['TRUE', 'FALSE']);
  });

  test('takes a variant schema in declaration order, since that is what fixes each value a color', () => {
    const schema = {
      type: 'variant' as const,
      variants: [
        { key: 'ON', label: 'ON' },
        { key: 'OFF', label: 'OFF' },
      ],
    };
    expect(getXRangeValueDomain(schema)).toEqual(['ON', 'OFF']);
  });

  // The whole point of returning null rather than []: a free-form resource has values, they are just
  // not knowable from the schema, and the form has to say so instead of showing an empty list
  test('returns null for a schema that cannot enumerate its values', () => {
    expect(getXRangeValueDomain({ type: 'string' })).toBeNull();
    expect(getXRangeValueDomain({ type: 'int' })).toBeNull();
    expect(getXRangeValueDomain({ type: 'real' })).toBeNull();
    expect(getXRangeValueDomain(undefined)).toBeNull();
  });
});

describe('getXRangeColorScale', () => {
  const domain = ['ON', 'OFF', 'SAFE'];

  test('assigns a color per value and repeats the scheme once it runs out', () => {
    const scale = getXRangeColorScale('schemeAccent', domain);
    expect(scale('ON')).not.toEqual(scale('OFF'));
    // schemeAccent has 8 entries, so the ninth value wraps onto the first color
    const long = Array.from({ length: 9 }, (_, i) => `v${i}`);
    const wrapping = getXRangeColorScale('schemeAccent', long);
    expect(wrapping('v8')).toEqual(wrapping('v0'));
  });

  // A value's color has to survive a re-render, or pinning colors would be pointless
  test('is stable for the same scheme and domain', () => {
    expect(getXRangeColorScale('schemeSet1', domain)('SAFE')).toEqual(
      getXRangeColorScale('schemeSet1', domain)('SAFE'),
    );
  });

  // Pin: the form previews inherited colors with this same function, so a divergence here would show an
  // operator a swatch the canvas never paints
  test('depends on position in the domain, not on the value itself', () => {
    const scale = getXRangeColorScale('schemeDark2', domain);
    const reordered = getXRangeColorScale('schemeDark2', ['OFF', 'ON', 'SAFE']);
    expect(reordered('OFF')).toEqual(scale('ON'));
  });

  test('falls back to a real scheme for an unknown scheme name', () => {
    const unknown = getXRangeColorScale('schemeNope' as never, domain);
    expect(unknown('ON')).toEqual(getXRangeColorScale('schemeTableau10', domain)('ON'));
  });
});

describe('formatBandDuration', () => {
  const s = 1000;
  const m = 60 * s;
  const h = 60 * m;
  const d = 24 * h;

  test('caps at two units, so the readout fits inside the band it measures', () => {
    expect(formatBandDuration(6 * h)).toEqual('6h 00m');
    expect(formatBandDuration(6 * h + 30 * m)).toEqual('6h 30m');
    // The units below the second one are dropped rather than rounded into it
    expect(formatBandDuration(6 * h + 30 * m + 59 * s + 999)).toEqual('6h 30m');
  });

  test('zero-pads the smaller unit, so a column of caps stays one width', () => {
    expect(formatBandDuration(2 * d + 4 * h)).toEqual('2d 04h');
    expect(formatBandDuration(1 * h + 5 * m)).toEqual('1h 05m');
    expect(formatBandDuration(1 * m + 5 * s)).toEqual('1m 05s');
    expect(formatBandDuration(1 * s + 5)).toEqual('1s 005ms');
  });

  test('steps down to whatever the largest non-zero unit is', () => {
    expect(formatBandDuration(45 * m)).toEqual('45m 00s');
    expect(formatBandDuration(30 * s)).toEqual('30s 000ms');
    expect(formatBandDuration(250)).toEqual('250ms');
    expect(formatBandDuration(0)).toEqual('0ms');
  });

  // Order is normalized before the band is drawn, so a region typed backwards still lasts as long as it
  // lasts -- a negative readout would be an artifact of the typing, not of the region
  test('reads the same whichever way round the two ends were given', () => {
    expect(formatBandDuration(-6 * h)).toEqual(formatBandDuration(6 * h));
  });

  test('does not roll hours into days below a full day, nor lose a day boundary', () => {
    expect(formatBandDuration(23 * h + 59 * m)).toEqual('23h 59m');
    expect(formatBandDuration(d)).toEqual('1d 00h');
  });
});

describe('selectMarkerPoints', () => {
  const sample = (x: number) => ({ sample: true, x, y: x });
  const synthetic = (x: number) => ({ sample: false, x, y: x });
  const unknown = (x: number) => ({ x, y: x });
  const base = { decimationReduced: false, pointRadius: 2, width: 400 };

  test('auto marks only verified samples', () => {
    const points = [sample(1), synthetic(2), unknown(3), { sample: true, x: 4, y: null }, sample(5)];
    expect(selectMarkerPoints(points, { ...base, mode: 'auto' }).map(p => p.x)).toEqual([1, 5]);
  });

  test('auto draws nothing once decimation reduced the set', () => {
    expect(selectMarkerPoints([sample(1)], { ...base, decimationReduced: true, mode: 'auto' })).toEqual([]);
  });

  test('auto draws nothing when samples are too dense to tell apart; always still marks them', () => {
    const dense = Array.from({ length: 200 }, (_, i) => sample(i));
    expect(selectMarkerPoints(dense, { ...base, mode: 'auto' })).toEqual([]);
    expect(selectMarkerPoints(dense, { ...base, mode: 'always' })).toHaveLength(200);
    const sparse = Array.from({ length: 50 }, (_, i) => sample(i));
    expect(selectMarkerPoints(sparse, { ...base, mode: 'auto' })).toHaveLength(50);
  });

  test('always never marks synthetic, summary or unverified points, even when decimated', () => {
    const points = [sample(1), synthetic(2), unknown(3)];
    expect(selectMarkerPoints(points, { ...base, decimationReduced: true, mode: 'always' }).map(p => p.x)).toEqual([1]);
  });

  test('never marks nothing', () => {
    expect(selectMarkerPoints([sample(1)], { ...base, mode: 'never' })).toEqual([]);
  });
});
