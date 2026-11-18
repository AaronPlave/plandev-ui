<svelte:options immutable={true} />

<!--
  Read-only details of the selected analysis activity, read from its source in that source's own terms: an imported
  activity with its attributes, parameters and provenance, a simulation span with its arguments, or a plan's current
  directive with its arguments, metadata and anchor (live: it follows edits to the plan).
-->
<script lang="ts">
  import { Button, DropdownMenu } from '@nasa-jpl/stellar-svelte';
  import {
    ChevronLeft,
    ChevronRight,
    Crosshair,
    Ellipsis,
    GitCompareArrows,
    Rows3,
    StickyNote,
    ZoomIn,
  } from 'lucide-svelte';
  import DirectiveIcon from '../../assets/timeline-directive.svg?component';
  import SpanIcon from '../../assets/timeline-span.svg?component';
  import { createEventDispatcher } from 'svelte';
  import {
    analysisRecordLabels,
    addRecordAnnotation,
    updateAnnotation,
    analysisCompareReference,
    analysisPlanDirectives,
    analysisPlanExternalEvents,
    analysisPlans,
    showAnalysisActivityType,
  } from '../../stores/analysis';
  import { timeCursorMs } from '../../stores/plan';
  import { plugins } from '../../stores/plugins';
  import { view } from '../../stores/views';
  import type {
    AnalysisActivityRef,
    AnalysisSimulationDataset,
    AnalysisSourceBinding,
    AnalysisSourceRevision,
  } from '../../types/analysis';
  import type { User } from '../../types/app';
  import {
    analysisActivityRefsEqual,
    getAnalysisActivitySource,
    getExternalEventId,
    isActivityTypeShown,
    isExternalEventId,
  } from '../../utilities/analysis';
  import {
    getPlanRecordDetails,
    getReadOnlyFormParameters,
    loadAnalysisActivityDetails,
    type AnalysisActivityDetails,
  } from '../../utilities/analysisActivityDetails';
  import effects from '../../utilities/effects';
  import { convertUsToDurationString, formatDate, getIntervalInMs } from '../../utilities/time';
  import Collapse from '../Collapse.svelte';
  import Parameters from '../parameters/Parameters.svelte';
  import AnalysisActivityComparison from './AnalysisActivityComparison.svelte';
  import AnalysisGeneratedLinks from './AnalysisGeneratedLinks.svelte';
  import AnalysisRecordStructure from './AnalysisRecordStructure.svelte';

  export let bindings: AnalysisSourceBinding[] = [];
  export let datasets: AnalysisSimulationDataset[] = [];
  export let readOnly: boolean = false;
  export let revisions: AnalysisSourceRevision[] = [];
  export let selected: AnalysisActivityRef | null = null;
  export let sourceLabels: Record<string, string> = {};
  export let user: User | null;

  const dispatch = createEventDispatcher<{
    inspectAt: void;
    select: { endMs: number; ref: AnalysisActivityRef; startMs: number };
    zoom: { endMs: number; startMs: number };
  }>();

  let details: AnalysisActivityDetails | null = null;
  let loading: boolean = false;
  let reference: AnalysisActivityDetails | null = null;
  let edge: string = '';

  $: context = {
    bindings,
    datasets,
    planDirectives: $analysisPlanDirectives,
    planExternalEvents: $analysisPlanExternalEvents,
    revisions,
    user,
  };
  $: selectedBinding = selected ? bindings.find(b => b.id === selected?.sourceId) : undefined;
  // Found in the table, an activity may be of a type no row draws yet.
  $: shownOnTimeline =
    !details || isActivityTypeShown($view?.definition.plan.timelines ?? [], details.ref.sourceId, details.type);
  // A plan's directives are live: its details follow the plan rather than being read once.
  $: if (selected && selectedBinding?.kind === 'plan') {
    details = getPlanRecordDetails(
      selected,
      selectedBinding,
      $analysisPlanDirectives[selectedBinding.planId] ?? [],
      $analysisPlanExternalEvents[selectedBinding.planId] ?? [],
    );
    loading = false;
  } else {
    load(selected);
  }
  $: loadReference($analysisCompareReference);
  // Named for the inspector's trail.
  $: if (details) {
    const key = `${details.ref.sourceId}::${details.ref.activityId}`;
    const label = details.name || details.type;
    if ($analysisRecordLabels[key] !== label) {
      $analysisRecordLabels = { ...$analysisRecordLabels, [key]: label };
    }
  }
  // The model's declaration of the type, for a plan's directive or a simulation's span: its arguments by their schema.
  $: declared = getDeclaredType(details, selectedBinding);
  // Each section of values, as the Plan's activity forms show them; an empty one is left out.
  $: sections = (details?.sections ?? []).flatMap(([label, values], index) => {
    const parameters = getReadOnlyFormParameters(values, index === 0 ? declared : null);
    return parameters.length ? [{ label, open: index === 0, parameters }] : [];
  });

  function getDeclaredType(of: AnalysisActivityDetails | null, binding: AnalysisSourceBinding | undefined) {
    if (!of || !binding) {
      return null;
    }
    const model =
      binding.kind === 'plan'
        ? ($analysisPlans ?? []).find(({ id }) => id === binding.planId)?.mission_model
        : binding.kind === 'simulation'
          ? datasets.find(({ id }) => id === binding.simulationDatasetId)?.simulation?.plan?.mission_model
          : null;
    return model?.activity_types.find(({ name }) => name === of.type) ?? null;
  }
  $: isReference = analysisActivityRefsEqual($analysisCompareReference, selected);

  async function load(ref: AnalysisActivityRef | null) {
    details = null;
    edge = '';
    if (!ref) {
      return;
    }
    loading = true;
    const next = await loadAnalysisActivityDetails(ref, context);
    if (analysisActivityRefsEqual(selected, ref)) {
      details = next;
      loading = false;
    }
  }

  async function loadReference(ref: AnalysisActivityRef | null) {
    reference = null;
    const next = ref && (await loadAnalysisActivityDetails(ref, context));
    if (analysisActivityRefsEqual($analysisCompareReference, ref)) {
      reference = next;
    }
  }

  function select(sourceId: string, record: { end_time: string | null; id: number; start_time: string }) {
    const startMs = Date.parse(record.start_time);
    dispatch('select', {
      endMs: record.end_time ? Date.parse(record.end_time) : startMs,
      ref: { activityId: record.id, sourceId },
      startMs,
    });
  }

  /** The next or previous activity of the same type in the same source, by start. */
  async function step(direction: 'next' | 'previous') {
    const binding = details && bindings.find(({ id }) => id === details?.ref.sourceId);
    if (!details || !binding) {
      return;
    }
    const { ref, startMs, type } = details;
    // A plan's external events are not in the analysis's activity table: stepped through in memory, by start.
    if (binding.kind === 'plan' && isExternalEventId(ref.activityId)) {
      const same = ($analysisPlanExternalEvents[binding.planId] ?? [])
        .filter(event => event.event_type_name === type)
        .sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time));
      const index = same.findIndex(event => getExternalEventId(event) === ref.activityId);
      const next = same[index + (direction === 'next' ? 1 : -1)];
      if (next) {
        const nextStart = Date.parse(next.start_time);
        dispatch('select', {
          endMs: nextStart + getIntervalInMs(next.duration),
          ref: { activityId: getExternalEventId(next), sourceId: ref.sourceId },
          startMs: nextStart,
        });
      } else {
        edge = `This is the ${direction === 'next' ? 'last' : 'first'} ${type} of ${sourceLabels[ref.sourceId] ?? 'its source'}`;
      }
      return;
    }
    const start = new Date(startMs).toISOString();
    const [beyond, order] = direction === 'next' ? (['_gt', 'asc'] as const) : (['_lt', 'desc'] as const);
    const { source_kind, source_ref } = getAnalysisActivitySource(binding);
    const [found] = await effects
      .getAnalysisActivities(
        {
          _or: [
            { start_time: { [beyond]: start } },
            { activity_id: { [beyond]: ref.activityId }, start_time: { _eq: start } },
          ],
          source_kind: { _eq: source_kind },
          source_ref: { _eq: source_ref },
          type: { _eq: type },
        },
        [{ start_time: order }, { activity_id: order }],
        0,
        1,
        user,
      )
      .catch(() => {
        edge = `Could not read the ${direction} ${type}`;
        return [];
      });
    if (found) {
      select(ref.sourceId, { end_time: found.end_time, id: found.activity_id, start_time: found.start_time });
    } else {
      edge = `This is the ${direction === 'next' ? 'last' : 'first'} ${type} in ${sourceLabels[ref.sourceId] ?? 'its source'}`;
    }
  }

  function addNote(of: AnalysisActivityDetails, text: string) {
    // About the record, at its start: not a claim about every moment of its duration. To mark the interval itself,
    // mark a time range.
    const id = addRecordAnnotation(
      {
        activityId: of.ref.activityId,
        key: of.key,
        kind: 'activity',
        name: of.name,
        recordKind: of.kind,
        sourceId: of.ref.sourceId,
      },
      of.startMs,
      user,
    );
    if (id !== null && text) {
      updateAnnotation(id, { description: text });
    }
  }
