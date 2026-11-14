<svelte:options immutable={true} />

<!--
  Read-only details of the selected analysis activity, read from its source in that source's own terms: an imported
  activity with its attributes, parameters and provenance, a simulation span with its arguments, or a plan's current
  directive with its arguments, metadata and anchor (live: it follows edits to the plan).
-->
<script lang="ts">
  import { Button } from '@nasa-jpl/stellar-svelte';
  import { ChevronLeft, ChevronRight, Crosshair, GitCompareArrows, StickyNote, ZoomIn } from 'lucide-svelte';
  import { createEventDispatcher } from 'svelte';
  import {
    addAnalysisAnnotation,
    analysisCompareReference,
    analysisPlanDirectives,
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
    SourceActivityLink,
  } from '../../types/analysis';
  import type { User } from '../../types/app';
  import { analysisActivityRefsEqual, getAnalysisActivitySource, isActivityTypeShown } from '../../utilities/analysis';
  import {
    getPlanDirectiveDetails,
    loadAnalysisActivityDetails,
    type AnalysisActivityDetails,
  } from '../../utilities/analysisActivityDetails';
  import effects from '../../utilities/effects';
  import { convertUsToDurationString, formatDate } from '../../utilities/time';
  import AnalysisActivityComparison from './AnalysisActivityComparison.svelte';

  export let bindings: AnalysisSourceBinding[] = [];
  export let datasets: AnalysisSimulationDataset[] = [];
  export let readOnly: boolean = false;
  export let revisions: AnalysisSourceRevision[] = [];
  export let selected: AnalysisActivityRef | null = null;
  export let sourceLabels: Record<string, string> = {};
  export let user: User | null;

  /** Children listed at once; the count says when there are more. */
  const CHILD_LIMIT = 200;

  type Related = {
    children: SourceActivityLink[];
    /** A key the record names, and the record it resolves to (null: no record of this revision has that key). */
    named: { key: string; label: string; record: SourceActivityLink | null }[];
  };

  const dispatch = createEventDispatcher<{
    inspectAt: void;
    select: { endMs: number; ref: AnalysisActivityRef; startMs: number };
    zoom: { endMs: number; startMs: number };
  }>();

  let details: AnalysisActivityDetails | null = null;
  let loading: boolean = false;
  let reference: AnalysisActivityDetails | null = null;
  let related: Related | null = null;
  let edge: string = '';

  $: context = { bindings, datasets, planDirectives: $analysisPlanDirectives, revisions, user };
  $: selectedBinding = selected ? bindings.find(b => b.id === selected?.sourceId) : undefined;
  // Found in the table, an activity may be of a type no row draws yet.
  $: shownOnTimeline =
    !details || isActivityTypeShown($view?.definition.plan.timelines ?? [], details.ref.sourceId, details.type);
  // A plan's directives are live: its details follow the plan rather than being read once.
  $: if (selected && selectedBinding?.kind === 'plan') {
    details = getPlanDirectiveDetails(selected, selectedBinding, $analysisPlanDirectives[selectedBinding.planId] ?? []);
    loading = false;
  } else {
    load(selected);
  }
  $: loadReference($analysisCompareReference);
  $: loadRelated(details);
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

  /** The records this one names, and those that name it as their parent, looked up by key in the same revision. */
  async function loadRelated(of: AnalysisActivityDetails | null) {
    related = null;
    const links = of?.related;
    if (!of || !links) {
      return;
    }
    const named = [
      { key: links.parent, label: 'Parent' },
      { key: links.related, label: 'Raised by' },
    ].flatMap(({ key, label }) => (key ? [{ key, label }] : []));
    const [records, children] = await Promise.all([
      named.length
        ? effects.getSourceActivityLinks(links.revisionId, { keys: named.map(({ key }) => key) }, named.length, user)
        : [],
      effects.getSourceActivityLinks(links.revisionId, { parent: of.key }, CHILD_LIMIT + 1, user),
    ]);
    if (details === of) {
      related = {
        children,
        named: named.map(link => ({ ...link, record: records.find(record => record.source_key === link.key) ?? null })),
      };
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
    const start = new Date(startMs).toISOString();
    const [beyond, order] = direction === 'next' ? (['_gt', 'asc'] as const) : (['_lt', 'desc'] as const);
    const { source_kind, source_ref } = getAnalysisActivitySource(binding);
    const [found] = await effects.getAnalysisActivities(
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
    ).catch(() => {
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
    addAnalysisAnnotation(
      {
        about: { activityId: of.ref.activityId, key: of.key, kind: 'activity', name: of.name, sourceId: of.ref.sourceId },
        end: of.endMs !== null && of.endMs > of.startMs ? new Date(of.endMs).toISOString() : undefined,
        start: new Date(of.startMs).toISOString(),
        text,
      },
      user,
    );
  }

  function formatValue(value: unknown): string {
    return typeof value === 'string' ? value : JSON.stringify(value);
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
    <div class="title st-typography-medium">{current.name}</div>
    <div class="actions">
      <Button
        size="xs"
        variant="outline"
        on:click={() => dispatch('zoom', { endMs: endMs ?? startMs, startMs })}
        title="Fit the timeline to this activity"><ZoomIn size={12} class="mr-1" />Zoom to</Button
      >
      <Button
        size="xs"
        variant="outline"
        on:click={() => {
          $timeCursorMs = endMs === null ? startMs : (startMs + endMs) / 2;
          dispatch('inspectAt');
        }}
        title="Put the time cursor at the middle of this activity and see what the sources say then"
        ><Crosshair size={12} class="mr-1" />Cursor at middle</Button
      >
      <Button
        size="xs"
        variant={isReference ? 'default' : 'outline'}
        on:click={() => ($analysisCompareReference = isReference ? null : current.ref)}
        title="Keep this activity as the reference, then select another one (in any source) to compare the two"
        ><GitCompareArrows size={12} class="mr-1" />{isReference ? 'Reference' : 'Compare with…'}</Button
      >
      {#if !readOnly}
        <Button
          size="xs"
          variant="outline"
          on:click={() => addNote(current, '')}
          title="Add a note about this activity, saved with the analysis"
          ><StickyNote size={12} class="mr-1" />Note</Button
        >
      {/if}
    </div>
    <div class="actions">
      <Button size="xs" variant="ghost" title="The previous {current.type} in this source" on:click={() => step('previous')}
        ><ChevronLeft size={12} />Previous {current.type}</Button
      >
      <Button size="xs" variant="ghost" title="The next {current.type} in this source" on:click={() => step('next')}
        >Next {current.type}<ChevronRight size={12} /></Button
      >
    </div>
    {#if edge}
      <div class="empty st-typography-label" role="status">{edge}</div>
    {/if}
    {#if !shownOnTimeline && !readOnly}
      {@const { ref, type } = current}
      <button class="st-button secondary show" on:click={() => showAnalysisActivityType(ref.sourceId, type)}>
        Show {type} on the timeline
      </button>
    {/if}
    {#each current.cautions ?? [] as caution}
      <div class="caution" role="note">{caution}</div>
    {/each}
    <dl>
      <dt>Type</dt>
      <dd>{current.type}</dd>
      <dt>Source</dt>
      <dd>{sourceLabels[current.ref.sourceId] ?? current.ref.sourceId}</dd>
      <dt>{current.endMs === null ? 'Start (approximate)' : 'Start'}</dt>
      <dd>{formatDate(new Date(current.startMs), $plugins.time.primary.format)}</dd>
      {#if current.endMs === null}
        <dt>End</dt>
        <dd class="text-muted-foreground">None: a directive has no end until it is simulated</dd>
      {:else}
        <dt>End</dt>
        <dd>{formatDate(new Date(current.endMs), $plugins.time.primary.format)}</dd>
        <dt>Duration</dt>
        <dd>{convertUsToDurationString((current.endMs - current.startMs) * 1000) || '0s'}</dd>
      {/if}
      {#each current.fields as [label, value]}
        <dt>{label}</dt>
        <dd>{value}</dd>
      {/each}
    </dl>
    {#if related && (related.named.length || related.children.length)}
      <details open>
        <summary class="st-typography-medium">
          Related records, as the product links them
        </summary>
        <dl>
          {#each related.named as { key, label, record } (label)}
            <dt>{label}</dt>
            <dd>
              {#if record}
                <button class="link" on:click={() => select(current.ref.sourceId, record)}>
                  {record.name} <span class="text-muted-foreground">({record.type})</span>
                </button>
              {:else}
                {key}
                <span class="text-muted-foreground">: named by this record, but no record of this revision has that key</span>
              {/if}
            </dd>
          {/each}
        </dl>
        {#if related.children.length}
          <div class="text-muted-foreground">
            {related.children.length > CHILD_LIMIT ? `First ${CHILD_LIMIT} of more` : related.children.length}
            record{related.children.length === 1 ? '' : 's'} naming this one as parent, by start:
          </div>
          <ul class="children">
            {#each related.children.slice(0, CHILD_LIMIT) as child (child.id)}
              <li>
                <button class="link" on:click={() => select(current.ref.sourceId, child)}>
                  {child.name}
                </button>
                <span class="text-muted-foreground">
                  {child.type} · {formatDate(new Date(child.start_time), $plugins.time.primary.format)}
                </span>
              </li>
            {/each}
          </ul>
        {/if}
      </details>
    {/if}
    {#each current.sections as [label, values]}
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

  .actions {
    display: flex;
    gap: 6px;
    margin-bottom: 8px;
  }

  .actions {
    flex-wrap: wrap;
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

  .link {
    background: none;
    border: 0;
    color: var(--st-utility-blue);
    cursor: pointer;
    font: inherit;
    padding: 0;
    text-align: left;
    word-break: break-all;
  }

  .children {
    list-style: none;
    margin: 2px 0 8px;
    max-height: 240px;
    overflow: auto;
    padding: 0;
  }

  .children li {
    padding: 1px 0;
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
