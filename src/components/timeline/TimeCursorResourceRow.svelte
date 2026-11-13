<svelte:options immutable={true} />

<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { ValueSchema } from '../../types/schema';
  import type { Resource } from '../../types/simulation';
  import { atTimeBasisLabels, explainAtTime, type AtTimeValue } from '../../utilities/analysisAtTime';
  import {
    formatResourceNumber,
    formatResourceValue,
    getResourceDecimals,
    getResourceSparkline,
    getResourceValueAtTime,
    getResourceWindowStats,
    getSparklineY,
    isNumericSchema,
  } from '../../utilities/resources';

  export let compareTimeMs: number | null = null;
  export let cursorTimeMs: number;
  export let domainEndMs: number;
  export let domainStartMs: number;
  export let expanded: boolean = false;
  export let interpolate: boolean = false;
  export let name: string;
  /**
   * An Analysis reads each value from its source at the instant, and says what the value is (a recorded sample, one
   * held from an earlier sample, a line between samples...). When given, they replace the value found in `resource`,
   * which then only draws the sparkline; there are no window statistics, which would be of thinned display data.
   */
  export let readingA: AtTimeValue | null = null;
  export let readingB: AtTimeValue | null = null;
  /** The source the value is of, shown under the name (an Analysis has several, with resources of the same name). */
  export let sourceLabel: string = '';
  /** Formats the time a reading's explanation names. */
  export let formatTime: (ms: number) => string = ms => new Date(ms).toISOString();
  export let resource: Resource;
  export let schema: ValueSchema;
  export let showStats: boolean = false;
  /** True when a constraint violation covers the cursor for this resource. */
  export let violating: boolean = false;
  export let watched: boolean = false;

  const SPARK_HEIGHT = 17;

  const dispatch = createEventDispatcher<{
    toggle: void;
    unwatch: void;
  }>();

  $: comparing = compareTimeMs !== null;
  $: sparkWidth = comparing ? 34 : 46;
  $: numeric = isNumericSchema(schema);
  $: decimals = getResourceDecimals(schema);

  $: unit = schema.metadata?.unit?.value ?? '';

  $: valueA = readingA ? fromReading(readingA) : getResourceValueAtTime(resource, cursorTimeMs, interpolate);
  $: valueB =
    compareTimeMs === null
      ? null
      : readingB
        ? fromReading(readingB)
        : readingA
          ? { isGap: true, value: null }
          : getResourceValueAtTime(resource, compareTimeMs, interpolate);
  $: delta =
    numeric && typeof valueA.value === 'number' && typeof valueB?.value === 'number'
      ? valueB.value - valueA.value
      : null;

  $: stats =
    numeric && compareTimeMs !== null && !readingA
      ? getResourceWindowStats(resource, cursorTimeMs, compareTimeMs)
      : null;

  $: spark = numeric ? getResourceSparkline(resource, domainStartMs, domainEndMs, sparkWidth, SPARK_HEIGHT) : null;
  $: sparkAx = sparkX(cursorTimeMs);
  $: sparkBx = compareTimeMs === null ? null : sparkX(compareTimeMs);

  /** Time integral over the compared window, in the resource's own unit composed with hours. */
  $: integral =
    stats && stats.durationMs > 0 ? { unit: unit ? `${unit}·h` : 'h', value: stats.area / 3_600_000 } : null;

  /** A reading as the row shows a value: nothing to show for a gap or for what could not be read. */
  function fromReading(reading: AtTimeValue) {
    const none = reading.basis === 'gap' || reading.basis === 'unavailable';
    return { isGap: none, value: none ? null : reading.value };
  }

  function basisLine(reading: AtTimeValue | null): string {
    return reading ? atTimeBasisLabels[reading.basis] : '';
  }

  function sparkX(timeMs: number): number {
    if (domainEndMs <= domainStartMs) {
      return 0;
    }
    const x = ((timeMs - domainStartMs) / (domainEndMs - domainStartMs)) * sparkWidth;
    return Math.max(0, Math.min(sparkWidth, x));
  }

  function display(value: number | string | null, isGap: boolean): string {
    if (isGap) {
      return 'no data';
    }
    if (value === null) {
      return '–';
    }
    // Numeric resources go through the compact formatter so a column of values stays aligned and
    // legible; anything else keeps its own rendering (enum label, duration string, struct JSON).
    return numeric && typeof value === 'number'
      ? formatResourceNumber(value, decimals)
      : formatResourceValue(value, schema, false);
  }
