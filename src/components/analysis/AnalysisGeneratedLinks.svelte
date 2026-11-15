<svelte:options immutable={true} />

<!--
  Links between a simulated activity and the sequences generated from it, both ways, from what is recorded only:
  PlanDev's assignment of the activity to a sequence, and the steps of this analysis's authored sequences that say
  (metadata.simulatedActivityId) they were expanded from it. For an authored step, the way back to its sequence.
  Nothing is matched by name or time.
-->
<script lang="ts">
  import { analysisSequenceFocus } from '../../stores/analysis';
  import type { AnalysisSourceBinding, AnalysisSourceRevision } from '../../types/analysis';
  import type { User } from '../../types/app';
  import { getAuthoredSections, getAuthoredSequenceSources } from '../../utilities/analysisSequence';
  import type { AnalysisActivityDetails } from '../../utilities/analysisActivityDetails';
  import effects from '../../utilities/effects';

  export let bindings: AnalysisSourceBinding[] = [];
  export let details: AnalysisActivityDetails;
  export let revisions: AnalysisSourceRevision[] = [];
  export let user: User | null;

  let assigned: string[] | null = null;

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
  // An authored step of this analysis: its place in its sequence.
  $: ownStep =
    binding?.kind === 'imported' && details.metadata?.recordKind === 'authored_step'
      ? authored.find(source => source.binding.id === binding?.id) && typeof details.metadata.step === 'number'
        ? `steps:${details.metadata.step}`
        : null
      : null;
  $: loadAssigned(datasetId, details.ref.activityId);

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

{#if ownStep}
  <div class="mb-2 text-xs">
    <button
      class="text-primary underline"
      on:click={() => ($analysisSequenceFocus = { entryId: ownStep ?? undefined, sourceId: details.ref.sourceId })}
      >Show in its sequence</button
    >
    <span class="text-muted-foreground">(every step, with the ones that have no absolute time)</span>
  </div>
{:else if datasetId !== null && (assigned?.length || generated.length)}
  <section class="mb-2 flex flex-col gap-0.5 text-xs" aria-label="Generated sequences">
    <div class="font-medium">Sequences</div>
    {#if assigned?.length}
      <div>
        Assigned to {assigned.join(', ')} <span class="text-muted-foreground">(PlanDev's sequence assignment)</span>
      </div>
    {/if}
    {#each generated as sequence (sequence.sourceId)}
      <div>
        {#if sequence.steps.length}
          Expanded into
          {#each sequence.steps as entry, index (entry.id)}
            {#if index}, {/if}
            <button
              class="text-primary underline"
              on:click={() => ($analysisSequenceFocus = { entryId: entry.id, sourceId: sequence.sourceId })}
              >{entry.step.name ?? entry.step.type} (step {entry.step.position})</button
            >
          {/each}
          of {sequence.mission.sequenceId}
          <span class="text-muted-foreground">(as those steps say)</span>
        {:else}
          <span class="text-muted-foreground"
            >No step of {sequence.mission.sequenceId} says it came from this activity{sequence.attributed
              ? ''
              : ': its steps are not attributed to activities, only the sequence as a whole'}.</span
          >
        {/if}
      </div>
    {/each}
    {#if assigned?.length && !generated.length}
      <div class="text-muted-foreground">
        No generated sequence of this simulation is in this analysis. Analyze its file from SeqDev, then add it here,
        to see the commands made from this activity.
      </div>
    {/if}
  </section>
{/if}
