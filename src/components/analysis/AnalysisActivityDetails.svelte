<svelte:options immutable={true} />

<!--
  Read-only details of the selected analysis activity, read from its source in that source's own terms: an imported
  activity with its attributes, parameters and provenance, a simulation span with its arguments, or a plan's current
  directive with its arguments, metadata and anchor (live: it follows edits to the plan).
-->
<script lang="ts">
  import { analysisPlanDirectives, showAnalysisActivityType } from '../../stores/analysis';
  import { createEventDispatcher } from 'svelte';
  import { view } from '../../stores/views';
  import { plugins } from '../../stores/plugins';
  import type {
    AnalysisActivityRef,
    AnalysisPlanDirective,
    AnalysisSimulationDataset,
    AnalysisSourceBinding,
    AnalysisSourceRevision,
  } from '../../types/analysis';
  import type { User } from '../../types/app';
  import { analysisActivityRefsEqual, getRevisionVersionLabel, isActivityTypeShown } from '../../utilities/analysis';
  import effects from '../../utilities/effects';
  import {
    convertUsToDurationString,
    formatDate,
    getIntervalInMs,
    getUnixEpochTimeFromInterval,
  } from '../../utilities/time';

  export let bindings: AnalysisSourceBinding[] = [];
  export let datasets: AnalysisSimulationDataset[] = [];
  export let readOnly: boolean = false;
  export let revisions: AnalysisSourceRevision[] = [];
  export let selected: AnalysisActivityRef | null = null;
  export let sourceLabels: Record<string, string> = {};
  export let user: User | null;

  type Details = {
    /** Null when the source records no end (a plan directive). */
    endMs: number | null;
    fields: [string, string][];
    name: string;
    ref: AnalysisActivityRef;
    sections: [string, Record<string, unknown>][];
    startMs: number;
    type: string;
  };

  const dispatch = createEventDispatcher<{ shown: void }>();

  let details: Details | null = null;
  let loading: boolean = false;

  $: selectedBinding = selected ? bindings.find(b => b.id === selected?.sourceId) : undefined;
  // Found in the table, an activity may be of a type no row draws yet.
  $: shownOnTimeline =
    !details || isActivityTypeShown($view?.definition.plan.timelines ?? [], details.ref.sourceId, details.type);
  // A plan's directives are live: its details follow the plan rather than being read once.
  $: if (selected && selectedBinding?.kind === 'plan') {
    details = getPlanDirectiveDetails(selected, $analysisPlanDirectives[selectedBinding.planId] ?? []);
    loading = false;
  } else {
    load(selected);
  }

  function getPlanDirectiveDetails(ref: AnalysisActivityRef, directives: AnalysisPlanDirective[]): Details | null {
    const directive = directives.find(({ id }) => id === ref.activityId);
    if (!directive) {
      return null;
    }
    const anchor = directives.find(({ id }) => id === directive.anchor_id);
    return {
      endMs: null,
      fields: [
        ['Directive id', `${directive.id}`],
        [
          'Anchored to',
          directive.anchor_id === null
            ? `Plan ${directive.anchored_to_start ? 'start' : 'end'}`
            : `${anchor?.name || anchor?.type || 'Directive'} (${directive.anchor_id}) ${directive.anchored_to_start ? 'start' : 'end'}`,
        ],
        ['Offset', directive.start_offset],
      ],
      name: directive.name || directive.type,
      ref,
      sections: [
        ['Arguments', directive.arguments],
        ['Metadata', directive.metadata],
      ],
      startMs: Date.parse(directive.approximate_start_time),
      type: directive.type,
    };
  }

  async function load(ref: AnalysisActivityRef | null) {
    details = null;
    const binding = ref ? bindings.find(b => b.id === ref.sourceId) : undefined;
    if (!ref || !binding || binding.kind === 'plan') {
      return;
    }
    loading = true;
    const next =
      binding.kind === 'imported' ? await loadImported(ref, binding.revisionId) : await loadSpan(ref, binding);
    if (analysisActivityRefsEqual(selected, ref)) {
      details = next;
      loading = false;
    }
  }

  async function loadImported(ref: AnalysisActivityRef, revisionId: number): Promise<Details | null> {
    const activity = await effects.getSourceActivity(revisionId, ref.activityId, user);
    if (!activity) {
      return null;
    }
    const revision = revisions.find(r => r.id === revisionId);
    return {
      endMs: Date.parse(activity.end_time),
      fields: [
        ['Subsystem', activity.category ?? '—'],
        ['Id in source', `${activity.id}`],
        ['Source key', activity.source_key],
        ['Product', revision ? `${revision.source.name}, ${getRevisionVersionLabel(revision)}` : ''],
      ],
      name: activity.name,
      ref,
      sections: [
        ['Parameters', activity.parameters],
        ['Attributes', activity.attributes],
        ['Provenance', activity.metadata],
      ],
      startMs: Date.parse(activity.start_time),
      type: activity.type,
    };
  }

  async function loadSpan(ref: AnalysisActivityRef, binding: AnalysisSourceBinding): Promise<Details | null> {
    const dataset = datasets.find(d => binding.kind === 'simulation' && d.id === binding.simulationDatasetId);
    if (!dataset?.simulation_start_time) {
      return null;
    }
    const span = await effects.getSpan(dataset.dataset_id, ref.activityId, user);
    if (!span) {
      return null;
    }
    const startMs = getUnixEpochTimeFromInterval(dataset.simulation_start_time, span.start_offset);
    const plan = dataset.simulation?.plan;
    return {
      endMs: startMs + getIntervalInMs(span.duration),
      fields: [
        ['Span id', `${span.span_id}`],
        ['Parent span', span.parent_id === null ? '—' : `${span.parent_id}`],
        ['Directive', span.attributes.directiveId === undefined ? '—' : `${span.attributes.directiveId}`],
        ['Plan', plan ? `${plan.name} (${plan.id})` : '—'],
        ['Simulation dataset', `${dataset.id}`],
      ],
      name: span.type,
      ref,
      sections: [
        ['Arguments', span.attributes.arguments],
        ['Computed attributes', span.attributes.computedAttributes as Record<string, unknown>],
      ],
      startMs,
      type: span.type,
    };
  }

  function formatValue(value: unknown): string {
    return typeof value === 'string' ? value : JSON.stringify(value);
  }
