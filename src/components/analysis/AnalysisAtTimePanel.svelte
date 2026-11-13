<svelte:options immutable={true} />

<!--
  What the analysis's sources say at the pinned inspection time (see stores/analysisInspection.ts).

  Resources: the ones the timeline's rows draw, each read at that instant from its own source and labelled for what
  the value is: a recorded sample, a sample still held, a line between samples, a value computed from a simulation, or
  unavailable (with why). Imported resources are read with one exact, one-instant query per revision, not from the
  display data the rows hold (which is thinned to the screen).

  Activities: those of each source that overlap the instant, asked of the database (never loaded whole): the first few
  per source and how many there are in all.

  Nothing is read while the time is being dragged: the queries run once it has settled.
-->
<script lang="ts">
  import { Button } from '@nasa-jpl/stellar-svelte';
  import { Crosshair } from 'lucide-svelte';
  import { debounce } from 'lodash-es';
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { analysisSimulationDatasets, analysisSourceRevisions, selectedAnalysisActivity } from '../../stores/analysis';
  import { inspectMode, inspectTimeMs } from '../../stores/analysisInspection';
  import { plugins } from '../../stores/plugins';
  import { getTimelineResourceState } from '../../stores/timelineResourceStatus';
  import { view } from '../../stores/views';
  import type {
    AnalysisActivityRef,
    AnalysisActivityRow,
    AnalysisSimulationDataset,
    AnalysisSourceBinding,
    AnalysisSourceRevision,
  } from '../../types/analysis';
  import type { User } from '../../types/app';
  import type { SourceQueryResult } from '../../utilities/importedResource';
  import {
    MAX_INSPECTED_RESOURCES,
    formatAtTimeValue,
    getImportedValueAt,
    getInspectedResources,
    getInstantQuery,
    getSimulatedValueAt,
    type AtTimeBasis,
    type AtTimeValue,
    type InspectedResource,
  } from '../../utilities/analysisAtTime';
  import {
    analysisActivityRefsEqual,
    getAnalysisActivityOrderBy,
    getAnalysisActivityRowRef,
    getAnalysisActivityWhere,
  } from '../../utilities/analysis';
  import effects from '../../utilities/effects';
  import { convertUsToDurationString, formatDate } from '../../utilities/time';

  export let bindings: AnalysisSourceBinding[] = [];
  export let sourceLabels: Record<string, string> = {};
  export let user: User | null;

  const dispatch = createEventDispatcher<{
    reveal: number;
    selectActivity: { endMs: number; ref: AnalysisActivityRef; startMs: number };
  }>();

  /** Activities listed per source; the rest are counted. */
  const ACTIVITIES_PER_SOURCE = 20;
  /** Resources per request: the gateway accepts up to 200. */
  const RESOURCES_PER_REQUEST = 100;
  /** How long the pinned time must be still before anything is read. */
  const SETTLE_MS = 250;

  type ResourceReading = { reading: AtTimeValue; resource: InspectedResource; units: string | null };
  type ActivityListing = { rows: AnalysisActivityRow[]; sourceId: string; total: number };

  let readings: ResourceReading[] = [];
  let listings: ActivityListing[] = [];
  let error: string = '';
  let loading: boolean = false;
  /** The instant `readings` and `listings` are of (they lag the pinned time while it moves and settles). */
  let readAt: number | null = null;
  let request = 0;

  $: timeline = $view?.definition.plan.timelines[0];
  $: inspected = getInspectedResources(timeline);
  // The rows change often (heights, selection); only the set of resources, the sources and the time matter.
  $: inspectedKey = inspected.map(({ name, sourceId }) => `${sourceId}::${name}`).join('|');
  $: bindingsKey = bindings.map(binding => JSON.stringify(binding)).join('|');
  $: dataKey = `${$analysisSourceRevisions.length}:${$analysisSimulationDatasets.length}`;
  $: schedule($inspectTimeMs, inspectedKey, bindingsKey, dataKey);
  $: groups = groupByRow(readings);
  $: selected = $selectedAnalysisActivity;
  $: outsideLimit = inspected.length > MAX_INSPECTED_RESOURCES;

  const run = debounce(read, SETTLE_MS);

  function schedule(time: number | null, ..._keys: string[]) {
    if (time === null) {
      run.cancel();
      request++;
      readings = [];
      listings = [];
      readAt = null;
      loading = false;
      error = '';
      return;
    }
    loading = true;
    run(time);
  }

  onDestroy(() => {
    run.cancel();
    request++;
  });

  function groupByRow(all: ResourceReading[]) {
    const byRow = new Map<number, { name: string; readings: ResourceReading[] }>();
    all.forEach(entry => {
      const group = byRow.get(entry.resource.rowId) ?? { name: entry.resource.rowName, readings: [] };
      group.readings.push(entry);
      byRow.set(entry.resource.rowId, group);
    });
    return [...byRow.values()];
  }

  function unavailable(resource: InspectedResource, note: string): ResourceReading {
    return { reading: { basis: 'unavailable', note, value: null }, resource, units: null };
  }

  async function readResources(
    time: number,
    specs: InspectedResource[],
    revisions: AnalysisSourceRevision[],
    datasets: AnalysisSimulationDataset[],
  ): Promise<ResourceReading[]> {
    const bySource = new Map<string, InspectedResource[]>();
    specs.forEach(spec => bySource.set(spec.sourceId, [...(bySource.get(spec.sourceId) ?? []), spec]));
    const out = new Map<InspectedResource, ResourceReading>();
    await Promise.all(
      [...bySource.entries()].map(async ([sourceId, members]) => {
        const binding = bindings.find(({ id }) => id === sourceId);
        if (!binding) {
          members.forEach(member => out.set(member, unavailable(member, 'Not a source of this analysis')));
        } else if (binding.kind === 'imported') {
          const revision = revisions.find(({ id }) => id === binding.revisionId);
          if (!revision || revision.status !== 'success') {
            members.forEach(member => out.set(member, unavailable(member, 'The source has no data to read')));
            return;
          }
          const definitions = new Map(revision.resources.map(resource => [resource.key, resource]));
          const known = members.filter(member => definitions.has(member.name));
          members
            .filter(member => !definitions.has(member.name))
            .forEach(member => out.set(member, unavailable(member, 'Not a resource of this source')));
          for (let i = 0; i < known.length; i += RESOURCES_PER_REQUEST) {
            const slice = known.slice(i, i + RESOURCES_PER_REQUEST);
            try {
              const response = await effects.querySourceResources(
                { revisionId: revision.id },
                slice.map(({ name }) => name),
                getInstantQuery(time),
                user,
              );
              const byName = new Map<string, SourceQueryResult>(response.results.map(r => [r.resource, r]));
              slice.forEach(member => {
                const definition = definitions.get(member.name)!;
                const result = byName.get(member.name);
                out.set(member, {
                  reading: result
                    ? getImportedValueAt(time, result, {
                        coverageEnd: Date.parse(definition.coverage_end ?? revision.coverage_end ?? ''),
                        interpolation: definition.interpolation,
                        numeric: definition.numeric,
                      })
                    : { basis: 'unavailable', note: 'The source returned nothing for it', value: null },
                  resource: member,
                  units: definition.units,
                });
              });
            } catch (e) {
              slice.forEach(member => out.set(member, unavailable(member, (e as Error).message || 'The read failed')));
            }
          }
        } else if (binding.kind === 'simulation') {
          const dataset = datasets.find(({ id }) => id === binding.simulationDatasetId);
          members.forEach(member => {
            const state = dataset ? getTimelineResourceState(dataset.dataset_id, member.name, 'sim') : undefined;
            out.set(
              member,
              state?.resource
                ? { reading: getSimulatedValueAt(state.resource.values, time), resource: member, units: null }
                : unavailable(member, state?.error || 'Not loaded: the timeline has not read this resource yet'),
            );
          });
        } else {
          members.forEach(member => out.set(member, unavailable(member, 'A plan has no resources')));
        }
      }),
    );
    return specs.map(spec => out.get(spec)!);
  }

  async function readActivities(time: number): Promise<ActivityListing[]> {
    const instant = { end: time, start: time };
    return Promise.all(
      bindings.map(async binding => {
        const where = getAnalysisActivityWhere(bindings, {
          sourceIds: [binding.id],
          text: '',
          timeRange: instant,
          types: null,
        });
        const [rows, total] = await Promise.all([
          effects.getAnalysisActivities(where, getAnalysisActivityOrderBy('desc'), 0, ACTIVITIES_PER_SOURCE, user),
          effects.getAnalysisActivityCount(where, user),
        ]);
        return { rows, sourceId: binding.id, total };
      }),
    );
  }

  async function read(time: number) {
    const id = ++request;
    loading = true;
    try {
      const [nextReadings, nextListings] = await Promise.all([
        readResources(
          time,
          inspected.slice(0, MAX_INSPECTED_RESOURCES),
          $analysisSourceRevisions,
          $analysisSimulationDatasets,
        ),
        readActivities(time),
      ]);
      if (id === request) {
        readings = nextReadings;
        listings = nextListings;
        readAt = time;
        error = '';
      }
    } catch (e) {
      if (id === request) {
        error = (e as Error).message || 'The read failed';
      }
    }
    if (id === request) {
      loading = false;
    }
  }

  function formatTime(ms: number): string {
    return formatDate(new Date(ms), $plugins.time.primary.format);
  }

  /** How far `ms` is from the pinned time, to its two largest units: "−2y 202d", "+55s". */
  function offset(ms: number, from: number): string {
    const delta = ms - from;
    const span =
      convertUsToDurationString(Math.abs(delta) * 1000)
        .split(' ')
        .slice(0, 2)
        .join(' ') || '0s';
    return `${delta < 0 ? '−' : '+'}${span}`;
  }

  const basisLabels: Record<AtTimeBasis, string> = {
    computed: 'Computed',
    gap: 'Gap',
    held: 'Held',
    interpolated: 'Interpolated',
    sample: 'Sample',
    unavailable: 'Unavailable',
  };

  /** What the value is, in words, with the times it rests on. */
  function explain(reading: AtTimeValue, time: number): string {
    const sample = reading.sampleMs;
    const next = reading.nextMs;
    switch (reading.basis) {
      case 'sample':
        return `Recorded at ${formatTime(sample ?? time)}${reading.approximate ? ' (approximate response)' : ''}`;
      case 'held':
        return `Last sample ${offset(sample!, time)} (${formatTime(sample!)}) still in effect${next ? `; next sample ${offset(next, time)}` : ''}`;
      case 'interpolated':
        return `A straight line between the samples at ${offset(sample!, time)} and ${offset(next!, time)}; not recorded`;
      case 'computed':
        return `Read off the simulation's profile${sample !== undefined ? ` (segment from ${offset(sample, time)}${next ? ` to ${offset(next, time)}` : ''})` : ''}; not a recorded sample`;
      case 'gap':
        return `The source records no data here${sample !== undefined ? ` (from ${formatTime(sample)})` : ''}`;
      default:
        return reading.note ?? '';
    }
  }

  function select(row: AnalysisActivityRow) {
    const ref = getAnalysisActivityRowRef(bindings, row);
    if (ref) {
      const startMs = Date.parse(row.start_time);
      dispatch('selectActivity', { endMs: row.end_time ? Date.parse(row.end_time) : startMs, ref, startMs });
    }
  }
