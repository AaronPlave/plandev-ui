<svelte:options immutable={true} />

<!--
  Two activities a person picked, side by side: what each record says, and the differences computed from them. It
  never says the two are the same event; the person reads the evidence. The reference is A, the selection is B, and
  every difference is B − A.
-->
<script lang="ts">
  import { Button } from '@nasa-jpl/stellar-svelte';
  import { createEventDispatcher } from 'svelte';
  import { plugins } from '../../stores/plugins';
  import type { AnalysisActivityDetails } from '../../utilities/analysisActivityDetails';
  import { compareActivities, describeComparison, formatDelta } from '../../utilities/analysisCompare';
  import { formatDate } from '../../utilities/time';

  export let readOnly: boolean = false;
  export let reference: AnalysisActivityDetails;
  export let selected: AnalysisActivityDetails;
  export let sourceLabels: Record<string, string> = {};

  const dispatch = createEventDispatcher<{ clear: void; saveNote: string; selectReference: void }>();

  let showSame: boolean = false;

  $: comparison = compareActivities(reference, selected);
  $: labelA = sourceLabels[reference.ref.sourceId] ?? reference.ref.sourceId;
  $: labelB = sourceLabels[selected.ref.sourceId] ?? selected.ref.sourceId;
  $: differing = comparison.parameters.filter(parameter => parameter.status !== 'same');
  $: same = comparison.parameters.filter(parameter => parameter.status === 'same');

  function time(ms: number | null): string {
    return ms === null ? '—' : formatDate(new Date(ms), $plugins.time.primary.format);
  }

  function value(v: unknown): string {
    return v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v);
  }
</script>

<section class="comparison" aria-label="Comparison">
  <div class="heading">
    <span class="st-typography-medium">Comparison</span>
    <span class="computed" title="Differences are computed from the two records' own values, selection minus reference"
      >computed, B − A</span
    >
    <span class="grow" />
    {#if !readOnly}
      <Button
        size="xs"
        variant="outline"
        title="Add a note at the selected activity with these computed differences"
        on:click={() =>
          dispatch(
            'saveNote',
            describeComparison(
              { ...reference, sourceLabel: labelA },
              { ...selected, sourceLabel: labelB },
              comparison,
            ),
          )}>Save as note</Button
      >
    {/if}
    <Button size="xs" variant="ghost" on:click={() => dispatch('clear')}>Clear</Button>
  </div>
  <table>
    <thead>
      <tr>
        <th />
        <th>
          <button class="link" title="Select the reference" on:click={() => dispatch('selectReference')}>A · reference</button>
        </th>
        <th>B · selected</th>
        <th>B − A</th>
      </tr>
    </thead>
    <tbody>
      <tr><th>Source</th><td>{labelA}</td><td>{labelB}</td><td>{comparison.sameSource ? 'same data' : 'different data'}</td></tr>
      <tr><th>Name</th><td>{reference.name}</td><td>{selected.name}</td><td /></tr>
      <tr><th>Type</th><td>{reference.type}</td><td>{selected.type}</td><td>{comparison.sameType ? 'same' : 'different'}</td></tr>
      <tr><th>Record</th><td>{reference.key}</td><td>{selected.key}</td><td>{comparison.sameKey ? 'same key' : 'different key'}</td></tr>
      <tr>
        <th>Start</th><td>{time(reference.startMs)}</td><td>{time(selected.startMs)}</td>
        <td class="delta">{formatDelta(comparison.startDeltaMs)}</td>
      </tr>
      <tr>
        <th>End</th><td>{time(reference.endMs)}</td><td>{time(selected.endMs)}</td>
        <td class="delta">{comparison.endDeltaMs === null ? '—' : formatDelta(comparison.endDeltaMs)}</td>
      </tr>
      <tr>
        <th>Duration</th>
        <td>{reference.endMs === null ? '—' : formatDelta(reference.endMs - reference.startMs).slice(1) || '0s'}</td>
        <td>{selected.endMs === null ? '—' : formatDelta(selected.endMs - selected.startMs).slice(1) || '0s'}</td>
        <td class="delta">{comparison.durationDeltaMs === null ? '—' : formatDelta(comparison.durationDeltaMs)}</td>
      </tr>
      <tr>
        <th>In time</th>
        <td colspan="3">
          {comparison.interval.kind === 'overlap' ? 'Overlap for' : 'Apart by'}
          {formatDelta(comparison.interval.ms).slice(1) || '0s'}
        </td>
      </tr>
      {#each differing as parameter (parameter.name)}
        <tr class:conflict={parameter.status === 'differs'}>
          <th>{parameter.name}</th>
          <td>{value(parameter.a)}</td>
          <td>{value(parameter.b)}</td>
          <td>
            {#if parameter.status === 'differs'}
              {typeof parameter.a === 'number' && typeof parameter.b === 'number'
                ? `${parameter.b - parameter.a > 0 ? '+' : ''}${parameter.b - parameter.a}`
                : 'differs'}
            {:else}
              only in {parameter.status === 'onlyA' ? 'A' : 'B'}
            {/if}
          </td>
        </tr>
      {/each}
      {#if showSame}
        {#each same as parameter (parameter.name)}
          <tr><th>{parameter.name}</th><td>{value(parameter.a)}</td><td>{value(parameter.b)}</td><td>same</td></tr>
        {/each}
      {/if}
    </tbody>
  </table>
  {#if same.length}
    <button class="link" on:click={() => (showSame = !showSame)}>
      {showSame ? 'Hide' : 'Show'} the {same.length} parameter{same.length === 1 ? '' : 's'} with the same value
    </button>
  {/if}
  {#each comparison.notes as note}
    <div class="note" role="note">{note}</div>
  {/each}
  <div class="hint">
    Chosen by you: nothing here establishes that the two records describe the same event.
  </div>
</section>

<style>
  .comparison {
    background: var(--st-gray-10);
    border: 1px solid var(--st-gray-20);
    border-radius: 4px;
    margin-bottom: 10px;
    padding: 6px;
  }

  .heading {
    align-items: center;
    display: flex;
    gap: 6px;
    margin-bottom: 4px;
  }

  .grow {
    flex: 1;
  }

  .computed {
    color: var(--st-gray-60);
    font-size: 11px;
  }

  table {
    border-collapse: collapse;
    font-size: 11px;
    width: 100%;
  }

  tbody th,
  thead th,
  .delta {
    white-space: nowrap;
  }

  th,
  td {
    border-top: 1px solid var(--st-gray-20);
    font-weight: normal;
    padding: 2px 4px;
    text-align: left;
    overflow-wrap: anywhere;
    vertical-align: top;
  }

  thead th,
  tbody th {
    color: var(--st-gray-60);
  }

  .delta {
    font-variant-numeric: tabular-nums;
    font-weight: 500;
    white-space: nowrap;
  }

  .conflict td {
    background: rgba(219, 81, 57, 0.08);
  }

  .link {
    background: none;
    border: 0;
    color: var(--st-utility-blue);
    cursor: pointer;
    font: inherit;
    padding: 2px 0;
    text-align: left;
  }

  .note {
    border-left: 2px solid var(--st-warning-yellow, #e6b300);
    margin-top: 4px;
    padding-left: 6px;
  }

  .hint {
    color: var(--st-gray-60);
    margin-top: 4px;
  }
</style>
