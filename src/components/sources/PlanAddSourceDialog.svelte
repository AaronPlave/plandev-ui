<svelte:options immutable={true} />

<!--
  Using an imported source in this plan: pick a successfully imported revision and it appears under the plan's
  Sources. The plan references the revision, it never copies it. Importing a new file is done on the Sources page.
-->
<script lang="ts">
  import { base } from '$app/paths';
  import { Button, Dialog } from '@nasa-jpl/stellar-svelte';
  import { planSources } from '../../stores/timelineSources';
  import type { AnalysisSourceOptions } from '../../types/analysis';
  import type { User } from '../../types/app';
  import type { PlanWithOwners } from '../../types/permissions';
  import { getRevisionSummary, getRevisionVersionLabel, splitSourceRevisions } from '../../utilities/analysis';
  import effects from '../../utilities/effects';
  import { queryPermissions } from '../../utilities/permissions';

  export let open: boolean = false;
  export let plan: PlanWithOwners;
  export let user: User | null;

  let adding: number | null = null;
  let filter: string = '';
  let options: AnalysisSourceOptions | null = null;

  $: if (open) {
    effects.getAnalysisSourceOptions(user).then(loaded => (options = loaded));
  }
  $: canAdd = queryPermissions.CREATE_PLAN_SOURCE(user, plan);
  $: used = new Set($planSources.map(({ source_revision }) => source_revision.id));
  $: needle = filter.trim().toLowerCase();
  $: sources = (options?.sources ?? [])
    .filter(source => !needle || source.name.toLowerCase().includes(needle))
    .map(source => {
      const { older, usable } = splitSourceRevisions(source.revisions);
      // Only a finished import can be read.
      return { ...source, revisions: [...(usable ? [usable] : []), ...older.filter(r => r.status === 'success')] };
    })
    .filter(source => source.revisions.length);

  async function add(source: { name: string }, revision: { id: number }) {
    adding = revision.id;
    await effects.createPlanSource(plan, { id: revision.id, label: source.name }, user);
    adding = null;
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="flex max-h-[80vh] max-w-[560px] flex-col gap-3">
    <Dialog.Header>
      <Dialog.Title>Add Source to Plan</Dialog.Title>
      <Dialog.Description>
        Use an imported source in this plan. To bring in a new file, import it on the
        <a class="underline" href="{base}/sources">Sources page</a> first.
      </Dialog.Description>
    </Dialog.Header>
    {#if !canAdd}
      <div class="text-xs text-muted-foreground">Only the plan's owner can add sources to it.</div>
    {/if}
    <input bind:value={filter} class="st-input w-full" placeholder="Filter" aria-label="Filter sources" />
    <div class="min-h-0 flex-1 overflow-auto text-xs">
      {#if !options}
        <div class="text-muted-foreground">Loading…</div>
      {:else}
        {#each sources as source (source.id)}
          <div class="source">
            <div class="text-sm font-medium">{source.name}</div>
            {#each source.revisions as revision, i (revision.id)}
              <div class="option">
                <div class="min-w-0">
                  <div>
                    {getRevisionVersionLabel(revision)}
                    {#if i === 0}<span class="ml-1 text-muted-foreground">· latest successful</span>{/if}
                  </div>
                  <div class="truncate text-muted-foreground">{getRevisionSummary(revision)}</div>
                </div>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!canAdd || used.has(revision.id) || adding !== null}
                  on:click={() => add(source, revision)}>{used.has(revision.id) ? 'Added' : 'Add'}</Button
                >
              </div>
            {/each}
          </div>
        {:else}
          <div class="text-muted-foreground">No imported sources{needle ? ' match' : ' yet'}.</div>
        {/each}
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>

<style>
  .source {
    border-bottom: 1px solid var(--st-gray-20);
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 0;
  }

  .option {
    align-items: center;
    display: flex;
    gap: 8px;
    justify-content: space-between;
    padding-left: 8px;
  }
</style>
