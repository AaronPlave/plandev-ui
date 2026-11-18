<svelte:options immutable={true} />

<!--
  Links between a plan's directive, the activities simulated from it, and the sequences generated from those, from
  what is recorded only: the directive id each simulated run records (span attributes.directiveId), PlanDev's
  assignment of a simulated activity to a sequence, and the steps of this analysis's authored sequences that say
  (metadata.simulatedActivityId) they were expanded from it. Nothing is matched by name or time.
-->
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { analysisPlanDirectives, inspect } from '../../stores/analysis';
  import type {
    AnalysisActivityRef,
    AnalysisSimulationDataset,
    AnalysisSourceBinding,
    AnalysisSourceRevision,
  } from '../../types/analysis';
  import { isExternalEventId } from '../../utilities/analysis';
  import type { User } from '../../types/app';
  import { getAuthoredSections, getAuthoredSequenceSources } from '../../utilities/analysisSequence';
  import type { AnalysisActivityDetails } from '../../utilities/analysisActivityDetails';
  import effects from '../../utilities/effects';
  import { getIntervalInMs, getUnixEpochTimeFromInterval } from '../../utilities/time';

  export let bindings: AnalysisSourceBinding[] = [];
  export let datasets: AnalysisSimulationDataset[] = [];
  export let details: AnalysisActivityDetails;
  export let revisions: AnalysisSourceRevision[] = [];
  export let sourceLabels: Record<string, string> = {};
  export let user: User | null;

  const dispatch = createEventDispatcher<{
    select: { endMs: number; ref: AnalysisActivityRef; startMs: number };
  }>();

  type SimulatedRun = { endMs: number; ref: AnalysisActivityRef; startMs: number };

  let assigned: string[] | null = null;
  let simulated: SimulatedRun[] | null = null;

  const planOf = (datasetId: number) => datasets.find(({ id }) => id === datasetId)?.simulation?.plan?.id;

  $: binding = bindings.find(({ id }) => id === details.ref.sourceId);
  $: datasetId = binding?.kind === 'simulation' ? binding.simulationDatasetId : null;
  $: authored = getAuthoredSequenceSources(bindings, revisions);
  // This analysis's sequences generated from the activity's simulation, and their steps from the activity.
  $: generated =
    datasetId === null
      ? []
      : authored
          .filter(({ mission }) => mission.generatedFrom?.simulationDatasetId === datasetId)
          .map(({ binding: source, mission }) => {
            const entries = getAuthoredSections(mission).flatMap(section => section.entries);
            return {
              attributed: entries.some(entry => entry.simulatedActivityId !== null),
              mission,
              sourceId: source.id,
              steps: entries.filter(entry => entry.simulatedActivityId === details.ref.activityId),
            };
          });
  $: loadAssigned(datasetId, details.ref.activityId);
  // A simulated activity's directive, in this analysis's binding of that plan (live, so a deleted one says so).
  $: fromPlanId = datasetId === null ? undefined : planOf(datasetId);
  $: fromPlan = bindings.find(b => b.kind === 'plan' && b.planId === fromPlanId);
  $: fromDirective =
    fromPlan?.kind === 'plan' && details.directiveId !== undefined
      ? ($analysisPlanDirectives[fromPlan.planId] ?? []).find(({ id }) => id === details.directiveId)
      : undefined;
  // A directive's simulated runs, in this analysis's simulations of its plan.
  $: directivePlanId = binding?.kind === 'plan' && !isExternalEventId(details.ref.activityId) ? binding.planId : null;
  $: simulations = bindings.flatMap(b =>
    b.kind === 'simulation' && directivePlanId !== null && planOf(b.simulationDatasetId) === directivePlanId ? [b] : [],
  );
  $: loadSimulated(simulations, details.ref.activityId);

  async function loadSimulated(sources: typeof simulations, directiveId: number) {
    simulated = null;
    if (!sources.length) {
      return;
    }
    const byDataset = new Map(
      sources.map(source => [datasets.find(({ id }) => id === source.simulationDatasetId), source]),
    );
    const spans = await effects.getSpansOfDirective(
      sources.map(({ simulationDatasetId }) => datasets.find(({ id }) => id === simulationDatasetId)?.dataset_id ?? -1),
      directiveId,
      user,
    );
    if (sources !== simulations || directiveId !== details.ref.activityId) {
      return;
    }
    simulated = (spans ?? []).flatMap(span => {
      const entry = [...byDataset.entries()].find(([dataset]) => dataset?.dataset_id === span.dataset_id);
      if (!entry?.[0]?.simulation_start_time) {
        return [];
      }
      const startMs = getUnixEpochTimeFromInterval(entry[0].simulation_start_time, span.start_offset);
      return [
        {
          endMs: startMs + getIntervalInMs(span.duration),
          ref: { activityId: span.span_id, sourceId: entry[1].id },
          startMs,
        },
      ];
    });
  }

  function selectDirective(planSourceId: string, directive: { approximate_start_time: string; id: number }) {
    const startMs = Date.parse(directive.approximate_start_time);
    dispatch('select', { endMs: startMs, ref: { activityId: directive.id, sourceId: planSourceId }, startMs });
  }

  async function loadAssigned(dataset: number | null, activityId: number) {
    assigned = null;
    if (dataset !== null) {
      const found = await effects.getSequenceAssignments(dataset, activityId, user);
      if (dataset === datasetId && activityId === details.ref.activityId) {
        assigned = found;
      }
    }
  }