</script>

<div class="at-time">
  <div class="time-bar">
    <Crosshair size={14} class="shrink-0 text-muted-foreground" />
    {#if $inspectTimeMs === null}
      <span class="text-muted-foreground">No time pinned</span>
    {:else}
      <span class="st-typography-medium time" aria-label="Inspection time">
        {formatTime($inspectTimeMs)}
        {$plugins.time.primary.label}
      </span>
    {/if}
    <span class="grow" />
    <Button
      size="xs"
      variant={$inspectMode ? 'default' : 'outline'}
      aria-pressed={$inspectMode}
      on:click={() => ($inspectMode = !$inspectMode)}>{$inspectTimeMs === null ? 'Pin a time' : 'Move'}</Button
    >
    {#if $inspectTimeMs !== null}
      <Button
        size="xs"
        variant="outline"
        title="Bring the pinned time into view on the timeline"
        on:click={() => $inspectTimeMs !== null && dispatch('reveal', $inspectTimeMs)}>Show</Button
      >
      <Button size="xs" variant="outline" on:click={() => ($inspectTimeMs = null)}>Clear</Button>
    {/if}
  </div>

  {#if $inspectTimeMs === null}
    <div class="empty">
      Pin a time on the timeline to see what each source says then. Turn on <span class="st-typography-medium"
        >Inspect time</span
      >
      and click, or drag, where you want to look. The pinned time stays put while you zoom and pan.
    </div>
  {:else}
    <div class="body" class:stale={loading}>
      {#if readAt !== null && readAt !== $inspectTimeMs}
        <div class="note">Updating…</div>
      {/if}
      {#if error}
        <div class="note error" role="alert">{error}</div>
      {/if}

      <section aria-label="Resource values at the pinned time">
        <h3 class="st-typography-medium">Resources</h3>
        {#if !inspected.length}
          <div class="note">
            No resource is on the timeline. Only the resources the timeline's rows draw are read at a time.
          </div>
        {/if}
        {#each groups as group (group.name + group.readings[0].resource.rowId)}
          <div class="row-name st-typography-label">{group.name}</div>
          {#each group.readings as { reading, resource, units } (resource.sourceId + resource.name)}
            <div class="reading" class:muted={reading.basis === 'unavailable'}>
              <div class="reading-line">
                <span class="resource-name" title={resource.name}>{resource.name}</span>
                <span class="value" class:none={reading.value === null}>
                  {reading.basis === 'unavailable' || reading.basis === 'gap' ? '—' : formatAtTimeValue(reading.value)}
                  {#if units && reading.value !== null}<span class="units">{units}</span>{/if}
                </span>
                <span class="basis {reading.basis}">{basisLabels[reading.basis]}</span>
              </div>
              <div class="detail">
                <span class="source-label">{sourceLabels[resource.sourceId] ?? resource.sourceId}</span>
                · {explain(reading, readAt ?? $inspectTimeMs)}
              </div>
            </div>
          {/each}
        {/each}
        {#if outsideLimit}
          <div class="note">
            Showing the first {MAX_INSPECTED_RESOURCES} of {inspected.length} resources on the timeline.
          </div>
        {/if}
      </section>

      <section aria-label="Activities overlapping the pinned time">
        <h3 class="st-typography-medium">Activities</h3>
        {#each listings as listing (listing.sourceId)}
          {@const binding = bindings.find(({ id }) => id === listing.sourceId)}
          <div class="row-name st-typography-label">
            {sourceLabels[listing.sourceId] ?? listing.sourceId}
            <span class="count">
              {listing.total.toLocaleString()} at this time{listing.total > listing.rows.length
                ? `, latest ${listing.rows.length} shown`
                : ''}
            </span>
          </div>
          {#each listing.rows as row (row.activity_id)}
            {@const ref = getAnalysisActivityRowRef(bindings, row)}
            <button
              class="activity"
              class:selected={analysisActivityRefsEqual(ref, selected)}
              on:click={() => select(row)}
            >
              <span class="activity-type">{row.type}</span>
              {#if row.name && row.name !== row.type}<span class="activity-name">{row.name}</span>{/if}
              <span class="activity-time">
                {offset(Date.parse(row.start_time), readAt ?? $inspectTimeMs)}
                →
                {row.end_time ? offset(Date.parse(row.end_time), readAt ?? $inspectTimeMs) : 'no end'}
              </span>
            </button>
          {/each}
          {#if binding?.kind === 'plan'}
            <div class="note">A plan's directives have no end: only those starting at this instant are listed.</div>
          {/if}
        {:else}
          <div class="note">This analysis has no sources.</div>
        {/each}
      </section>
    </div>
  {/if}
</div>

<style>
  .at-time {
    display: flex;
    flex-direction: column;
    font-size: 12px;
    height: 100%;
  }

  .time-bar {
    align-items: center;
    border-bottom: 1px solid var(--st-gray-20);
    display: flex;
    gap: 6px;
    padding: 6px 8px;
  }

  .time {
    font-variant-numeric: tabular-nums;
  }

  .grow {
    flex: 1;
  }

  .empty,
  .note {
    color: var(--st-gray-60);
    padding: 8px;
  }

  .note.error {
    color: var(--st-utility-red, #b3261e);
  }

  .body {
    flex: 1;
    overflow: auto;
    padding-bottom: 8px;
  }

  .body.stale section {
    opacity: 0.6;
  }

  h3 {
    background: var(--st-gray-10);
    border-bottom: 1px solid var(--st-gray-20);
    margin: 0;
    padding: 4px 8px;
    position: sticky;
    top: 0;
    z-index: 1;
  }

  .row-name {
    color: var(--st-gray-70);
    padding: 6px 8px 2px;
  }

  .count {
    color: var(--st-gray-50);
    margin-left: 4px;
  }

  .reading {
    padding: 2px 8px 4px;
  }

  .reading-line {
    align-items: baseline;
    display: flex;
    gap: 8px;
  }

  .resource-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .value {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    max-width: 50%;
    overflow-wrap: anywhere;
    text-align: right;
  }

  .units {
    color: var(--st-gray-60);
    font-weight: 400;
  }

  .muted .resource-name,
  .value.none {
    color: var(--st-gray-50);
  }

  .basis {
    border: 1px solid var(--st-gray-30);
    border-radius: 3px;
    color: var(--st-gray-70);
    flex: none;
    font-size: 10px;
    padding: 0 4px;
    text-transform: uppercase;
  }

  .basis.sample {
    background: var(--st-gray-100);
    border-color: var(--st-gray-100);
    color: white;
  }

  .basis.interpolated {
    border-color: #b7791f;
    color: #8a5a12;
  }

  .basis.computed {
    border-color: var(--st-utility-blue);
    color: var(--st-utility-blue);
  }

  .basis.unavailable,
  .basis.gap {
    border-style: dashed;
    color: var(--st-gray-50);
  }

  .detail {
    color: var(--st-gray-60);
    font-size: 11px;
    overflow-wrap: anywhere;
  }

  .source-label {
    color: var(--st-gray-80);
  }

  .activity {
    background: none;
    border: 0;
    cursor: pointer;
    display: flex;
    flex-wrap: wrap;
    gap: 2px 8px;
    padding: 3px 8px;
    text-align: left;
    width: 100%;
  }

  .activity:hover {
    background: var(--st-gray-15);
  }

  .activity.selected {
    background: var(--st-utility-blue-10, rgba(47, 128, 237, 0.16));
  }

  .activity-type {
    font-weight: 600;
  }

  .activity-name {
    color: var(--st-gray-70);
  }

  .activity-time {
    color: var(--st-gray-60);
    font-variant-numeric: tabular-nums;
    margin-left: auto;
  }
</style>
