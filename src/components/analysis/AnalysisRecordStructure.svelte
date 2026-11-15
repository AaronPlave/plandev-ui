<svelte:options immutable={true} />

<!--
  Where an imported record sits among the records its product links it to, read only from what the product says:
  `metadata.parent` (the record that started it), `metadata.step` (its place in its parent's steps) and
  `metadata.related` (for a reported warning or error, the record it was raised on). For a sequence: the chain of
  sequences that started it, its reported state, engine and invocation, its steps in the product's order (commands and
  the sequences it started), and the warnings and errors raised on it or its steps. For a step: its place among its
  sequence's steps. For a reported record: what it was raised on. Nothing is inferred: a key that names no record of
  the product is shown as such.
-->
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { showAnalysisActivitiesWith, showAnalysisSequence } from '../../stores/analysis';
  import { plugins } from '../../stores/plugins';
  import type { SourceActivityLink } from '../../types/analysis';
  import type { User } from '../../types/app';
  import type { AnalysisActivityDetails } from '../../utilities/analysisActivityDetails';
  import effects from '../../utilities/effects';
  import { formatDate } from '../../utilities/time';

  export let details: AnalysisActivityDetails;
  export let readOnly: boolean = false;
  export let user: User | null;

  const STATE_COLORS: Record<string, string> = { ABORTED: '#c2412d', FAILED: '#c2412d', RUNNING: '#2f6fd6' };

  /** Steps listed at once; the count says when there are more. */
  const STEP_LIMIT = 500;
  /** How far up the chain of parents is followed. */
  const DEPTH_LIMIT = 16;

  const dispatch = createEventDispatcher<{ select: SourceActivityLink }>();

  type Structure = {
    ancestors: SourceActivityLink[];
    /** The parent the product names, when no record has that key. */
    missingParent: string | null;
    raisedOn: { key: string; record: SourceActivityLink | null } | null;
    /** Warnings and errors raised on this record or one of its steps. */
    reported: SourceActivityLink[];
    /** This record's own steps (it is a sequence), or its sequence's (it is a step). */
    siblings: SourceActivityLink[];
    steps: SourceActivityLink[];
  };

  /** Each revision's reported records, read once: a product has few. */
  const reportedByRevision = new Map<number, Promise<SourceActivityLink[]>>();

  let structure: Structure | null = null;
  let showAllSiblings: boolean = false;

  $: load(details);

  async function links(by: Parameters<typeof effects.getSourceActivityLinks>[1], limit: number) {
    return effects.getSourceActivityLinks(details.related?.revisionId ?? -1, by, limit, user);
  }

  async function load(of: AnalysisActivityDetails) {
    structure = null;
    showAllSiblings = false;
    const revisionId = of.related?.revisionId;
    if (revisionId === undefined) {
      return;
    }
    if (!reportedByRevision.has(revisionId)) {
      reportedByRevision.set(revisionId, links({ reported: true }, 5000));
    }
    const [steps, reportedAll, ancestry, raisedOn] = await Promise.all([
      links({ parent: of.key }, STEP_LIMIT + 1),
      reportedByRevision.get(revisionId) ?? [],
      loadAncestors(of.related?.parent),
      of.related?.related
        ? links({ keys: [of.related.related] }, 1).then(([record]) => ({
            key: of.related?.related ?? '',
            record: record ?? null,
          }))
        : null,
    ]);
    const siblings = ancestry.ancestors.length
      ? await links({ parent: ancestry.ancestors.at(-1)?.source_key ?? '' }, STEP_LIMIT + 1)
      : [];
    const keys = new Set([of.key, ...steps.map(step => step.source_key)]);
    if (details === of) {
      structure = {
        ...ancestry,
        raisedOn,
        reported: reportedAll.filter(record => keys.has(`${record.metadata.related}`)),
        siblings: inOrder(siblings),
        steps: inOrder(steps),
      };
    }
  }

  async function loadAncestors(parentKey: string | undefined) {
    const ancestors: SourceActivityLink[] = [];
    let key = parentKey;
    while (key && ancestors.length < DEPTH_LIMIT) {
      const [record] = await links({ keys: [key] }, 1);
      if (!record) {
        return { ancestors: ancestors.reverse(), missingParent: ancestors.length ? null : key };
      }
      ancestors.push(record);
      key = typeof record.metadata.parent === 'string' ? record.metadata.parent : undefined;
    }
    return { ancestors: ancestors.reverse(), missingParent: null };
  }

  /** The product's step order when every record has one, else by start (and `byStart` says so). */
  function inOrder(records: SourceActivityLink[]): SourceActivityLink[] {
    return records.every(record => typeof record.metadata.step === 'number')
      ? // A sequence a command spawned shares the command's step: it comes right after the command.
        [...records].sort(
          (a, b) =>
            (a.metadata.step as number) - (b.metadata.step as number) ||
            Number(a.type === 'SEQUENCE') - Number(b.type === 'SEQUENCE'),
        )
      : records;
  }

  function hasProductOrder(records: SourceActivityLink[]): boolean {
    return records.length > 0 && records.every(record => typeof record.metadata.step === 'number');
  }

  /** "+01:02:03" from the sequence's start: where a step falls in it. */
  function offset(record: SourceActivityLink, fromMs: number): string {
    const ms = Date.parse(record.start_time) - fromMs;
    const total = Math.round(Math.abs(ms) / 1000);
    const pad = (n: number) => `${n}`.padStart(2, '0');
    const days = Math.floor(total / 86400);
    return `${ms < 0 ? '−' : '+'}${days ? `${days}d ` : ''}${pad(Math.floor(total / 3600) % 24)}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
  }

  function state(record: { parameters: Record<string, unknown> }): string | null {
    return typeof record.parameters.state === 'string' ? record.parameters.state : null;
  }

  $: reportedOn = new Map<string, number>();
  $: {
    const counts = new Map<string, number>();
    structure?.reported.forEach(record => {
      const key = `${record.metadata.related}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    reportedOn = counts;
  }
  $: ownState = state(details);
  // The kinds of record a sequence's row needs: this record's, its steps', and those of the sequences above it.
  $: sequenceTypes = structure
    ? [details.type, ...[...structure.steps, ...structure.ancestors, ...structure.siblings].map(record => record.type)]
    : [];
  $: isSequence = details.type === 'SEQUENCE' || structure?.steps.length;
  $: siblingIndex = structure?.siblings.findIndex(record => record.source_key === details.key) ?? -1;
  $: siblingWindow =
    structure && siblingIndex >= 0 && !showAllSiblings
      ? structure.siblings.slice(Math.max(0, siblingIndex - 3), siblingIndex + 4)
      : (structure?.siblings ?? []);