</script>

{#if simulations.length}
  <section class="mb-2 flex flex-col gap-0.5 text-xs" aria-label="Simulated activities">
    <div class="font-medium">Simulated</div>
    {#if simulated === null}
      <div class="text-muted-foreground">Reading its simulated activities…</div>
    {:else}
      {#each simulations as simulation (simulation.id)}
        {@const runs = simulated.filter(run => run.ref.sourceId === simulation.id)}
        <div>
          {#if runs.length}
            In {sourceLabels[simulation.id] ?? simulation.id}:
            {#each runs as run, index (run.ref.activityId)}
              {#if index},
              {/if}
              <button class="text-primary underline" on:click={() => dispatch('select', run)}
                >{details.type} (span {run.ref.activityId})</button
              >
            {/each}
          {:else}
            <span class="text-muted-foreground"
              >Not in {sourceLabels[simulation.id] ?? simulation.id} (simulated before it was added, or not simulated)</span
            >
          {/if}
        </div>
      {/each}
    {/if}
  </section>
{/if}
{#if details.directiveId !== undefined}
  <section class="mb-2 flex flex-col gap-0.5 text-xs" aria-label="Directive">
    <div class="font-medium">Directive</div>
    <div>
      {#if fromPlan && fromDirective}
        Simulated from
        <button
          class="text-primary underline"
          on:click={() => fromDirective && selectDirective(fromPlan.id, fromDirective)}
          >{fromDirective.name || fromDirective.type}</button
        >
        <span class="text-muted-foreground">(directive {details.directiveId}, in the plan now)</span>
      {:else if fromPlan}
        <span class="text-muted-foreground"
          >Simulated from directive {details.directiveId}, which is no longer in {sourceLabels[fromPlan.id] ??
            'the plan'}</span
        >
      {:else}
        <span class="text-muted-foreground"
          >Simulated from directive {details.directiveId}; add its plan to this analysis to follow it</span
        >
      {/if}
    </div>
  </section>
{/if}
{#if datasetId !== null && (assigned?.length || generated.length)}
  <section class="mb-2 flex flex-col gap-0.5 text-xs" aria-label="Generated sequences">
    <div class="font-medium">Sequences</div>
    {#if assigned?.length}
      <div>
        Assigned to {assigned.join(', ')} <span class="text-muted-foreground">now</span>
      </div>
    {/if}
    {#each generated as sequence (sequence.sourceId)}
      <div>
        {#if sequence.steps.length}
          Expanded into
          {#each sequence.steps as entry, index (entry.id)}
            {#if index},
            {/if}
            <button
              class="text-primary underline"
              on:click={() => inspect({ entryId: entry.id, kind: 'sequence', sourceId: sequence.sourceId })}
              >{entry.step.name ?? entry.step.type} (step {entry.step.position})</button
            >
          {/each}
          of {sequence.mission.sequenceId}
        {:else}
          <span class="text-muted-foreground"
            >No step of {sequence.mission.sequenceId} names this activity{sequence.attributed
              ? ''
              : ' (its steps name none)'}.</span
          >
        {/if}
      </div>
    {/each}
    {#if assigned?.length && !generated.length}
      <div class="text-muted-foreground">
        Its generated sequence isn't in this analysis: analyze the file from SeqDev to see its commands.
      </div>
    {/if}
  </section>
{/if}
