<svelte:options immutable={true} />

<script lang="ts">
  import { getGeneratedFromPlanUrl, type GeneratedFrom } from '../../utilities/generatedProvenance';
  import { getShortISOForDate } from '../../utilities/time';

  export let from: GeneratedFrom;
</script>

<section class="flex min-w-0 flex-col gap-2 rounded border border-border p-2" aria-label="Generated from">
  <div class="font-medium">Generated from a plan</div>
  <dl class="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1">
    <dt class="text-muted-foreground">Plan</dt>
    <dd class="break-words">
      <a class="underline" href={getGeneratedFromPlanUrl(from)}>{from.planName}</a> (id {from.planId})
    </dd>
    <dt class="text-muted-foreground">Simulation</dt>
    <dd>dataset {from.simulationDatasetId}</dd>
    <dt class="text-muted-foreground">Sequence</dt>
    <dd class="break-words">{from.seqId}</dd>
    <dt class="text-muted-foreground">How</dt>
    <dd>
      Sequence template expansion{#if from.expandedAt}, {getShortISOForDate(new Date(from.expandedAt))}{/if}
      {#if from.expandedTemplateId !== null}(expansion {from.expandedTemplateId}){/if}
    </dd>
    <dt class="text-muted-foreground">Activities</dt>
    <dd class="flex flex-wrap gap-x-2">
      {#each from.spanIds as spanId}
        <a class="underline" href={getGeneratedFromPlanUrl(from, spanId)}>span {spanId}</a>
      {:else}
        <span class="text-muted-foreground">none linked when it was written</span>
      {/each}
    </dd>
    <dt class="text-muted-foreground">Written</dt>
    <dd>{getShortISOForDate(new Date(from.writtenAt))}</dd>
  </dl>
  <div class="text-muted-foreground">
    Recorded when the file was written. Edits since then are not reflected in the plan, and the plan may have changed.
  </div>
</section>
