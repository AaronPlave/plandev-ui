<svelte:options immutable={true} />

<!--
  An authored sequence (a seqJSON source, see the backend's SeqJsonAdapter) as it was written: its steps in the
  file's order, each with its kind, what it names, its arguments and its time tag exactly as written. This is the
  sequence's inventory and needs no clock: only steps with an ABSOLUTE time are on the timeline, and the rest are
  never given a made-up time. What a generator said it was made from (a plan, a simulation) is shown as it said it;
  a sequence written on its own claims nothing. These are instructions as authored, not a record of what ran.
-->
<script lang="ts">
  import { base } from '$app/paths';

  type AuthoredStep = {
    args?: Record<string, unknown> | unknown[];
    description?: string;
    metadata?: Record<string, unknown>;
    name?: string;
    position: number;
    time?: { tag?: string; type: string };
    type: string;
  };

  export let mission: Record<string, unknown>;

  /** Steps listed at once; the rest on request. */
  const STEP_LIMIT = 200;

  let showAll: boolean = false;

  $: steps = (Array.isArray(mission.steps) ? mission.steps : []) as AuthoredStep[];
  $: requests = (Array.isArray(mission.requests) ? mission.requests : []) as { name: string; steps: AuthoredStep[] }[];
  $: timing = (mission.timing ?? {}) as { absoluteSteps?: number; note?: string };
  $: generatedFrom = (mission.generatedFrom ?? null) as {
    planId?: number;
    seqId?: string;
    simulationDatasetId?: number;
  } | null;
  $: shown = showAll ? steps : steps.slice(0, STEP_LIMIT);

  function formatArgs(args: AuthoredStep['args']): string {
    if (!args) {
      return '';
    }
    if (Array.isArray(args)) {
      return args.map(arg => JSON.stringify((arg as { value?: unknown })?.value ?? arg)).join(', ');
    }
    return Object.entries(args)
      .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
      .join(', ');
  }

  function formatTime(time: AuthoredStep['time']): string {
    if (!time) {
      return 'no time';
    }
    return time.type === 'COMMAND_COMPLETE' ? 'after previous completes' : `${time.type} ${time.tag ?? ''}`;
  }
</script>

<section class="authored" aria-label="Authored sequence">
  <div class="facts">
    <span class="kind">Authored sequence</span>
    <span>{mission.sequenceId}</span>
    <span class="muted">{steps.length} step{steps.length === 1 ? '' : 's'}</span>
  </div>
  {#if generatedFrom}
    <div class="facts">
      <span class="muted">Generated from</span>
      {#if generatedFrom.planId !== undefined}
        <a href="{base}/plans/{generatedFrom.planId}">plan {generatedFrom.planId}</a>
      {/if}
      {#if generatedFrom.simulationDatasetId !== undefined}
        <span>simulation dataset {generatedFrom.simulationDatasetId}</span>
      {/if}
      {#if generatedFrom.seqId}<span>as {generatedFrom.seqId}</span>{/if}
      <span class="muted">(as its metadata says)</span>
    </div>
  {/if}
  <div class="muted">
    {timing.absoluteSteps ?? 0} with an absolute time {timing.absoluteSteps ? '(on the timeline)' : ''}.
    {timing.note ?? ''}
  </div>
  <details>
    <summary>Steps ({steps.length})</summary>
    <ol class="steps">
      {#each shown as step (step.position)}
        <li>
          <span class="n">{step.position}</span>
          <span class="name" title={step.description ?? ''}>{step.name ?? step.type}</span>
          <span class="tag">{step.type}</span>
          {#if step.args && formatArgs(step.args)}<span class="args">{formatArgs(step.args)}</span>{/if}
          <span class="time" class:absolute={step.time?.type === 'ABSOLUTE'}>{formatTime(step.time)}</span>
        </li>
      {/each}
    </ol>
    {#if steps.length > STEP_LIMIT}
      <button class="link" on:click={() => (showAll = !showAll)}>
        {showAll ? 'Show fewer' : `Show all ${steps.length} steps`}
      </button>
    {/if}
  </details>
  {#each requests as request (request.name)}
    <div class="muted">Request {request.name}: {request.steps.length} step{request.steps.length === 1 ? '' : 's'}</div>
  {/each}
</section>

<style>
  .authored {
    display: flex;
    flex-direction: column;
    gap: 4px;
    grid-column: 1 / -1;
    margin-top: 4px;
  }

  .facts {
    align-items: baseline;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 8px;
  }

  .kind {
    font-weight: 500;
  }

  .muted,
  .tag,
  .time {
    color: var(--st-gray-60);
  }

  .authored {
    min-width: 0;
    overflow: hidden;
  }

  summary {
    cursor: pointer;
  }

  .steps {
    display: flex;
    flex-direction: column;
    list-style: none;
    margin: 0;
    max-height: 200px;
    overflow: auto;
    padding: 0;
  }

  .steps li {
    align-items: baseline;
    display: flex;
    gap: 6px;
    min-width: 0;
    white-space: nowrap;
  }

  .name,
  .time {
    flex-shrink: 0;
  }

  .n {
    color: var(--st-gray-50);
    min-width: 2.5em;
    text-align: right;
  }

  .tag {
    font-size: 10px;
  }

  .args {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .time {
    margin-left: auto;
  }

  .time.absolute {
    color: var(--st-gray-80);
  }

  .link {
    align-self: flex-start;
    background: none;
    border: none;
    color: var(--st-utility-blue);
    cursor: pointer;
    padding: 0;
  }
</style>
