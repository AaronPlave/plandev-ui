<svelte:options immutable={true} />

<script lang="ts">
  import type { CommandDictionary, FswCommand, HwCommand } from '@nasa-jpl/plandev-ampcs';
  import type { CommandInfoMapper, PhoenixContext } from '@nasa-jpl/plandev-sequence-languages';
  import ChevronRightIcon from '@nasa-jpl/stellar/icons/chevron_right.svg?component';
  import CloseIcon from '@nasa-jpl/stellar/icons/close.svg?component';
  import SearchIcon from '@nasa-jpl/stellar/icons/search.svg?component';
  import type { EditorView } from 'codemirror';
  import { Copy, Search } from 'lucide-svelte';
  import { createEventDispatcher } from 'svelte';
  import {
    planCommandInsert,
    searchMissionReference,
    type MissionReferenceKind,
  } from '../../../utilities/sequence-editor/mission-reference';
  import { isFswCommand } from '../../../utilities/sequence-editor/sequence-utils';
  import { showFailureToast, showSuccessToast } from '../../../utilities/toast';
  import { tooltip } from '../../../utilities/tooltip';
  import Input from '../../form/Input.svelte';
  import CommandArgument from './CommandArg.svelte';
  import DictionaryComparison from './DictionaryComparison.svelte';
  import DictionaryItemDetails from './DictionaryItemDetails.svelte';

  export let commandDictionary: CommandDictionary;
  /** The editor to insert commands into; without one (or a language that can't), Insert is not offered. */
  export let commandInfoMapper: CommandInfoMapper | null = null;
  export let editorSequenceView: EditorView | null = null;
  /** Offer comparison with other uploaded dictionary versions. */
  export let enableComparison: boolean = false;
  /** Offer Find uses (the parent searches the workspace). */
  export let enableFindUses: boolean = false;
  /** Telemetry and parameter dictionaries; commands only when absent. */
  export let phoenixContext: Pick<PhoenixContext, 'channelDictionary' | 'parameterDictionaries'> | null = null;
  export let readOnly: boolean = false;
  export let selectedCommandDefinition: (FswCommand | HwCommand) | null = null;

  const dispatch = createEventDispatcher<{
    findUses: string;
    selectCommandDefinition: (FswCommand | HwCommand) | null;
  }>();
  const kindLabels: Record<MissionReferenceKind, string> = {
    command: 'Commands',
    parameter: 'Parameters',
    telemetry: 'Telemetry',
  };
  const RESULT_LIMIT = 300;

  let comparing: boolean = false;
  let kind: MissionReferenceKind = 'command';
  let searchValue: string = '';
  let selectedItem: { kind: 'parameter' | 'telemetry'; name: string } | null = null;

  $: context = {
    channelDictionary: phoenixContext?.channelDictionary ?? null,
    commandDictionary,
    parameterDictionaries: phoenixContext?.parameterDictionaries ?? [],
  };
  $: dictionaryLabel =
    commandDictionary.id || `${commandDictionary.header.mission_name} ${commandDictionary.header.version}`.trim();
  $: kinds = (['command', 'telemetry', 'parameter'] as const).filter(
    k =>
      k === 'command' ||
      (k === 'telemetry' && !!context.channelDictionary?.telemetries.length) ||
      (k === 'parameter' && context.parameterDictionaries.some(d => d.params.length)),
  );
  $: results = searchMissionReference(context, kind, searchValue);
  // A command chosen elsewhere (e.g. from the cursor) replaces a telemetry/parameter selection.
  $: if (selectedCommandDefinition) {
    selectedItem = null;
  }
  $: selectedName = selectedCommandDefinition?.stem ?? selectedItem?.name ?? null;
  $: commandCall =
    selectedCommandDefinition && isFswCommand(selectedCommandDefinition)
      ? (commandInfoMapper?.formatCommandCall?.(selectedCommandDefinition, commandDictionary.enumMap) ?? null)
      : null;
  $: insertBlockedReason = !editorSequenceView
    ? 'Open a sequence to insert commands'
    : readOnly || editorSequenceView.state.readOnly
      ? 'This file is read-only'
      : null;

  function onClear() {
    selectedItem = null;
    dispatch('selectCommandDefinition', null);
  }

  async function onCopy() {
    const text = commandCall ?? selectedName;
    if (text) {
      try {
        await navigator.clipboard.writeText(text);
        showSuccessToast(`"${text}" copied to clipboard`);
      } catch {
        showFailureToast(`Error copying "${text}" to clipboard`);
      }
    }
  }

  function onInsert() {
    if (!editorSequenceView || !commandInfoMapper || !commandCall || insertBlockedReason) {
      return;
    }
    const view = editorSequenceView;
    const plan = planCommandInsert(view.state, commandInfoMapper, commandCall, view.state.selection.main.head);
    if (typeof plan === 'string') {
      showFailureToast(plan);
      return;
    }
    view.dispatch({ ...plan, scrollIntoView: true, userEvent: 'input.insertCommand' });
    view.focus();
  }

  function onSelect(entryKind: MissionReferenceKind, name: string) {
    if (entryKind === 'command') {
      dispatch(
        'selectCommandDefinition',
        commandDictionary.fswCommandMap[name] ?? commandDictionary.hwCommandMap[name] ?? null,
      );
    } else {
      dispatch('selectCommandDefinition', null);
      selectedItem = { kind: entryKind, name };
    }
  }
