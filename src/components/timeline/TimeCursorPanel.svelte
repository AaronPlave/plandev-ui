<svelte:options immutable={true} />

<script lang="ts">
  import { TriangleAlert, ChevronRight } from 'lucide-svelte';
  import { onDestroy } from 'svelte';
  import { visibleConstraintResults } from '../../stores/constraints';
  import { selectExternalEvent, selectedExternalEvents } from '../../stores/external-event';
  import { field } from '../../stores/form';
  import { maxTimeRange, plan, timeCursorCompareMs, timeCursorMs } from '../../stores/plan';
  import { plugins } from '../../stores/plugins';
  import {
    allResourceTypes,
    resourceTypes,
    selectedSpanId,
    simulationDataset,
    spanUtilityMaps,
    spans,
  } from '../../stores/simulation';
  import { timelineResources } from '../../stores/timelineResourceStatus';
  import { viewUpdateGrid } from '../../stores/views';
  import type { User } from '../../types/app';
  import type { ConstraintResultWithName } from '../../types/constraint';
  import type { DropdownOptions } from '../../types/dropdown';
  import type { ExternalEvent } from '../../types/external-event';
  import type { ValueSchema } from '../../types/schema';
  import type { Resource, ResourceType, Span } from '../../types/simulation';
  import type { ViewGridComponent, ViewGridSection } from '../../types/view';
  import { getExternalEventRowId } from '../../utilities/externalEvents';
  import { createResourceSubscription, type ResourceSubscription } from '../../utilities/resourceSubscription';
  import { formatDate, getDoyTime, getUnixEpochTime } from '../../utilities/time';
  import { required } from '../../utilities/validators';
  import Collapse from '../Collapse.svelte';
  import DatePickerField from '../form/DatePickerField.svelte';
  import GridMenu from '../menus/GridMenu.svelte';
  import Panel from '../ui/Panel.svelte';
  import TimeCursorResourceRow from './TimeCursorResourceRow.svelte';
  import SearchableDropdown from '../ui/SearchableDropdown.svelte';

  export let gridSection: ViewGridSection;
  export let user: User | null = null;

  type ResourceRow = { name: string; resource: Resource; schema: ValueSchema; watched: boolean };
  type ActiveViolation = { constraintName: string; message: string };

  /**
   * Whether values are interpolated between samples or snapped to the nearest one. Named after the
   * timeline's own hover setting so the two read the same way.
   */
  let interpolateValues: boolean = false;
  let expandedName: string | null = null;
  /** In comparison mode the value columns can either show A/B/delta or the window's min/avg/max. */
  let columnMode: 'values' | 'stats' = 'values';
  let watchedNames: string[] = [];
  let watchedResources: Record<string, Resource> = {};
  let watchedSubscriptions: Record<string, ResourceSubscription> = {};
  const cursorTimeField = field<string>('', [required, $plugins.time.primary.validate]);

  // Keeps the input in step with the cursor as it is dragged. Goes through validateAndSet so the
  // field's own validity is recomputed — a plain set would leave the initial "required" error
  // showing over a perfectly valid time.
  $: if ($timeCursorMs !== null) {
    syncCursorTimeField($timeCursorMs);
  }

  $: reconcileWatchedSubscriptions(watchedNames, $simulationDataset, $plan?.start_time, $resourceTypes, user);

  // Resources already on the timeline cost nothing — some row is already subscribed to them.
  $: timelineResourceRows = [...$timelineResources.entries()]
    .map(([name, entry]) => ({ name, resource: entry.resource }))
    .sort((a, b) => a.name.localeCompare(b.name));

  $: watchedResourceRows = watchedNames
    .filter(name => watchedResources[name] && !$timelineResources.has(name))
    .map(name => ({ name, resource: watchedResources[name] }))
    .sort((a, b) => a.name.localeCompare(b.name));

  $: resourceRows = [
    ...timelineResourceRows.map(row => toResourceRow(row, false, $allResourceTypes)),
    ...watchedResourceRows.map(row => toResourceRow(row, true, $allResourceTypes)),
  ];
  $: resourceCount = resourceRows.length;
  $: comparing = $timeCursorCompareMs !== null;
  $: showStats = comparing && columnMode === 'stats';
  // Resource names a violation currently covers, so the offending row can say so itself instead of
  // making the reader cross-reference a separate list.
  $: violatingResources = getViolatingResources($visibleConstraintResults, $timeCursorMs);
  $: compareOffsetLabel =
    $timeCursorMs !== null && $timeCursorCompareMs !== null
      ? `${$timeCursorCompareMs >= $timeCursorMs ? '+' : '−'}${formatOffset(Math.abs($timeCursorCompareMs - $timeCursorMs))}`
      : '';

  $: resourceOptions = getResourceOptions($allResourceTypes, $timelineResources);

  $: activeSpans = getActiveSpans($spans, $timeCursorMs);
  $: activeExternalEvents = getActiveExternalEvents($selectedExternalEvents, $timeCursorMs);
  $: activeViolations = getActiveViolations($visibleConstraintResults, $timeCursorMs);

  async function syncCursorTimeField(timeMs: number): Promise<void> {
    const doy = getDoyTime(new Date(timeMs), false);
    if ($cursorTimeField.value !== doy) {
      await cursorTimeField.validateAndSet(doy);
    }
  }

  /**
   * Units live on the *resource type*, not on the sampled profile's schema — the same place the
   * timeline tooltip reads them from — so prefer that and fall back to the profile's own schema.
   */
  function getSchema(name: string, resource: Resource, resourceTypes: ResourceType[]): ValueSchema {
    return resourceTypes.find(type => type.name === name)?.schema ?? resource.schema;
  }

  function formatOffset(ms: number): string {
    const hours = Math.floor(ms / 3_600_000);
    const minutes = Math.round((ms % 3_600_000) / 60_000);
    return `${hours ? `${hours}h ` : ''}${minutes}m`;
  }

  function toResourceRow(
    row: { name: string; resource: Resource },
    watched: boolean,
    resourceTypes: ResourceType[],
  ): ResourceRow {
    return {
      name: row.name,
      resource: row.resource,
      schema: getSchema(row.name, row.resource, resourceTypes),
      watched,
    };
  }

  function getViolatingResources(results: ConstraintResultWithName[], timeMs: number | null): Set<string> {
    const names = new Set<string>();
    if (timeMs === null) {
      return names;
    }
    for (const result of results) {
      const covers = (result.violations ?? []).some(violation =>
        violation.windows.some(window => window.start <= timeMs && window.end >= timeMs),
      );
      if (covers) {
        for (const resourceId of result.resourceIds ?? []) {
          names.add(resourceId);
        }
      }
    }
    return names;
  }

  function getResourceOptions(resourceTypes: ResourceType[], onTimeline: Map<string, unknown>): DropdownOptions {
    return resourceTypes
      .filter(type => !onTimeline.has(type.name))
      .map(type => ({ display: type.name, value: type.name }))
      .sort((a, b) => a.display.localeCompare(b.display));
  }

  function getActiveSpans(spans: Span[] | null, timeMs: number | null): Span[] {
    if (timeMs === null || !spans) {
      return [];
    }
    // Zero-duration spans are instantaneous, so treat the cursor as containing them when it sits
    // exactly on the start rather than dropping them entirely.
    return spans
      .filter(span => span.startMs <= timeMs && (span.endMs > timeMs || span.startMs === timeMs))
      .sort((a, b) => a.startMs - b.startMs);
  }

  function getActiveExternalEvents(events: ExternalEvent[], timeMs: number | null): ExternalEvent[] {
    if (timeMs === null) {
      return [];
    }
    return events
      .filter(event => {
        const end = event.start_ms + event.duration_ms;
        return event.start_ms <= timeMs && (end > timeMs || event.start_ms === timeMs);
      })
      .sort((a, b) => a.start_ms - b.start_ms);
  }

  function getActiveViolations(results: ConstraintResultWithName[], timeMs: number | null): ActiveViolation[] {
    if (timeMs === null) {
      return [];
    }
    const active: ActiveViolation[] = [];
    for (const result of results) {
      for (const violation of result.violations ?? []) {
        if (violation.windows.some(window => window.start <= timeMs && window.end >= timeMs)) {
          active.push({ constraintName: result.constraintName, message: violation.message ?? '' });
        }
      }
    }
    return active;
  }

  /**
   * Creates a subscription for each newly watched resource and tears down the ones dropped. The
   * factories refcount into the shared timeline registry, so watching a resource a row already shows
   * does not double-fetch.
   */
  function reconcileWatchedSubscriptions(
    names: string[],
    simDataset: typeof $simulationDataset,
    planStartTimeYmd: string | undefined,
    types: ResourceType[],
    user: User | null,
  ): void {
    if (!simDataset || !planStartTimeYmd) {
      return;
    }

    for (const name of Object.keys(watchedSubscriptions)) {
      if (!names.includes(name)) {
        removeWatchedSubscription(name);
      }
    }

    for (const name of names) {
      if (watchedSubscriptions[name]) {
        continue;
      }
      const subscription = createResourceSubscription(name, simDataset, planStartTimeYmd, types, user);
      watchedSubscriptions = { ...watchedSubscriptions, [name]: subscription };
      subscription.store.subscribe(({ resource }) => {
        if (resource) {
          watchedResources = { ...watchedResources, [name]: resource };
        }
      });
    }
  }

  function removeWatchedSubscription(name: string): void {
    watchedSubscriptions[name]?.unsubscribe();
    const { [name]: _removedSubscription, ...remainingSubscriptions } = watchedSubscriptions;
    const { [name]: _removedResource, ...remainingResources } = watchedResources;
    watchedSubscriptions = remainingSubscriptions;
    watchedResources = remainingResources;
  }

  function unwatchResource(name: string): void {
    watchedNames = watchedNames.filter(watched => watched !== name);
  }

  /** Clearing the cursor also leaves comparison mode — a B cursor alone has nothing to compare to. */
  function clearCursors(): void {
    timeCursorCompareMs.set(null);
    timeCursorMs.set(null);
    expandedName = null;
  }

  function toggleCompare(): void {
    if ($timeCursorCompareMs !== null) {
      timeCursorCompareMs.set(null);
      return;
    }
    if ($timeCursorMs === null) {
      return;
    }
    const span = $maxTimeRange.end - $maxTimeRange.start;
    const offset = span > 0 ? span * 0.05 : 3_600_000;
    timeCursorCompareMs.set(Math.min($maxTimeRange.end, $timeCursorMs + offset));
  }

  /**
   * Opens a panel in a slot that is not the one this inspector occupies, so following a link never
   * closes the inspector you followed it from.
   */
  function openPanelBeside(component: ViewGridComponent): void {
    if (gridSection === 'RightTop') {
      viewUpdateGrid({ rightComponentBottom: component, rightHidden: false, rightSplit: true });
    } else if (gridSection === 'RightBottom') {
      viewUpdateGrid({ rightComponentTop: component, rightHidden: false, rightSplit: true });
    } else if (gridSection === 'LeftTop') {
      viewUpdateGrid({ leftComponentBottom: component, leftHidden: false, leftSplit: true });
    } else if (gridSection === 'LeftBottom') {
      viewUpdateGrid({ leftComponentTop: component, leftHidden: false, leftSplit: true });
    } else {
      viewUpdateGrid({ rightComponentTop: component, rightHidden: false });
    }
  }

  function openSpan(span: Span): void {
    selectedSpanId.set(span.span_id);
    openPanelBeside('ActivityFormPanel');
  }

  function openExternalEvent(event: ExternalEvent): void {
    // Selecting already switches the middle table to external events; the form panel is what shows
    // the event's own attributes, so open that too.
    selectExternalEvent(getExternalEventRowId(event.pkey));
    openPanelBeside('ExternalEventFormPanel');
  }

  function openConstraints(): void {
    openPanelBeside('ConstraintsPanel');
  }

  async function onCursorTimeChange(event: CustomEvent<{ valid: boolean }>): Promise<void> {
    if (event.detail.valid) {
      const parsed = $plugins.time.primary.parse
        ? $plugins.time.primary.parse($cursorTimeField.value)
        : new Date(getUnixEpochTime($cursorTimeField.value));
      if (parsed) {
        timeCursorMs.set(parsed.getTime());
      }
    }
  }

  onDestroy(() => {
    Object.keys(watchedSubscriptions).forEach(removeWatchedSubscription);
  });