</script>

<div class="row" class:expanded class:violating>
  <button class="row-head" class:comparing class:with-stats={showStats && !!stats} on:click={() => dispatch('toggle')}>
    <span class="label">
      <span class="name" title={name}>
        {name}
        {#if watched}<span class="watched-tag">watched</span>{/if}
      </span>
      {#if readingA}
        <span class="sub" title={sourceLabel}>
          {sourceLabel} · {basisLine(readingA)}{comparing && readingB ? ` / ${basisLine(readingB)}` : ''}
        </span>
      {/if}
      {#if unit && (comparing || showStats)}
        <span class="sub font-mono">{unit}</span>
      {/if}
    </span>

    <span class="spark" style="width: {sparkWidth}px">
      {#if spark}
        <svg width={sparkWidth} height={SPARK_HEIGHT} aria-hidden="true">
          <path d={spark.d} fill="none" stroke="currentColor" stroke-width="1" opacity="0.45" />
          {#if sparkBx !== null && typeof valueB?.value === 'number'}
            <circle cx={sparkBx} cy={getSparklineY(spark, valueB.value, SPARK_HEIGHT)} r="2" class="dot-b" />
          {/if}
          {#if typeof valueA.value === 'number'}
            <circle cx={sparkAx} cy={getSparklineY(spark, valueA.value, SPARK_HEIGHT)} r="2.3" class="dot-a" />
          {/if}
        </svg>
      {/if}
    </span>

    {#if showStats && stats}
      <span class="value muted font-mono">{formatResourceNumber(stats.min, decimals)}</span>
      <span class="value font-mono">{formatResourceNumber(stats.avg, decimals)}</span>
      <span class="value muted font-mono">{formatResourceNumber(stats.max, decimals)}</span>
    {:else if comparing}
      <span class="value font-mono" class:is-gap={valueA.isGap}>{display(valueA.value, valueA.isGap)}</span>
      <span class="value value-b font-mono" class:is-gap={valueB?.isGap}
        >{display(valueB?.value ?? null, !!valueB?.isGap)}</span
      >
      <span class="value delta font-mono" class:up={(delta ?? 0) > 0} class:down={(delta ?? 0) < 0}>
        {delta === null ? '–' : `${delta > 0 ? '+' : ''}${formatResourceNumber(delta, decimals)}`}
      </span>
    {:else}
      <span class="value-stack">
        <span class="value single font-mono" class:is-gap={valueA.isGap}>
          {display(valueA.value, valueA.isGap)}
        </span>
        {#if unit}
          <span class="sub font-mono">{unit}</span>
        {/if}
      </span>
    {/if}
  </button>

  {#if expanded}
    <div class="detail">
      <div class="detail-path font-mono">{name}{unit ? ` (${unit})` : ''}</div>
      <div class="detail-grid">
        <div class="cell">
          <span class="cell-label">{comparing ? 'At A' : 'Value'}</span>
          <span class="cell-value font-mono">{display(valueA.value, valueA.isGap)}</span>
        </div>
        {#if comparing && valueB}
          <div class="cell">
            <span class="cell-label">At B</span>
            <span class="cell-value value-b font-mono">{display(valueB.value, valueB.isGap)}</span>
          </div>
          <div class="cell">
            <span class="cell-label">Change</span>
            <span class="cell-value font-mono" class:up={(delta ?? 0) > 0} class:down={(delta ?? 0) < 0}>
              {delta === null ? '–' : `${delta > 0 ? '+' : ''}${formatResourceNumber(delta, decimals)}`}
            </span>
          </div>
        {/if}
        {#if stats}
          <div class="cell">
            <span class="cell-label">Window min</span>
            <span class="cell-value font-mono">{formatResourceNumber(stats.min, decimals)}</span>
          </div>
          <div class="cell">
            <span class="cell-label">Time-wtd avg</span>
            <span class="cell-value font-mono">{formatResourceNumber(stats.avg, decimals)}</span>
          </div>
          <div class="cell">
            <span class="cell-label">Window max</span>
            <span class="cell-value font-mono">{formatResourceNumber(stats.max, decimals)}</span>
          </div>
          {#if integral}
            <!--
              A time integral is only meaningful for some resources (a rate integrates to a total; a
              temperature does not), and nothing in the schema says which. So it is offered here on
              request rather than volunteered in the collapsed row, and labelled with the composed
              unit so the reader can judge whether it means anything.
            -->
            <div class="cell">
              <span class="cell-label">∫ v·dt</span>
              <span class="cell-value integral font-mono">
                {formatResourceNumber(integral.value, 2)}
                {integral.unit}
              </span>
            </div>
          {/if}
        {/if}
      </div>
      {#if readingA}
        <div class="detail-note">
          {comparing ? 'A: ' : ''}{explainAtTime(readingA, cursorTimeMs, formatTime)}
        </div>
        {#if comparing && readingB && compareTimeMs !== null}
          <div class="detail-note">B: {explainAtTime(readingB, compareTimeMs, formatTime)}</div>
        {/if}
      {/if}
      {#if stats}
        <div class="detail-note">
          {stats.sampleCount} samples in window · range {formatResourceNumber(stats.max - stats.min, decimals)}
        </div>
      {/if}
      {#if watched}
        <button class="unwatch" on:click|stopPropagation={() => dispatch('unwatch')}>Stop watching</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .row {
    border-bottom: 1px solid var(--st-gray-15, #f4f5f7);
    color: var(--st-utility-blue, #2f80ed);
  }

  .row.violating {
    background: #fdf4f3;
  }

  .row-head {
    align-items: center;
    background: none;
    border: none;
    cursor: pointer;
    display: grid;
    /* One numeric column width for every row, so alignment never depends on a row's magnitude. */
    grid-template-columns: minmax(0, 1fr) auto 74px;
    padding: 5px 0;
    text-align: left;
    width: 100%;
  }

  .row-head.comparing,
  .row-head.with-stats {
    column-gap: 8px;
    grid-template-columns: minmax(0, 1fr) auto repeat(3, 58px);
  }

  .row.expanded .row-head {
    background: #f4f7fb;
  }

  .label {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    padding-right: 8px;
  }

  .name {
    color: var(--st-gray-100, #17181a);
    font-size: 11.5px;
    font-weight: 500;
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Muted monospace secondary line — the unit, given a slot of its own rather than parenthesised
     inside the value where it competes with the number. */
  .sub {
    color: var(--st-gray-50, #8b8f96);
    font-size: 9.5px;
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .value-stack {
    display: flex;
    flex-direction: column;
    gap: 1px;
    text-align: right;
  }

  .watched-tag {
    color: var(--st-gray-40, #a9adb4);
    font-size: 9px;
    text-transform: uppercase;
  }

  .spark {
    color: currentColor;
    display: block;
    flex-shrink: 0;
    line-height: 0;
  }

  .dot-a {
    fill: var(--st-utility-blue, #2f80ed);
  }

  .dot-b {
    fill: #0f766e;
  }

  .value {
    color: var(--st-gray-100, #17181a);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    font-weight: 500;
    overflow: hidden;
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .value.single {
    font-size: 12.5px;
  }

  .value.muted {
    color: var(--st-gray-70, #4c4f55);
    font-weight: 400;
  }

  .value.is-gap {
    color: var(--st-gray-40, #a9adb4);
    font-style: italic;
    font-weight: 400;
  }

  .value-b {
    color: #0f766e;
  }

  .delta {
    color: var(--st-gray-40, #a9adb4);
    font-size: 11px;
  }

  .delta.up,
  .cell-value.up {
    color: #2f7d3a;
  }

  .delta.down,
  .cell-value.down {
    color: #b8453c;
  }

  .row.violating .value {
    color: #b8453c;
  }

  .detail {
    background: #f4f7fb;
    padding: 2px 0 10px;
  }

  .detail-path {
    color: var(--st-gray-50, #8b8f96);
    font-size: 9.5px;
    margin-bottom: 8px;
    word-break: break-all;
  }

  .detail-grid {
    column-gap: 8px;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    row-gap: 9px;
  }

  .cell {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .cell-label {
    color: var(--st-gray-50, #8b8f96);
    font-size: 8.5px;
    font-weight: 700;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }

  .cell-value {
    color: var(--st-gray-100, #17181a);
    font-size: 11.5px;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  .cell-value.integral {
    color: #1f4e79;
  }

  .detail-note {
    color: var(--st-gray-50, #8b8f96);
    font-size: 9px;
    margin-top: 8px;
  }

  .unwatch {
    background: none;
    border: none;
    color: var(--st-utility-blue, #2f80ed);
    cursor: pointer;
    font-size: 10px;
    margin-top: 8px;
    padding: 0;
    text-decoration: underline;
  }
</style>