</script>

<div class="analysis-activity-details">
  {#if !selected}
    <div class="empty st-typography-label">Select an activity on the timeline or in the table</div>
  {:else if loading && !details}
    <div class="empty st-typography-label">Loading…</div>
  {:else if !details}
    <div class="empty st-typography-label">The activity is no longer available</div>
  {:else}
    <div class="title st-typography-medium">{details.name}</div>
    {#if !shownOnTimeline && !readOnly}
      {@const { ref, type } = details}
      <button
        class="st-button secondary show"
        on:click={() => {
          showAnalysisActivityType(ref.sourceId, type);
          dispatch('shown');
        }}
      >
        Show {type} on the timeline
      </button>
    {/if}
    <dl>
      <dt>Type</dt>
      <dd>{details.type}</dd>
      <dt>Source</dt>
      <dd>{sourceLabels[details.ref.sourceId] ?? details.ref.sourceId}</dd>
      <dt>{details.endMs === null ? 'Start (approximate)' : 'Start'}</dt>
      <dd>{formatDate(new Date(details.startMs), $plugins.time.primary.format)}</dd>
      {#if details.endMs === null}
        <dt>End</dt>
        <dd class="text-muted-foreground">None: a directive has no end until it is simulated</dd>
      {:else}
        <dt>End</dt>
        <dd>{formatDate(new Date(details.endMs), $plugins.time.primary.format)}</dd>
        <dt>Duration</dt>
        <dd>{convertUsToDurationString((details.endMs - details.startMs) * 1000) || '0s'}</dd>
      {/if}
      {#each details.fields as [label, value]}
        <dt>{label}</dt>
        <dd>{value}</dd>
      {/each}
    </dl>
    {#each details.sections as [label, values]}
      <details open>
        <summary class="st-typography-medium">{label} ({Object.keys(values ?? {}).length})</summary>
        <dl>
          {#each Object.entries(values ?? {}) as [key, value]}
            <dt>{key}</dt>
            <dd>{formatValue(value)}</dd>
          {:else}
            <dd class="none">None</dd>
          {/each}
        </dl>
      </details>
    {/each}
  {/if}
</div>

<style>
  .analysis-activity-details {
    font-size: 12px;
    height: 100%;
    overflow: auto;
    padding: 8px;
  }

  .empty {
    color: var(--st-gray-50);
    padding: 8px 0;
  }

  .title {
    font-size: 14px;
    margin-bottom: 8px;
    word-break: break-all;
  }

  .show {
    margin-bottom: 8px;
  }

  dl {
    display: grid;
    gap: 2px 8px;
    grid-template-columns: minmax(80px, auto) 1fr;
    margin: 0 0 8px;
  }

  dt {
    color: var(--st-gray-60);
  }

  dd {
    margin: 0;
    word-break: break-word;
  }

  .none {
    color: var(--st-gray-50);
    grid-column: span 2;
  }

  summary {
    cursor: pointer;
    margin: 4px 0;
  }
</style>