</script>

{#if structure && (structure.ancestors.length || structure.missingParent || structure.steps.length || structure.raisedOn || structure.reported.length)}
  <section class="structure" aria-label="Structure">
    {#if isSequence && details.parameters.engine !== undefined}
      <div class="facts">
        {#if ownState}<span class="state" data-state={ownState}>{ownState}</span>{/if}
        {#if ownState && ownState !== 'COMPLETED' && !readOnly}
          {@const value = ownState}
          <button
            class="link"
            title="Add a row of every {details.type} whose state is {value}, in a color of its own"
            on:click={() =>
              showAnalysisActivitiesWith(
                details.ref.sourceId,
                details.type,
                'state',
                value,
                STATE_COLORS[value] ?? '#a8321e',
              )}>show all {value} on the timeline</button
          >
        {/if}
        <span>engine {details.parameters.engine}</span>
        {#if details.parameters.invocationType}<span>{details.parameters.invocationType}</span>{/if}
        {#if details.metadata?.step !== undefined}<span>step {details.metadata.step} of its parent</span>{/if}
      </div>
    {/if}

    {#if !readOnly && (structure.steps.length || structure.ancestors.length)}
      <div class="facts">
        <button
          class="link"
          title="Reveal {structure.steps.length
            ? 'this sequence'
            : 'this step in its sequence'} in a timeline row of its source's sequences, steps in order"
          on:click={() => showAnalysisSequence(details.ref.sourceId, [...new Set(sequenceTypes)])}
          >Show {structure.steps.length ? 'sequence' : 'in its sequence'} on timeline</button
        >
      </div>
    {/if}

    {#if structure.ancestors.length || structure.missingParent}
      <div class="path" aria-label="Started by">
        <span class="label">In</span>
        {#each structure.ancestors as ancestor, index (ancestor.id)}
          {#if index}<span class="sep">›</span>{/if}
          <button
            class="link"
            title="{ancestor.type} {ancestor.source_key}"
            on:click={() => dispatch('select', ancestor)}
          >
            {ancestor.name}
          </button>
        {/each}
        {#if structure.missingParent}
          <span class="unresolved" title={structure.missingParent}>
            {structure.missingParent} (named as parent; not a record of this product)
          </span>
        {/if}
      </div>
    {/if}

    {#if structure.raisedOn}
      <div class="path">
        <span class="label">Raised on</span>
        {#if structure.raisedOn.record}
          {@const record = structure.raisedOn.record}
          <button class="link" on:click={() => record && dispatch('select', record)}>
            {record.name} <span class="muted">({record.type})</span>
          </button>
        {:else}
          <span class="unresolved">{structure.raisedOn.key}: not a record of this product (not imported)</span>
        {/if}
      </div>
    {/if}

    {#if structure.reported.length}
      <div class="heading">Reported by the product ({structure.reported.length})</div>
      <ul class="list">
        {#each structure.reported as record (record.id)}
          <li class="reported" data-type={record.type}>
            <div class="line">
              <button class="link" on:click={() => dispatch('select', record)}>{record.type}</button>
              {#if record.metadata.related !== details.key}
                {@const step = structure.steps.find(s => s.source_key === record.metadata.related)}
                <span class="muted on"
                  >on {step
                    ? `${step.name}${step.metadata.step ? ` (step ${step.metadata.step})` : ''}`
                    : record.metadata.related}</span
                >
              {/if}
              <span class="when muted">{offset(record, details.startMs)}</span>
            </div>
            <div class="message" title={`${record.parameters.message ?? ''}`}>{record.parameters.message ?? ''}</div>
          </li>
        {/each}
      </ul>
    {/if}

    {#if structure.steps.length}
      <div class="heading">
        Steps ({structure.steps.length > STEP_LIMIT ? `first ${STEP_LIMIT}` : structure.steps.length}{hasProductOrder(
          structure.steps,
        )
          ? ', in the product’s order'
          : ', by start: the product gives no order'})
      </div>
      <ol class="list steps">
        {#each structure.steps.slice(0, STEP_LIMIT) as step (step.id)}
          {@const childState = state(step)}
          <li class:sub={step.type === 'SEQUENCE'}>
            <span class="n">{step.metadata.step ?? ''}</span>
            <button class="link" title="{step.type} {step.source_key}" on:click={() => dispatch('select', step)}>
              {step.type === 'SEQUENCE' ? '▸ ' : ''}{step.name}
            </button>
            {#if childState && childState !== 'COMPLETED'}<span class="state" data-state={childState}>{childState}</span
              >{/if}
            {#if reportedOn.get(step.source_key)}
              <span class="flag" title="Warnings or errors were reported on this step"
                >⚠ {reportedOn.get(step.source_key)}</span
              >
            {/if}
            <span class="when muted">{offset(step, details.startMs)}</span>
          </li>
        {/each}
      </ol>
    {/if}

    {#if structure.siblings.length > 1 && siblingIndex >= 0}
      {@const parent = structure.ancestors.at(-1)}
      <div class="heading">
        Step {details.metadata?.step ?? siblingIndex + 1} of {structure.siblings.length} in {parent?.name}
        {#if structure.siblings.length > siblingWindow.length || showAllSiblings}
          <button class="link" on:click={() => (showAllSiblings = !showAllSiblings)}>
            {showAllSiblings ? 'show nearby' : 'show all'}
          </button>
        {/if}
      </div>
      <ol class="list steps">
        {#each siblingWindow as step (step.id)}
          <li class:current={step.source_key === details.key} class:sub={step.type === 'SEQUENCE'}>
            <span class="n">{step.metadata.step ?? ''}</span>
            {#if step.source_key === details.key}
              <span>{step.name}</span>
            {:else}
              <button class="link" on:click={() => dispatch('select', step)}>
                {step.type === 'SEQUENCE' ? '▸ ' : ''}{step.name}
              </button>
            {/if}
            <span class="when muted">{formatDate(new Date(step.start_time), $plugins.time.primary.format)}</span>
          </li>
        {/each}
      </ol>
    {/if}
  </section>
{/if}

<style>
  .structure {
    border-bottom: 1px solid var(--st-gray-20);
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 8px;
    padding-bottom: 8px;
  }

  .facts,
  .path {
    align-items: baseline;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
  }

  .label,
  .muted,
  .sep {
    color: var(--st-gray-60);
  }

  .heading {
    color: var(--st-gray-70);
    font-weight: 500;
    margin-top: 4px;
  }

  .state {
    background: var(--st-gray-15, #eee);
    border-radius: 3px;
    font-size: 10px;
    font-weight: 600;
    padding: 0 4px;
  }

  .state[data-state='ABORTED'],
  .state[data-state='FAILED'] {
    background: rgba(219, 81, 57, 0.15);
    color: #a8321e;
  }

  .state[data-state='RUNNING'] {
    background: rgba(41, 121, 255, 0.12);
    color: #1d5bbf;
  }

  .list {
    list-style: none;
    margin: 0;
    max-height: 260px;
    overflow: auto;
    padding: 0;
  }

  .list li {
    align-items: baseline;
    display: flex;
    gap: 6px;
    padding: 1px 0;
  }

  .steps .n {
    color: var(--st-gray-50);
    flex: none;
    font-variant-numeric: tabular-nums;
    text-align: right;
    width: 2.5em;
  }

  .steps .current {
    background: var(--st-gray-10);
    font-weight: 500;
  }

  .when {
    flex: none;
    font-variant-numeric: tabular-nums;
    margin-left: auto;
  }

  .list li.reported {
    display: block;
  }

  .reported .line {
    align-items: baseline;
    display: flex;
    gap: 6px;
    min-width: 0;
  }

  .reported .on {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .reported .message {
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    color: var(--st-gray-70);
    display: -webkit-box;
    overflow: hidden;
    overflow-wrap: anywhere;
    padding-left: 8px;
  }

  .reported[data-type='ERROR'] .line > .link {
    color: #a8321e;
  }

  .flag {
    color: #a8321e;
    flex: none;
    font-size: 11px;
  }

  .unresolved {
    color: var(--st-gray-60);
    font-style: italic;
    overflow-wrap: anywhere;
  }

  .link {
    background: none;
    border: 0;
    color: var(--st-utility-blue);
    cursor: pointer;
    font: inherit;
    min-width: 0;
    overflow: hidden;
    padding: 0;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