</script>

<div class="analysis-activity-details">
  {#if reference && details && !isReference}
    <AnalysisActivityComparison
      {readOnly}
      {reference}
      selected={details}
      {sourceLabels}
      on:clear={() => ($analysisCompareReference = null)}
      on:saveNote={({ detail }) => details && addNote(details, detail)}
      on:selectSelected={() =>
        details &&
        dispatch('select', { endMs: details.endMs ?? details.startMs, ref: details.ref, startMs: details.startMs })}
      on:selectReference={() =>
        reference &&
        dispatch('select', {
          endMs: reference.endMs ?? reference.startMs,
          ref: reference.ref,
          startMs: reference.startMs,
        })}
    />
  {:else if $analysisCompareReference}
    <div class="reference-bar" role="status">
      <span>
        {#if reference}
          Comparing with <strong>{reference.name}</strong> ({reference.key}) of
          {sourceLabels[reference.ref.sourceId] ?? reference.ref.sourceId}. Select another activity, in any source.
        {:else}
          The comparison reference is no longer available.
        {/if}
      </span>
      <Button size="xs" variant="ghost" on:click={() => ($analysisCompareReference = null)}>Clear</Button>
    </div>
  {/if}
  {#if !selected}
    <div class="empty st-typography-label">Select an activity on the timeline or in the table</div>
  {:else if loading && !details}
    <div class="empty st-typography-label">Loading…</div>
  {:else if !details}
    <div class="empty st-typography-label">The activity is no longer available</div>
  {:else}
    {@const current = details}
    {@const { endMs, startMs } = current}
    <div class="header">
      <svelte:component this={current.kind === 'Plan directive' ? DirectiveIcon : SpanIcon} />
      <div class="min-w-0 flex-1">
        <div class="title st-typography-medium" title={current.name}>{current.name}</div>
        <div class="subtitle">{current.kind} · {sourceLabels[current.ref.sourceId] ?? current.ref.sourceId}</div>
      </div>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Previous {current.type}"
        title="The previous {current.type} in this source"
        on:click={() => step('previous')}><ChevronLeft size={14} /></Button
      >
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="Next {current.type}"
        title="The next {current.type} in this source"
        on:click={() => step('next')}><ChevronRight size={14} /></Button
      >
    </div>
    <div class="actions">
      <Button
        size="xs"
        variant="outline"
        on:click={() => dispatch('zoom', { endMs: endMs ?? startMs, startMs })}
        title="Fit the timeline to this {current.kind.toLowerCase()}"><ZoomIn size={12} class="mr-1" />Zoom to</Button
      >
      {#if !readOnly}
        <Button
          size="xs"
          variant="outline"
          on:click={() => addNote(current, '')}
          title="Annotate this {current.kind.toLowerCase()}: say what it shows"
          ><StickyNote size={12} class="mr-1" />Annotate</Button
        >
      {/if}
      <Button
        size="xs"
        variant={isReference ? 'default' : 'outline'}
        on:click={() => ($analysisCompareReference = isReference ? null : current.ref)}
        title="Keep this as the reference, then select another record (in any source) to compare the two"
        ><GitCompareArrows size={12} class="mr-1" />{isReference ? 'Reference' : 'Compare'}</Button
      >
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild let:builder>
          <Button builders={[builder]} size="icon-sm" variant="ghost" aria-label="More actions"
            ><Ellipsis size={14} /></Button
          >
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" class="text-xs">
          <DropdownMenu.Item
            class="text-xs"
            on:click={() => {
              $timeCursorMs = endMs === null ? startMs : (startMs + endMs) / 2;
              dispatch('inspectAt');
            }}><Crosshair size={12} class="mr-2" />Place the cursor here (At Time)</DropdownMenu.Item
          >
          {#if !shownOnTimeline && !readOnly}
            <DropdownMenu.Item
              class="text-xs"
              on:click={() => showAnalysisActivityType(current.ref.sourceId, current.type)}
              ><Rows3 size={12} class="mr-2" />Show {current.type} on the timeline</DropdownMenu.Item
            >
          {/if}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
    {#if edge}
      <div class="empty st-typography-label" role="status">{edge}</div>
    {/if}
    {#each current.cautions ?? [] as caution}
      <div class="caution" role="note">{caution}</div>
    {/each}
    <Collapse title="Definition" padContent={false}>
      <dl>
        <dt>Type</dt>
        <dd>{current.type}</dd>
        {#if current.endMs === null && !current.endInvalid}
          <dt title="A directive's start, resolved from its anchors; it has no end until simulated">Start (approx.)</dt>
          <dd>{formatDate(new Date(startMs), $plugins.time.primary.format)}</dd>
        {:else}
          <dt>Start</dt>
          <dd>{formatDate(new Date(startMs), $plugins.time.primary.format)}</dd>
          {#if current.endInvalid}
            <dt>End</dt>
            <dd title="The product's end ({current.endInvalid}) is before its start">
              <span class="text-muted-foreground">Invalid in the product · duration unknown</span>
            </dd>
          {:else if current.endMs !== null}
            <dt>End</dt>
            <dd>{formatDate(new Date(current.endMs), $plugins.time.primary.format)}</dd>
            <dt>Duration</dt>
            <dd>{convertUsToDurationString((current.endMs - current.startMs) * 1000) || '0s'}</dd>
          {/if}
        {/if}
      </dl>
    </Collapse>
    <AnalysisGeneratedLinks
      {bindings}
      {datasets}
      details={current}
      {revisions}
      {sourceLabels}
      {user}
      on:select={({ detail }) => dispatch('select', detail)}
    />
    {#if current.related}
      <AnalysisRecordStructure
        details={current}
        {readOnly}
        {user}
        on:select={({ detail }) => select(current.ref.sourceId, detail)}
      />
    {/if}
    {#each sections as section (section.label)}
      <Collapse title={section.label} padContent={false} defaultExpanded={section.open}>
        <div class="parameters">
          <Parameters disabled formParameters={section.parameters} hideRightAdornments />
        </div>
      </Collapse>
    {/each}
    <Collapse title="Details" padContent={false} defaultExpanded={false}>
      <dl>
        {#each current.fields as [label, value]}
          <dt>{label}</dt>
          <dd>{value}</dd>
        {/each}
      </dl>
    </Collapse>
  {/if}
</div>

<style>
  .analysis-activity-details {
    font-size: 12px;
    height: 100%;
    overflow: auto;
    padding: 8px 8px 16px;
  }

  .empty {
    color: var(--st-gray-50);
    padding: 8px 0;
  }

  .header {
    align-items: center;
    display: flex;
    gap: 6px;
    margin-bottom: 6px;
  }

  .header :global(svg:first-child) {
    flex: none;
  }

  .title {
    font-size: 14px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .subtitle {
    color: var(--st-gray-60);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .actions {
    align-items: center;
    display: flex;
    gap: 4px;
    margin-bottom: 8px;
  }

  .reference-bar {
    align-items: center;
    background: var(--st-gray-10);
    border: 1px solid var(--st-gray-20);
    border-radius: 4px;
    display: flex;
    gap: 6px;
    justify-content: space-between;
    margin-bottom: 8px;
    padding: 4px 6px;
  }

  .caution {
    border-left: 2px solid var(--st-warning-yellow, #e6b300);
    margin-bottom: 8px;
    padding-left: 6px;
  }

  dl {
    display: grid;
    gap: 3px 8px;
    grid-template-columns: minmax(80px, max-content) minmax(0, 1fr);
    margin: 0;
    padding: 4px 8px 8px;
  }

  dt {
    color: var(--st-gray-60);
  }

  dd {
    margin: 0;
    word-break: break-word;
  }

  .parameters {
    padding: 0 8px 8px;
  }
</style>