</script>

<Panel padBody={false}>
  <svelte:fragment slot="header">
    <GridMenu {gridSection} title="Time Cursor" />
    {#if $timeCursorMs !== null}
      <button
        class="st-button tertiary mr-2 shrink-0 text-[12px]"
        aria-label="Clear Time Cursor"
        on:click={clearCursors}
      >
        Clear
      </button>
    {/if}
  </svelte:fragment>

  <svelte:fragment slot="body">
    {#if $timeCursorMs === null}
      <div class="flex flex-col items-start gap-2 p-3">
        <div class="st-typography-label">No time cursor set.</div>
        <div class="text-[11px] text-gray-500">
          Hover the timeline and click the blue marker beside the add-guide button, or start from a known time:
        </div>
        <div class="flex gap-2">
          <button class="st-button secondary" on:click={() => timeCursorMs.set($maxTimeRange.start)}>Plan start</button>
          {#if $simulationDataset?.simulation_start_time}
            <button
              class="st-button secondary"
              on:click={() =>
                $simulationDataset?.simulation_start_time &&
                timeCursorMs.set(new Date($simulationDataset.simulation_start_time).getTime())}
            >
              Simulation start
            </button>
          {/if}
        </div>
      </div>
    {:else}
      <div class="flex flex-col gap-1 border-b p-3">
        <DatePickerField
          field={cursorTimeField}
          label={`Cursor Time (${$plugins.time.primary.label})`}
          layout="stacked"
          name="timeCursor"
          maxDate={new Date($maxTimeRange.end)}
          minDate={new Date($maxTimeRange.start)}
          on:change={onCursorTimeChange}
          useFallback={!$plugins.time.enableDatePicker}
        />
        {#each $plugins.time.additional as additionalTime}
          <div class="flex justify-between text-[11px] tabular-nums text-gray-500">
            <span>{additionalTime.label}</span>
            <span>{formatDate(new Date($timeCursorMs), additionalTime.format)}</span>
          </div>
        {/each}

        {#if comparing && $timeCursorCompareMs !== null}
          <div class="compare-summary">
            <span class="compare-dot" />
            <span class="compare-label">B</span>
            <span class="compare-time">
              {formatDate(new Date($timeCursorCompareMs), $plugins.time.primary.format)}
            </span>
            <span class="compare-offset">{compareOffsetLabel}</span>
          </div>
        {/if}

        <div class="flex items-center gap-2 pt-1">
          <button class="st-button tertiary text-[11px]" on:click={toggleCompare}>
            {comparing ? 'Exit comparison' : 'Compare with…'}
          </button>
          {#if comparing}
            <div class="column-mode">
              <button class="mode-button" class:active={columnMode === 'values'} on:click={() => (columnMode = 'values')}>
                A / B / Δ
              </button>
              <button class="mode-button" class:active={columnMode === 'stats'} on:click={() => (columnMode = 'stats')}>
                Min / Avg / Max
              </button>
            </div>
          {/if}
        </div>
      </div>

      <div class="cursor-section">
        <Collapse title="Resources" padContent={false}>
          <svelte:fragment slot="right">
            <span class="text-[11px] text-gray-500">{resourceCount}</span>
          </svelte:fragment>

          {#if !resourceCount}
            <div class="pb-2 text-[11px] text-gray-500">
              No resources loaded. Plot a resource on the timeline, or add one below.
            </div>
          {:else}
            <div class="column-header" class:comparing>
              <span />
              <span />
              {#if showStats}
                <span>Min</span>
                <span>Avg</span>
                <span>Max</span>
              {:else if comparing}
                <span>A</span>
                <span>B</span>
                <span>Δ</span>
              {:else}
                <span>Value</span>
              {/if}
            </div>
            {#each resourceRows as row (row.name)}
              <TimeCursorResourceRow
                compareTimeMs={$timeCursorCompareMs}
                cursorTimeMs={$timeCursorMs}
                domainEndMs={$maxTimeRange.end}
                domainStartMs={$maxTimeRange.start}
                expanded={expandedName === row.name}
                interpolate={interpolateValues}
                name={row.name}
                resource={row.resource}
                schema={row.schema}
                {showStats}
                violating={violatingResources.has(row.name)}
                watched={row.watched}
                on:toggle={() => (expandedName = expandedName === row.name ? null : row.name)}
                on:unwatch={() => unwatchResource(row.name)}
              />
            {/each}
          {/if}

          <div class="pt-2">
            <SearchableDropdown
              allowMultiple
              name="watchedResources"
              options={resourceOptions}
              placeholder="Add a resource…"
              searchPlaceholder="Search resources"
              selectedOptionValues={watchedNames}
              on:change={({ detail }) => (watchedNames = detail.map(String))}
            />
          </div>
          <label class="flex items-center gap-2 pb-2 pt-1 text-[11px] text-gray-500">
            <input type="checkbox" bind:checked={interpolateValues} />
            Interpolate values between samples
          </label>
        </Collapse>

      </div>

      <div class="cursor-section">
        <Collapse title="Activities in Progress" padContent={false}>
          <svelte:fragment slot="right">
            <span class="text-[11px] text-gray-500">{activeSpans.length}</span>
          </svelte:fragment>

          {#if !activeSpans.length}
            <div class="pb-2 text-[11px] text-gray-500">No simulated activities at this time.</div>
          {/if}
          {#each activeSpans as span (span.span_id)}
            <button
              class="group -mx-1 flex w-full items-center justify-between gap-2 rounded px-1 py-1 text-left text-[12px] hover:bg-accent"
              title="Select and open this activity"
              on:click={() => openSpan(span)}
            >
              <span class="flex min-w-0 flex-col">
                <span class="truncate">{span.type}</span>
                <span class="text-[10px] tabular-nums text-gray-500">
                  {Math.round(($timeCursorMs - span.startMs) / 1000)}s elapsed ·
                  {Math.round((span.endMs - $timeCursorMs) / 1000)}s left
                  {#if $spanUtilityMaps.spanIdToDirectiveIdMap[span.span_id] !== undefined}
                    · directive {$spanUtilityMaps.spanIdToDirectiveIdMap[span.span_id]}
                  {/if}
                </span>
              </span>
              <span class="shrink-0 text-gray-400 opacity-0 group-hover:opacity-100">
                <ChevronRight size={14} />
              </span>
            </button>
          {/each}
        </Collapse>

      </div>

      <div class="cursor-section">
        <Collapse title="External Events" padContent={false}>
          <svelte:fragment slot="right">
            <span class="text-[11px] text-gray-500">{activeExternalEvents.length}</span>
          </svelte:fragment>

          {#if !activeExternalEvents.length}
            <div class="pb-2 text-[11px] text-gray-500">No external events at this time.</div>
          {/if}
          {#each activeExternalEvents as event (getExternalEventRowId(event.pkey))}
            <button
              class="group -mx-1 flex w-full items-center justify-between gap-2 rounded px-1 py-1 text-left text-[12px] hover:bg-accent"
              title="Select and open this external event"
              on:click={() => openExternalEvent(event)}
            >
              <span class="flex min-w-0 flex-col">
                <span class="truncate">{event.pkey.key}</span>
                <span class="truncate text-[10px] text-gray-500">
                  {event.pkey.event_type_name} · {event.pkey.derivation_group_name}
                </span>
              </span>
              <span class="shrink-0 text-gray-400 opacity-0 group-hover:opacity-100">
                <ChevronRight size={14} />
              </span>
            </button>
          {/each}
        </Collapse>

      </div>

      <div class="cursor-section">
        <Collapse title="Constraint Violations" padContent={false} error={activeViolations.length > 0}>
          <svelte:fragment slot="right">
            <span class="text-[11px]" class:text-destructive={activeViolations.length > 0}>
              {activeViolations.length}
            </span>
          </svelte:fragment>

          {#if !activeViolations.length}
            <div class="pb-2 text-[11px] text-gray-500">No violations at this time.</div>
          {/if}
          {#each activeViolations as violation, index (`${violation.constraintName}-${index}`)}
            <button
              class="group -mx-1 mb-1 flex w-full items-start gap-2 rounded border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-left text-[12px] hover:bg-destructive/10"
              title="Open the constraints panel"
              on:click={openConstraints}
            >
              <span class="mt-0.5 shrink-0 text-destructive"><TriangleAlert size={13} /></span>
              <span class="flex min-w-0 flex-col gap-0.5">
                <span class="truncate st-typography-medium">{violation.constraintName}</span>
                {#if violation.message}
                  <span class="text-[10px] leading-snug text-gray-600">{violation.message}</span>
                {/if}
              </span>
            </button>
          {/each}
        </Collapse>
      </div>
    {/if}
  </svelte:fragment>
</Panel>

<style>
  /* Each section gets its own band so the collapses read as separate content rather than one run. */
  .cursor-section {
    padding: 0 12px;
  }

  .cursor-section + .cursor-section {
    border-top: 1px solid var(--st-gray-20, #ebecf0);
  }

  /* Column captions, aligned to the same grid the rows use. */
  .column-header {
    color: var(--st-gray-50, #8b8f96);
    display: grid;
    font-size: 8.5px;
    font-weight: 700;
    grid-template-columns: minmax(0, 1fr) auto 74px;
    letter-spacing: 0.5px;
    padding-bottom: 3px;
    text-align: right;
    text-transform: uppercase;
  }

  .column-header.comparing {
    column-gap: 8px;
    grid-template-columns: minmax(0, 1fr) auto repeat(3, 58px);
  }

  .compare-summary {
    align-items: center;
    display: flex;
    font-size: 11px;
    gap: 6px;
    padding-top: 2px;
  }

  .compare-dot {
    background: #0f766e;
    border-radius: 50%;
    height: 7px;
    width: 7px;
  }

  .compare-label {
    color: #0f766e;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.5px;
  }

  .compare-time {
    color: var(--st-gray-70, #4c4f55);
    font-variant-numeric: tabular-nums;
  }

  .compare-offset {
    color: var(--st-gray-50, #8b8f96);
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    margin-left: auto;
  }

  .column-mode {
    display: flex;
    gap: 0;
  }

  .mode-button {
    background: none;
    border: 1px solid var(--st-gray-20, #ebecf0);
    color: var(--st-gray-70, #4c4f55);
    cursor: pointer;
    font-size: 10px;
    padding: 2px 7px;
  }

  .mode-button:first-child {
    border-radius: 3px 0 0 3px;
  }

  .mode-button:last-child {
    border-left: none;
    border-radius: 0 3px 3px 0;
  }

  .mode-button.active {
    background: var(--st-gray-15, #f4f5f7);
    color: var(--st-gray-100, #17181a);
    font-weight: 600;
  }

</style>
