<svelte:options immutable={true} />

<script lang="ts">
  import type { CommandDictionary, FswCommand, HwCommand } from '@nasa-jpl/plandev-ampcs';
  import { Search } from 'lucide-svelte';
  import { createEventDispatcher } from 'svelte';
  import { commandDictionaries, getParsedCommandDictionary } from '../../../stores/sequencing';
  import { getUserStore } from '../../../stores/user';
  import { parcel } from '../../../stores/workspaces';
  import type { UserStore } from '../../../types/app';
  import {
    argumentSignature,
    diffCommandDictionaries,
    diffEnums,
    type CommandChange,
  } from '../../../utilities/sequence-editor/mission-reference';
  import { tooltip } from '../../../utilities/tooltip';

  /** The parcel's (newer) dictionary; another uploaded version is chosen as the baseline. */
  export let commandDictionary: CommandDictionary;

  const dispatch = createEventDispatcher<{ findUses: string }>();
  const user: UserStore = getUserStore();
  const kindLabels: Record<CommandChange['kind'], string> = {
    added: 'Added',
    description: 'Description changed',
    removed: 'Removed',
    signature: 'Signature changed',
  };

  let baseline: CommandDictionary | null = null;
  let baselineId: number | null = null;
  let changes: CommandChange[] = [];
  let error: string | null = null;
  let expanded: string | null = null;
  let loading: boolean = false;
  let loadToken = 0;

  $: currentId = $parcel?.command_dictionary_id ?? null;
  // Same mission first (the usual parcel change), newest first.
  $: candidates = $commandDictionaries
    .filter(d => d.id !== currentId)
    .sort(
      (a, b) =>
        Number(b.mission === commandDictionary.header.mission_name) -
          Number(a.mission === commandDictionary.header.mission_name) || b.id - a.id,
    );
  $: if (baselineId === null && candidates.length) {
    baselineId = candidates[0].id;
  }
  $: load(baselineId);
  $: changes = baseline ? diffCommandDictionaries(baseline, commandDictionary) : [];
  $: enumChanges = baseline ? diffEnums(baseline, commandDictionary) : [];
  $: groups = (['removed', 'signature', 'added', 'description'] as const)
    .map(kind => [kind, changes.filter(c => c.kind === kind)] as const)
    .filter(([, list]) => list.length);

  async function load(id: number | null) {
    const token = ++loadToken;
    const metadata = $commandDictionaries.find(d => d.id === id);
    baseline = null;
    error = null;
    if (!metadata) {
      return;
    }
    loading = true;
    const parsed = await getParsedCommandDictionary(metadata, $user);
    if (token === loadToken) {
      baseline = parsed;
      error = parsed ? null : 'Could not load that dictionary.';
      loading = false;
    }
  }

  function sides(change: CommandChange, before: CommandDictionary) {
    return [
      { command: change.before, enumMap: before.enumMap, title: 'Before' },
      { command: change.after, enumMap: commandDictionary.enumMap, title: 'After' },
    ];
  }

  function args(command: FswCommand | HwCommand | null, enumMap: CommandDictionary['enumMap']): string[] {
    return command?.type === 'fsw_command'
      ? command.arguments.map(a => `${a.name}: ${argumentSignature(a, enumMap)}`)
      : [];
  }
</script>

<div class="flex flex-col gap-2 px-4 py-2 text-xs">
  {#if !candidates.length}
    <div class="text-muted-foreground">No other command dictionary is uploaded to compare with.</div>
  {:else}
    <label class="flex flex-col gap-1">
      <span class="font-medium">Compare the parcel's dictionary with</span>
      <select class="st-select w-full" bind:value={baselineId}>
        {#each candidates as candidate}
          <option value={candidate.id}>{candidate.mission} {candidate.version} (id {candidate.id})</option>
        {/each}
      </select>
    </label>
    <div class="text-muted-foreground">
      Changes from the selected version to {commandDictionary.header.mission_name}
      {commandDictionary.header.version}. Command signatures only; telemetry and parameters are not compared.
    </div>
    {#if loading}
      <div class="text-muted-foreground">Loading…</div>
    {:else if error}
      <div class="text-destructive">{error}</div>
    {:else if baseline && !changes.length && !enumChanges.length}
      <div class="text-muted-foreground">No command differences.</div>
    {/if}
    {#each groups as [kind, list]}
      <div class="pt-1 font-medium">{kindLabels[kind]} ({list.length})</div>
      {#each list as change (change.stem)}
        <div class="rounded border">
          <div class="flex items-center gap-1 px-2 py-1">
            <button
              class="min-w-0 flex-1 truncate text-left font-mono hover:underline"
              aria-expanded={expanded === change.stem}
              on:click={() => (expanded = expanded === change.stem ? null : change.stem)}>{change.stem}</button
            >
            {#if kind !== 'added'}
              <button
                aria-label={`Find uses of ${change.stem}`}
                class="text-muted-foreground hover:text-foreground"
                on:click={() => dispatch('findUses', change.stem)}
                use:tooltip={{ content: 'Find text uses in the workspace', placement: 'top' }}
              >
                <Search size={14} />
              </button>
            {/if}
          </div>
          {#each change.details as detail}
            <div class="px-2 pb-1 text-muted-foreground">{detail}</div>
          {/each}
          {#if expanded === change.stem && baseline}
            <div class="grid grid-cols-2 gap-2 border-t px-2 py-1">
              {#each sides(change, baseline) as { command, enumMap, title }}
                <div class="min-w-0">
                  <div class="font-medium">{title}</div>
                  {#if command}
                    <div class="break-words pb-1">{command.description}</div>
                    {#each args(command, enumMap) as arg}
                      <div class="break-all font-mono">{arg}</div>
                    {:else}
                      <div class="text-muted-foreground">No arguments</div>
                    {/each}
                  {:else}
                    <div class="text-muted-foreground">Not in this version</div>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    {/each}
    {#if enumChanges.length}
      <div class="pt-1 font-medium">Enum values changed ({enumChanges.length})</div>
      {#each enumChanges as change (change.name)}
        <div class="rounded border px-2 py-1">
          <div class="font-mono">{change.name}</div>
          {#if change.removed.length}
            <div class="text-muted-foreground">removed: {change.removed.join(', ')}</div>
          {/if}
          {#if change.added.length}
            <div class="text-muted-foreground">added: {change.added.join(', ')}</div>
          {/if}
        </div>
      {/each}
    {/if}
  {/if}
</div>