</script>

<div class="command-dictionary-container">
  <div class="dictionary-name">
    <div class="breadcrumbs-container text-xs">
      {#if selectedName !== null}
        <button class="st-button-link breadcrumb" on:click={onClear}>{dictionaryLabel}</button>
        <ChevronRightIcon />
        <div class="breadcrumb">{selectedName}</div>
      {:else}
        <span class="truncate" title={dictionaryLabel}>{dictionaryLabel}</span>
      {/if}
    </div>
    <div class="breadcrumbs-icons">
      {#if selectedName !== null}
        <button
          on:click={onCopy}
          use:tooltip={{ content: commandCall ? 'Copy command call' : 'Copy name', placement: 'top' }}
        >
          <Copy size={16} />
        </button>
        <button on:click={onClear} use:tooltip={{ content: 'Back to search', placement: 'top' }}>
          <CloseIcon />
        </button>
      {:else if enableComparison}
        <button
          class="text-xs font-normal"
          aria-pressed={comparing}
          on:click={() => (comparing = !comparing)}
          use:tooltip={{ content: 'Compare with another uploaded command dictionary', placement: 'top' }}
          >{comparing ? 'Search' : 'Compare'}</button
        >
      {/if}
    </div>
  </div>
  {#if comparing && selectedName === null}
    <div class="overflow-auto">
      <DictionaryComparison {commandDictionary} on:findUses />
    </div>
  {:else}
    <div class="dictionary-search" class:hidden={selectedName !== null}>
      {#if kinds.length > 1}
        <div class="flex gap-1 px-4" role="tablist" aria-label="Dictionary">
          {#each kinds as k}
            <button
              role="tab"
              aria-selected={kind === k}
              class="rounded px-2 py-0.5 text-xs {kind === k ? 'bg-muted font-medium' : 'text-muted-foreground'}"
              on:click={() => (kind = k)}>{kindLabels[k]}</button
            >
          {/each}
        </div>
      {/if}
      <div class="search-input">
        <Input>
          <div class="search-icon" slot="left"><SearchIcon /></div>
          <input
            class="st-input w-full"
            name="dictionary-search"
            aria-label="Search the mission reference"
            placeholder={kind === 'command'
              ? 'Search names, descriptions, arguments, enum values'
              : 'Search names and descriptions'}
            bind:value={searchValue}
          />
        </Input>
      </div>
      <div class="st-typography-body dictionary-results">
        {#each results.slice(0, RESULT_LIMIT) as result (result.name)}
          <div class="dictionary-result">
            <button class="st-button-link command-stem" on:click={() => onSelect(result.kind, result.name)}>
              {result.name}
            </button>
            {#if result.matchedIn}
              <div class="truncate text-xs text-muted-foreground">matches {result.matchedIn}</div>
            {/if}
          </div>
        {:else}
          <div class="text-sm">Nothing matched your search.</div>
        {/each}
        {#if results.length > RESULT_LIMIT}
          <div class="text-xs text-muted-foreground">
            {results.length - RESULT_LIMIT} more — refine the search to see them.
          </div>
        {/if}
      </div>
    </div>
    <div class="command-metadata-container" class:hidden={selectedName === null}>
      {#if selectedItem}
        <DictionaryItemDetails
          kind={selectedItem.kind}
          label={selectedItem.kind === 'telemetry' ? 'Telemetry channel' : 'Parameter'}
          name={selectedItem.name}
          phoenixContext={{ ...context, librarySequences: [] }}
        />
      {:else if selectedCommandDefinition}
        <div class="command-type text-xs">
          {#if isFswCommand(selectedCommandDefinition)}
            FSW Command
          {:else}
            HW Command
          {/if}
        </div>
        <div class="command-description text-xs">
          {selectedCommandDefinition?.description}
        </div>
        {#if commandCall}
          <code class="block whitespace-pre-wrap break-all rounded bg-muted px-2 py-1 text-xs">{commandCall}</code>
        {/if}
      {/if}
      {#if selectedName !== null && (commandCall || enableFindUses)}
        <div class="flex flex-wrap gap-2">
          {#if commandCall}
            <button
              class="st-button secondary"
              disabled={!!insertBlockedReason}
              on:click={onInsert}
              use:tooltip={{
                content: insertBlockedReason ?? 'Insert this call as a new step at the cursor',
                placement: 'top',
              }}>Insert</button
            >
          {/if}
          {#if enableFindUses}
            <button
              class="st-button secondary flex items-center gap-1"
              on:click={() => selectedName && dispatch('findUses', selectedName)}
              use:tooltip={{ content: 'Search workspace files for this name (text search)', placement: 'top' }}
            >
              <Search size={14} /> Find uses
            </button>
          {/if}
        </div>
      {/if}
      {#if selectedCommandDefinition && isFswCommand(selectedCommandDefinition)}
        <div class="title text-xs">Arguments</div>
        <div class="command-arguments">
          {#each selectedCommandDefinition.arguments as argument}
            <CommandArgument commandArgumentDefinition={argument} enumMap={commandDictionary.enumMap} />
          {:else}
            <div class="text-xs text-muted-foreground">None</div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .command-dictionary-container {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: min-content auto;
    height: 100%;
    overflow: auto;
  }

  .dictionary-name {
    align-items: center;
    background: var(--st-gray-10);
    border-bottom: 1px solid var(--st-gray-20);
    display: grid;
    font-weight: 500;
    grid-template-columns: minmax(0, 1fr) min-content;
    padding: 8px 16px;
  }

  .breadcrumbs-container {
    column-gap: 4px;
    display: flex;
    min-width: 0;
  }

  .breadcrumbs-container :global(svg) {
    color: var(--st-gray-40);
  }

  .breadcrumbs-icons {
    align-items: center;
    column-gap: 4px;
    display: grid;
    grid-auto-flow: column;
  }

  .breadcrumbs-icons button {
    background: none;
    border: none;
    color: var(--st-button-icon-color);
    cursor: pointer;
    display: inline-flex;
    padding: 0;
  }

  .breadcrumb {
    max-width: 40%;
    overflow-x: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dictionary-search {
    display: flex;
    flex-flow: column;
    overflow: hidden;
    padding: 8px 0;
    row-gap: 8px;
  }

  .dictionary-search .search-input {
    padding: 0 16px;
  }

  .dictionary-search .search-icon {
    align-items: center;
    color: var(--st-gray-50);
    display: flex;
  }

  .dictionary-results {
    display: flex;
    flex-flow: column;
    height: 100%;
    overflow: auto;
    padding: 8px 16px;
    row-gap: 8px;
  }

  .command-dictionary-container .hidden {
    display: none;
  }

  .command-metadata-container {
    display: flex;
    flex-flow: column;
    overflow: hidden;
    padding: 8px 16px;
    row-gap: 8px;
  }

  .title {
    font-weight: 500;
  }

  .command-type {
    font-style: italic;
  }

  .command-stem {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .command-arguments {
    display: flex;
    flex-flow: column;
    height: 100%;
    overflow: auto;
    row-gap: 8px;
  }
</style>
