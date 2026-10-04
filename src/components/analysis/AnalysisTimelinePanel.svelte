<svelte:options immutable={true} />

<!--
  The existing Timeline, on an analysis: no plan, directives, constraints or simulation of its own. Its sources come
  from the page's timeline sources context; its rows from the shared view store. Selection is the analysis's own
  (source, activity id), drawn through the timeline's numeric span selection.
-->
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import {
    analysisMaxTimeRange,
    analysisSimulationDatasets,
    analysisSourceBindings,
    selectedAnalysisActivity,
  } from '../../stores/analysis';
  import { getAnalysisActivityTimes } from '../../stores/analysisActivities';
  import { viewTimeRange } from '../../stores/plan';
  import {
    timelineInteractionMode,
    timelineLockStatus,
    view,
    viewSetSelectedRow,
    viewUpdateRow,
    viewUpdateTimeline,
  } from '../../stores/views';
  import type { User } from '../../types/app';
  import type { Span, SpanUtilityMaps } from '../../types/simulation';
  import type { MouseDown, Row, TimeRange } from '../../types/timeline';
  import { getActivityDrawingId, getActivityRefFromSpan } from '../../utilities/analysis';
  import effects from '../../utilities/effects';
  import Timeline from '../timeline/Timeline.svelte';
  import TimelineViewControls from '../timeline/TimelineViewControls.svelte';
  import Panel from '../ui/Panel.svelte';
  import PanelHeaderActions from '../ui/PanelHeaderActions.svelte';

  /** Shows the rows without offering any change to them: see Timeline's `readOnly`. */
  export let readOnly: boolean = false;
  export let user: User | null;

  const dispatch = createEventDispatcher<{ editRow: Row; inspect: void }>();
  const noSpanMaps: SpanUtilityMaps = {
    directiveIdToSpanIdMap: {},
    spanIdToChildIdsMap: {},
    spanIdToDirectiveIdMap: {},
  };

  let timelineRef: Timeline;
  let decimate = true;
  let interpolateHoverValue = false;
  let limitTooltipToLine = false;
  let showTimelineTooltip = true;
  let activityTimes: Pick<Span, 'durationMs' | 'startMs'>[] = [];
  let activityTimesLoading = true;

  $: timelines = $view?.definition.plan.timelines ?? [];
  $: timeline = timelines[0] ?? null;
  $: loadActivityTimes($analysisSourceBindings, $analysisSimulationDatasets, user);
  $: selectedSpanId = $selectedAnalysisActivity ? getActivityDrawingId($selectedAnalysisActivity) : null;

  let activityTimesRequest = 0;
  async function loadActivityTimes(...args: Parameters<typeof getAnalysisActivityTimes>) {
    const request = ++activityTimesRequest;
    activityTimesLoading = true;
    const times = await getAnalysisActivityTimes(...args).catch(() => []);
    if (request === activityTimesRequest) {
      activityTimes = times;
      activityTimesLoading = false;
    }
  }

  /** Brings an activity into view if it is not: centred at the current zoom, or fitted if it is longer. */
  export function reveal(startMs: number, endMs: number) {
    const range = $viewTimeRange;
    if (startMs >= range.start && endMs <= range.end) {
      return;
    }
    const width = Math.max(range.end - range.start, (endMs - startMs) * 1.2);
    const center = (startMs + endMs) / 2;
    const next: TimeRange = { end: center + width / 2, start: center - width / 2 };
    $viewTimeRange = next;
    timelineRef?.viewTimeRangeChanged(next);
  }

  function onMouseDown(event: CustomEvent<MouseDown>) {
    const span = event.detail.spans?.[0];
    $selectedAnalysisActivity = span ? getActivityRefFromSpan(span) : null;
  }

  function onEditRow(row: Row) {
    viewSetSelectedRow(row.id);
    dispatch('editRow', row);
  }
</script>

<!-- Panel takes its height from a grid cell, as in the Plan page's grid. -->
<div class="panel-cell">
  <Panel padBody={false}>
    <svelte:fragment slot="header">
      <div class="st-typography-medium timeline-title">Timeline</div>
      <PanelHeaderActions>
        <div class="header-actions timeline-icon-tray">
          <TimelineViewControls
            planControls={false}
            maxTimeRange={$analysisMaxTimeRange}
            viewTimeRange={$viewTimeRange}
            {decimate}
            {interpolateHoverValue}
            {limitTooltipToLine}
            {showTimelineTooltip}
            on:toggleDecimation={({ detail }) => (decimate = detail)}
            on:toggleInterpolateHoverValue={({ detail }) => (interpolateHoverValue = detail)}
            on:toggleLimitTooltipToLine={({ detail }) => (limitTooltipToLine = detail)}
            on:toggleTimelineTooltip={({ detail }) => (showTimelineTooltip = detail)}
            on:viewTimeRangeChanged={({ detail }) => timelineRef?.viewTimeRangeChanged(detail)}
          />
        </div>
      </PanelHeaderActions>
    </svelte:fragment>

    <svelte:fragment slot="body">
      {#if timeline}
        <Timeline
          bind:this={timelineRef}
          {decimate}
          {interpolateHoverValue}
          {limitTooltipToLine}
          {showTimelineTooltip}
          activityDirectivesMap={{}}
          maxTimeRange={$analysisMaxTimeRange}
          planEndTimeDoy=""
          planStartTimeYmd=""
          {readOnly}
          {timeline}
          timelineInteractionMode={$timelineInteractionMode}
          selectedActivityDirectiveId={null}
          selectedExternalEventId={null}
          {selectedSpanId}
          spanUtilityMaps={noSpanMaps}
          spansMap={{}}
          initialSpansLoading={activityTimesLoading}
          spans={activityTimes}
          timelineLockStatus={$timelineLockStatus}
          {user}
          viewTimeRange={$viewTimeRange}
          on:dblClick={() => dispatch('inspect')}
          on:mouseDown={onMouseDown}
          on:toggleRowExpansion={({ detail: { expanded, rowId } }) =>
            viewUpdateRow('expanded', expanded, timeline?.id, rowId)}
          on:updateRowHeight={({ detail: { newHeight, rowId, wasAutoAdjusted } }) =>
            viewUpdateRow('height', newHeight, timeline?.id, rowId, wasAutoAdjusted)}
          on:updateRows={({ detail: rows }) => viewUpdateTimeline('rows', rows, timeline?.id)}
          on:updateVerticalGuides={({ detail }) => viewUpdateTimeline('verticalGuides', detail, timeline?.id)}
          on:viewTimeRangeChanged={({ detail }) => ($viewTimeRange = detail)}
          on:editRow={({ detail }) => onEditRow(detail)}
          on:deleteRow={({ detail }) => timeline && effects.deleteTimelineRow(detail, timeline.rows, timeline.id)}
          on:duplicateRow={({ detail }) => {
            const row = timeline && effects.duplicateTimelineRow(detail, timeline, timelines);
            if (row) {
              onEditRow(row);
            }
          }}
          on:insertRow={({ detail }) => {
            const row = timeline && effects.insertTimelineRow(detail, timeline, timelines);
            if (row) {
              onEditRow(row);
            }
          }}
        />
      {/if}
    </svelte:fragment>
  </Panel>
</div>

<style>
  .panel-cell {
    display: grid;
    height: 100%;
  }

  .timeline-title {
    padding: 0 4px;
    user-select: none;
  }

  .header-actions {
    align-items: center;
    display: flex;
    gap: 4px;
  }
</style>
