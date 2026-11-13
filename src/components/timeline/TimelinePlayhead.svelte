<svelte:options immutable={true} />

<script lang="ts">
  import { ContextMenu } from '@nasa-jpl/stellar-svelte';
  import type { ScaleTime } from 'd3-scale';
  import { createEventDispatcher } from 'svelte';
  import { timeCursorCompareMs, timeCursorDragging, timeCursorMs } from '../../stores/plan';
  import { plugins } from '../../stores/plugins';
  import { view } from '../../stores/views';
  import type { ActivityDirectivesMap } from '../../types/activity';
  import type { SimulationDataset, Span } from '../../types/simulation';
  import type { TimeRange, VerticalGuide } from '../../types/timeline';
  import { formatDate, getDoyTime, getUnixEpochTime } from '../../utilities/time';
  import { createVerticalGuide } from '../../utilities/timeline';
  import ContextMenuInternal from '../context-menu/ContextMenu.svelte';
  import TimelinePlayheadPill from './TimelinePlayheadPill.svelte';

  export let activityDirectivesMap: ActivityDirectivesMap | null = null;
  export let drawWidth: number = 0;
  export let marginLeft: number = 50;
  export let maxTimeRange: TimeRange = { end: 0, start: 0 };
  /** The view can't be edited: the cursors still move and compare, but nothing is offered that changes the view. */
  export let readOnly: boolean = false;
  export let simulationDataset: SimulationDataset | null = null;
  /** Spans to snap to. Where only their times are known (an Analysis's histogram), they snap without a type. */
  export let spans: (Pick<Span, 'durationMs' | 'startMs'> & Partial<Pick<Span, 'type'>>)[] | null = [];
  export let verticalGuides: VerticalGuide[] = [];
  export let viewTimeRange: TimeRange = { end: 0, start: 0 };
  export let xScaleView: ScaleTime<number, number> | null = null;

  type SnapTarget = { label: string; timeMs: number };
  type Cursor = 'A' | 'B';

  /** Pixel radius within which a drag snaps to a nearby target. */
  const SNAP_THRESHOLD_PX = 8;
  const MAX_SNAP_SPANS = 20_000;
  const MAX_SNAP_SPANS_IN_VIEW = 3_000;
  /** Height of the playhead's own lane. Keep in sync with the CSS that positions the pills in it. */
  const LANE_HEIGHT = 24;
  /** Approximate pill widths, used to keep a pill fully on screen and to decide when to merge. */
  const PILL_WIDTH = 118;
  const MERGED_WIDTH = 226;

  const dispatch = createEventDispatcher<{
    openInspector: void;
    updateVerticalGuides: VerticalGuide[];
    viewTimeRangeChanged: TimeRange;
  }>();

  let contextMenuComponent: ContextMenuInternal;
  let dragStartClientX: number = 0;
  let dragStartTimeMs: number = 0;
  let dragTarget: Cursor | null = null;
  let ghostX: number = -1;
  let snapDisabled: boolean = false;
  let snapLabel: string = '';
  /** Edges of the spans in view, taken when a drag starts (only for very many spans: see `manySpans`). */
  let viewSpanTargets: SnapTarget[] = [];

  // ponytail: past this many spans (an Analysis of a large imported source) they are not all kept as targets: a drag
  // snaps to the ones in view when it starts (and not at all where they are too dense to mean anything). Shift+arrow
  // jumps skip them. Upgrade path: ask the source for the neighbouring activity edge instead.
  $: manySpans = (spans?.length ?? 0) > MAX_SNAP_SPANS;
  $: snapTargets = getSnapTargets(manySpans ? [] : spans, activityDirectivesMap, verticalGuides, simulationDataset);
  $: viewDuration = viewTimeRange.end - viewTimeRange.start;
  $: comparing = $timeCursorCompareMs !== null;

  // Draw-space x of each cursor. Pills are clamped to stay fully visible, which removes the need for
  // a separate off-screen affordance — the pill parks itself at the edge, still readable and still
  // draggable, and its own readout says where the cursor actually is.
  $: cursorAx = $timeCursorMs !== null && xScaleView !== null ? xScaleView($timeCursorMs) : null;
  $: cursorBx = $timeCursorCompareMs !== null && xScaleView !== null ? xScaleView($timeCursorCompareMs) : null;
  $: pillAx = cursorAx === null ? 0 : clampPill(cursorAx, merged ? MERGED_WIDTH : PILL_WIDTH);
  $: pillBx = cursorBx === null ? 0 : clampPill(cursorBx, PILL_WIDTH);
  // When the two pills would collide, show one merged chip straddling both rather than shoving a
  // label away from the line it names.
  $: merged = cursorAx !== null && cursorBx !== null && Math.abs(cursorBx - cursorAx) < PILL_WIDTH + 6;
  $: mergedX = cursorAx !== null && cursorBx !== null ? clampPill((cursorAx + cursorBx) / 2, MERGED_WIDTH) : 0;

  // The caliper spans between the two pills, so it only has room to draw once they are apart.
  $: caliperLo = cursorAx !== null && cursorBx !== null ? Math.min(pillAx, pillBx) + PILL_WIDTH / 2 : 0;
  $: caliperHi = cursorAx !== null && cursorBx !== null ? Math.max(pillAx, pillBx) - PILL_WIDTH / 2 : 0;
  $: showCaliper = comparing && !merged && caliperHi - caliperLo > 12;

  $: primaryTime = $timeCursorMs !== null ? formatTime($timeCursorMs) : '';
  $: compareTime = $timeCursorCompareMs !== null ? formatTime($timeCursorCompareMs) : '';
  $: compareOffset =
    $timeCursorMs !== null && $timeCursorCompareMs !== null
      ? `${$timeCursorCompareMs >= $timeCursorMs ? '+' : '−'}${formatDuration(Math.abs($timeCursorCompareMs - $timeCursorMs))}`
      : '';

  function formatTime(timeMs: number): string {
    return `${formatDate(new Date(timeMs), $plugins.time.primary.format)}`;
  }

  function formatDuration(ms: number): string {
    const hours = Math.floor(ms / 3_600_000);
    const minutes = Math.round((ms % 3_600_000) / 60_000);
    return `${hours ? `${hours}h ` : ''}${minutes}m`;
  }

  /** Keeps a pill of the given width fully inside the drawable area. */
  function clampPill(x: number, pillWidth: number): number {
    const half = pillWidth / 2;
    if (drawWidth <= pillWidth) {
      return drawWidth / 2;
    }
    return Math.min(Math.max(x, half), drawWidth - half);
  }

  function getSnapTargets(
    spans: (Pick<Span, 'durationMs' | 'startMs'> & Partial<Pick<Span, 'type'>>)[] | null,
    activityDirectivesMap: ActivityDirectivesMap | null,
    verticalGuides: VerticalGuide[],
    simulationDataset: SimulationDataset | null,
  ): SnapTarget[] {
    const targets: SnapTarget[] = [];

    for (const span of spans ?? []) {
      targets.push({ label: `${span.type ?? 'Activity'} start`, timeMs: span.startMs });
      targets.push({ label: `${span.type ?? 'Activity'} end`, timeMs: span.startMs + span.durationMs });
    }

    // Directives matter on their own for plans that have not been simulated, where no spans exist.
    for (const directive of Object.values(activityDirectivesMap ?? {})) {
      targets.push({ label: `${directive.name} start`, timeMs: directive.start_time_ms });
    }

    for (const guide of verticalGuides) {
      targets.push({ label: guide.label.text, timeMs: getUnixEpochTime(guide.timestamp) });
    }

    if (simulationDataset?.simulation_start_time) {
      targets.push({
        label: 'Simulation start',
        timeMs: new Date(simulationDataset.simulation_start_time).getTime(),
      });
    }
    if (simulationDataset?.simulation_end_time) {
      targets.push({ label: 'Simulation end', timeMs: new Date(simulationDataset.simulation_end_time).getTime() });
    }

    return targets.sort((a, b) => a.timeMs - b.timeMs);
  }

  function clamp(timeMs: number): number {
    if (maxTimeRange.end <= maxTimeRange.start) {
      return timeMs;
    }
    return Math.min(Math.max(timeMs, maxTimeRange.start), maxTimeRange.end);
  }

  /**
   * Snaps to the nearest target within SNAP_THRESHOLD_PX unless snapping is suppressed. Measured in
   * pixels rather than time so the tolerance stays constant as the user zooms.
   */
  function applySnap(timeMs: number): number {
    const candidates = viewSpanTargets.length ? [...snapTargets, ...viewSpanTargets] : snapTargets;
    if (snapDisabled || !xScaleView || !candidates.length) {
      snapLabel = '';
      return timeMs;
    }

    const x = xScaleView(timeMs);
    let nearest: SnapTarget | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const target of candidates) {
      const distance = Math.abs(xScaleView(target.timeMs) - x);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = target;
      }
    }

    if (nearest && nearestDistance <= SNAP_THRESHOLD_PX) {
      snapLabel = nearest.label;
      return nearest.timeMs;
    }

    snapLabel = '';
    return timeMs;
  }

  function setCursor(target: Cursor, timeMs: number): void {
    if (target === 'A') {
      timeCursorMs.set(timeMs);
    } else {
      timeCursorCompareMs.set(timeMs);
    }
  }

  function getCursor(target: Cursor): number | null {
    return target === 'A' ? $timeCursorMs : $timeCursorCompareMs;
  }

  /** Moves a cursor by a time delta without snapping, for keyboard nudges. */
  function nudge(target: Cursor, deltaMs: number): void {
    const current = getCursor(target);
    if (current === null) {
      return;
    }
    snapLabel = '';
    setCursor(target, clamp(current + deltaMs));
  }

  function jumpToSnapTarget(target: Cursor, direction: 1 | -1): void {
    const current = getCursor(target);
    if (current === null) {
      return;
    }
    const candidates =
      direction === 1
        ? snapTargets.filter(candidate => candidate.timeMs > current)
        : snapTargets.filter(candidate => candidate.timeMs < current).reverse();

    if (candidates.length) {
      snapLabel = candidates[0].label;
      setCursor(target, clamp(candidates[0].timeMs));
    }
  }

  function centerViewOn(timeMs: number): void {
    if (viewDuration <= 0) {
      return;
    }
    const half = viewDuration / 2;
    dispatch('viewTimeRangeChanged', {
      end: Math.min(timeMs + half, maxTimeRange.end),
      start: Math.max(timeMs - half, maxTimeRange.start),
    });
  }

  /**
   * Scrolls a cursor back into view after a keyboard move. Without this, a Shift+Arrow jump to a
   * distant activity edge silently leaves the visible window behind, and the user cannot tell how
   * far the cursor went.
   */
  function revealCursor(target: Cursor): void {
    const current = getCursor(target);
    if (current === null || viewDuration <= 0) {
      return;
    }
    if (current < viewTimeRange.start || current > viewTimeRange.end) {
      centerViewOn(current);
    }
  }

  async function copyCursorTime(): Promise<void> {
    if ($timeCursorMs !== null) {
      await navigator.clipboard.writeText(`${primaryTime} ${$plugins.time.primary.label}`);
    }
  }

  /** Promotes the transient cursor into a persistent vertical guide on the view. */
  function pinAsVerticalGuide(): void {
    if (readOnly || $timeCursorMs === null || !$view) {
      return;
    }
    const newGuide = createVerticalGuide($view.definition.plan.timelines, getDoyTime(new Date($timeCursorMs)));
    dispatch('updateVerticalGuides', [...verticalGuides, newGuide]);
  }

  /** Clearing the cursor also leaves comparison mode — a B cursor alone has nothing to compare to. */
  function clearCursors(): void {
    timeCursorCompareMs.set(null);
    timeCursorMs.set(null);
  }

  function toggleCompare(): void {
    if ($timeCursorCompareMs !== null) {
      timeCursorCompareMs.set(null);
      return;
    }
    if ($timeCursorMs === null) {
      return;
    }
    // Offset far enough to be grabbable as its own pill rather than landing merged on top of A.
    const offset = viewDuration > 0 ? viewDuration * 0.18 : 3_600_000;
    timeCursorCompareMs.set(clamp($timeCursorMs + offset));
    dispatch('openInspector');
  }

  function onLaneMousemove(event: MouseEvent): void {
    if (!dragTarget) {
      ghostX = event.offsetX;
    }
  }

  function refreshViewSpanTargets(): void {
    viewSpanTargets = [];
    if (!manySpans) {
      return;
    }
    const inView = (spans ?? []).filter(
      span => span.startMs <= viewTimeRange.end && span.startMs + span.durationMs >= viewTimeRange.start,
    );
    if (inView.length <= MAX_SNAP_SPANS_IN_VIEW) {
      viewSpanTargets = getSnapTargets(inView, null, [], null);
    }
  }

  function onLaneMousedown(event: MouseEvent): void {
    if (!xScaleView || event.button !== 0) {
      return;
    }
    refreshViewSpanTargets();
    snapDisabled = event.altKey;
    const timeMs = clamp(applySnap(xScaleView.invert(event.offsetX).getTime()));
    timeCursorMs.set(timeMs);
    // Placing and scrubbing are one gesture: press in the lane and keep dragging without releasing.
    beginDrag('A', event.clientX, timeMs);
  }

  function beginDrag(target: Cursor, clientX: number, fromTimeMs: number): void {
    if (!viewSpanTargets.length) {
      refreshViewSpanTargets();
    }
    dragTarget = target;
    dragStartClientX = clientX;
    dragStartTimeMs = fromTimeMs;
    ghostX = -1;
    timeCursorDragging.set(true);
    document.addEventListener('mousemove', onDragMove, false);
    document.body.classList.add('prevent-selection');
  }

  function onDragMove(event: MouseEvent): void {
    if (!dragTarget || drawWidth <= 0 || viewDuration <= 0) {
      return;
    }
    snapDisabled = event.altKey;
    // Tracked as a delta from where the drag began rather than from the pointer's absolute position,
    // so no element box has to be measured and the grab point stays under the cursor.
    const deltaMs = ((event.clientX - dragStartClientX) * viewDuration) / drawWidth;
    setCursor(dragTarget, clamp(applySnap(dragStartTimeMs + deltaMs)));
    event.preventDefault();
  }

  function onWindowMouseup(): void {
    if (dragTarget) {
      dragTarget = null;
      viewSpanTargets = [];
      snapLabel = '';
      timeCursorDragging.set(false);
      document.removeEventListener('mousemove', onDragMove, false);
      document.body.classList.remove('prevent-selection');
    }
  }

  function onPillMousedown(target: Cursor, event: MouseEvent): void {
    const current = getCursor(target);
    if (event.button !== 0 || current === null) {
      return;
    }
    event.stopPropagation();
    beginDrag(target, event.clientX, current);
  }

  function onPillAContextmenu(event: MouseEvent): void {
    contextMenuComponent.show(event);
  }

  function onPillAMousedown(event: MouseEvent): void {
    onPillMousedown('A', event);
  }

  function onPillBMousedown(event: MouseEvent): void {
    onPillMousedown('B', event);
  }

  function onPillAKeydown(event: KeyboardEvent): void {
    onPillKeydown('A', event);
  }

  function onPillBKeydown(event: KeyboardEvent): void {
    onPillKeydown('B', event);
  }

  function onOpenInspector(): void {
    dispatch('openInspector');
  }

  function onPillKeydown(target: Cursor, event: KeyboardEvent): void {
    if (getCursor(target) === null || drawWidth <= 0) {
      return;
    }

    // One pixel of time, so a nudge feels the same at every zoom level.
    const pixelMs = viewDuration / drawWidth;

    switch (event.key) {
      case 'ArrowLeft':
        if (event.shiftKey) {
          jumpToSnapTarget(target, -1);
        } else {
          nudge(target, -pixelMs);
        }
        break;
      case 'ArrowRight':
        if (event.shiftKey) {
          jumpToSnapTarget(target, 1);
        } else {
          nudge(target, pixelMs);
        }
        break;
      case 'PageUp':
        nudge(target, -viewDuration * 0.1);
        break;
      case 'PageDown':
        nudge(target, viewDuration * 0.1);
        break;
      case 'Home':
        snapLabel = '';
        setCursor(target, maxTimeRange.start);
        break;
      case 'End':
        snapLabel = '';
        setCursor(target, maxTimeRange.end);
        break;
      case 'Escape':
        (event.currentTarget as HTMLElement).blur();
        event.preventDefault();
        return;
      default:
        // ArrowUp/ArrowDown are deliberately unbound so the page keeps scrolling normally while a
        // pill holds focus.
        return;
    }

    revealCursor(target);
    event.preventDefault();
  }
</script>

<svelte:window on:mouseup={onWindowMouseup} />

<!--
  A dedicated lane for the cursors, in normal flow so it reserves real vertical space rather than
  negotiating negative offsets with the hover cursor's markers. Pressing anywhere along it places the
  cursor and begins a drag in one gesture — the ruler/timebar convention from DAWs, video editors and
  DevTools' performance panel.
-->
<div class="timeline-playhead-lane" style="height: {LANE_HEIGHT}px">
  <div
    aria-hidden="true"
    class="timeline-playhead-lane-track"
    data-testid="timeline-playhead-lane"
    style="left: {marginLeft}px; width: {drawWidth}px"
    on:mousedown={onLaneMousedown}
    on:mousemove={onLaneMousemove}
    on:mouseleave={() => (ghostX = -1)}
  >
    {#if ghostX >= 0 && !dragTarget}
      <div class="timeline-playhead-ghost" style="transform: translateX({ghostX}px)" />
    {/if}

    {#if showCaliper}
      <!-- Dimension line between the two cursors, labelled with the interval it measures. -->
      <div class="caliper-rule" style="left: {caliperLo}px; width: {caliperHi - caliperLo}px" />
      <div class="caliper-tick" style="left: {caliperLo}px" />
      <div class="caliper-tick" style="left: {caliperHi}px" />
      {#if caliperHi - caliperLo > 62}
        <div class="caliper-chip" style="left: {(caliperLo + caliperHi) / 2}px">{compareOffset}</div>
      {/if}
    {/if}

    {#if merged && $timeCursorMs !== null && $timeCursorCompareMs !== null}
      <div class="pill-anchor" style="left: {mergedX}px">
        <div class="merged-chip">
          <TimelinePlayheadPill
            ariaLabel="Time Cursor"
            ariaValueMax={maxTimeRange.end}
            ariaValueMin={maxTimeRange.start}
            ariaValueNow={$timeCursorMs}
            ariaValueText={`${primaryTime} ${$plugins.time.primary.label}`}
            badge="A"
            dragging={dragTarget === 'A'}
            filled
            label={primaryTime}
            testId="time-cursor-a"
            title="Drag to scrub · Alt disables snapping · double-click opens the inspector"
            on:contextmenu={onPillAContextmenu}
            on:dblclick={onOpenInspector}
            on:keydown={onPillAKeydown}
            on:mousedown={onPillAMousedown}
          />
          <TimelinePlayheadPill
            ariaLabel="Comparison Cursor"
            ariaValueMax={maxTimeRange.end}
            ariaValueMin={maxTimeRange.start}
            ariaValueNow={$timeCursorCompareMs}
            ariaValueText={`${compareTime} ${$plugins.time.primary.label}`}
            badge="B"
            dragging={dragTarget === 'B'}
            label={compareTime}
            secondary={compareOffset}
            testId="time-cursor-b"
            title="Comparison cursor — drag to move"
            on:keydown={onPillBKeydown}
            on:mousedown={onPillBMousedown}
          />
        </div>
      </div>
    {:else}
      {#if $timeCursorCompareMs !== null}
        <div class="pill-anchor" style="left: {pillBx}px">
          <TimelinePlayheadPill
            ariaLabel="Comparison Cursor"
            ariaValueMax={maxTimeRange.end}
            ariaValueMin={maxTimeRange.start}
            ariaValueNow={$timeCursorCompareMs}
            ariaValueText={`${compareTime} ${$plugins.time.primary.label}`}
            badge="B"
            dragging={dragTarget === 'B'}
            label={compareTime}
            secondary={compareOffset}
            testId="time-cursor-b"
            title="Comparison cursor — drag to move"
            on:keydown={onPillBKeydown}
            on:mousedown={onPillBMousedown}
          />
        </div>
      {/if}
      {#if $timeCursorMs !== null}
        <div class="pill-anchor" style="left: {pillAx}px">
          <TimelinePlayheadPill
            ariaLabel="Time Cursor"
            ariaValueMax={maxTimeRange.end}
            ariaValueMin={maxTimeRange.start}
            ariaValueNow={$timeCursorMs}
            ariaValueText={`${primaryTime} ${$plugins.time.primary.label}`}
            badge={comparing ? 'A' : ''}
            dragging={dragTarget === 'A'}
            filled
            label={primaryTime}
            testId="time-cursor-a"
            title="Drag to scrub · Alt disables snapping · double-click opens the inspector"
            on:contextmenu={onPillAContextmenu}
            on:dblclick={onOpenInspector}
            on:keydown={onPillAKeydown}
            on:mousedown={onPillAMousedown}
          />
        </div>
      {/if}
    {/if}

    {#if dragTarget && snapLabel}
      <!-- Names what the drag snapped to, so a snap is never silent. -->
      <div class="snap-badge" style="left: {(dragTarget === 'B' ? pillBx : merged ? mergedX : pillAx) + 8}px">
        ⇥ {snapLabel}
      </div>
    {/if}
  </div>
</div>

<div class="timeline-playhead-container">
  {#if cursorBx !== null && cursorBx >= 0 && cursorBx <= drawWidth}
    <div class="cursor-line compare" style="transform: translateX({cursorBx + marginLeft}px)" />
  {/if}
  {#if comparing && cursorAx !== null && cursorBx !== null}
    <!-- Shades the compared interval across every row, so the window under study is unmistakable. -->
    <div
      class="compare-band"
      style="left: {Math.max(0, Math.min(cursorAx, cursorBx)) + marginLeft}px; width: {Math.max(
        0,
        Math.min(drawWidth, Math.max(cursorAx, cursorBx)) - Math.max(0, Math.min(cursorAx, cursorBx)),
      )}px"
    />
  {/if}
  {#if cursorAx !== null && cursorAx >= 0 && cursorAx <= drawWidth}
    <div class="cursor-line" style="transform: translateX({cursorAx + marginLeft}px)" />
  {/if}
</div>

<ContextMenuInternal bind:this={contextMenuComponent}>
  <ContextMenu.Item size="sm" on:click={() => dispatch('openInspector')}>Open Time Cursor Inspector</ContextMenu.Item>
  <ContextMenu.Item size="sm" on:click={toggleCompare}>
    {comparing ? 'Exit Comparison Mode' : 'Compare With Another Time'}
  </ContextMenu.Item>
  <ContextMenu.Separator />
  <ContextMenu.Item size="sm" on:click={() => $timeCursorMs !== null && centerViewOn($timeCursorMs)}>
    Center View on Cursor
  </ContextMenu.Item>
  <ContextMenu.Item size="sm" on:click={copyCursorTime}>Copy Cursor Time</ContextMenu.Item>
  {#if !readOnly}
    <ContextMenu.Item size="sm" on:click={pinAsVerticalGuide}>Pin as Vertical Guide</ContextMenu.Item>
  {/if}
  <ContextMenu.Separator />
  <ContextMenu.Item size="sm" on:click={clearCursors}>Clear Time Cursor</ContextMenu.Item>
</ContextMenuInternal>

<style>
  .timeline-playhead-lane {
    background: var(--st-gray-10, #f5f6f7);
    border-bottom: 1px solid var(--st-gray-20, #ebecf0);
    border-top: 1px solid var(--st-gray-20, #ebecf0);
    position: relative;
    width: 100%;
  }

  .timeline-playhead-lane-track {
    cursor: pointer;
    height: 100%;
    position: absolute;
    top: 0;
  }

  /* Faint preview of where a press would drop the cursor. */
  .timeline-playhead-ghost {
    background: #2563eb;
    height: 100%;
    left: -0.5px;
    opacity: 0.35;
    pointer-events: none;
    position: absolute;
    top: 0;
    width: 1px;
  }

  .pill-anchor {
    position: absolute;
    top: 1px;
    transform: translateX(-50%);
    z-index: 3;
  }

  .merged-chip {
    display: flex;
    gap: 2px;
  }

  .caliper-rule {
    border-top: 1.5px solid #2563eb;
    height: 0;
    opacity: 0.85;
    pointer-events: none;
    position: absolute;
    top: 11px;
  }

  .caliper-tick {
    border-left: 1.5px solid #2563eb;
    height: 9px;
    opacity: 0.85;
    pointer-events: none;
    position: absolute;
    top: 7px;
    width: 0;
  }

  .caliper-chip {
    background: #ffffff;
    border: 1px solid #2563eb;
    border-radius: 9px;
    color: #2563eb;
    font-size: 9.5px;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    padding: 1px 7px;
    pointer-events: none;
    position: absolute;
    top: 4px;
    transform: translateX(-50%);
    white-space: nowrap;
    z-index: 4;
  }

  .snap-badge {
    background: #b7791f;
    border-radius: 3px;
    color: #ffffff;
    font-size: 9px;
    padding: 2px 6px;
    pointer-events: none;
    position: absolute;
    top: 4px;
    white-space: nowrap;
    z-index: 5;
  }

  .timeline-playhead-container {
    height: 100%;
    pointer-events: none;
    position: absolute;
    width: 100%;
    z-index: 5;
  }

  .cursor-line {
    background: #2563eb;
    height: 100%;
    left: -0.5px;
    /* Must not swallow row interactions as it passes over them. */
    pointer-events: none;
    position: absolute;
    top: 0;
    width: 1px;
  }

  .cursor-line.compare {
    background: #0f766e;
    border-left: 1px dashed #0f766e;
    opacity: 0.9;
    width: 0;
  }

  .compare-band {
    background: #2563eb;
    height: 100%;
    opacity: 0.06;
    pointer-events: none;
    position: absolute;
    top: 0;
  }
</style>
