<svelte:options immutable={true} />

<script lang="ts">
  import { Checkbox, Input as InputStellar, Label } from '@nasa-jpl/stellar-svelte';
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import type { User } from '../../types/app';
  import type { WorkspaceSearchMatch, WorkspaceSearchResult, WorkspaceTreeNode } from '../../types/workspace-tree-view';
  import { flattenWorkspaceTreeWithPaths, getFileManager, WorkspaceApi } from '../../utilities/workspaces';
  import SectionTitle from '../ui/SectionTitle.svelte';
  import * as Sidebar from '../ui/Sidebar/index.js';
  import PanelHeader from './PanelHeader.svelte';

  export let folder: string = '';
  /** The search text; a parent sets it to run a search (e.g. Find uses). */
  export let query: string = '';
  export let user: User | null = null;
  export let workspaceId: number | null = null;
  export let workspaceTree: WorkspaceTreeNode | null | undefined = undefined;

  const dispatch = createEventDispatcher<{ openMatch: WorkspaceSearchMatch }>();

  let controller: AbortController | null = null;
  let error: string | null = null;
  let includeManaged: boolean = false;
  let inFolderOnly: boolean = false;
  let result: WorkspaceSearchResult | null = null;
  let root: HTMLDivElement;
  let searchedLength: number = 0;
  let searching: boolean = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  $: managedPaths = new Set(
    flattenWorkspaceTreeWithPaths(workspaceTree?.contents ?? [])
      .filter(node => getFileManager(node))
      .map(node => node.fullPath),
  );
  $: scope = inFolderOnly ? folder : '';
  $: shown = (result?.matches ?? []).filter(m => includeManaged || !managedPaths.has(m.path));
  $: hiddenManaged = (result?.matches.length ?? 0) - shown.length;
  $: groups = shown.reduce<[string, WorkspaceSearchMatch[]][]>((acc, m) => {
    const last = acc.at(-1);
    if (last && last[0] === m.path) {
      last[1].push(m);
    } else {
      acc.push([m.path, [m]]);
    }
    return acc;
  }, []);
  // A new query or scope supersedes (and cancels) the one in flight.
  $: schedule(query, scope);

  function schedule(text: string, where: string) {
    clearTimeout(timer);
    controller?.abort();
    if (text.trim().length < 2 || workspaceId === null) {
      result = null;
      searching = false;
      return;
    }
    // Results of the previous query are cleared, not left looking current while this one waits.
    result = null;
    searching = true;
    timer = setTimeout(() => run(text, where), 300);
  }

  async function run(text: string, where: string) {
    const current = (controller = new AbortController());
    searching = true;
    error = null;
    try {
      result = await WorkspaceApi.searchWorkspace(workspaceId as number, where, text, user, current.signal);
      searchedLength = text.length;
    } catch (e) {
      if (!current.signal.aborted) {
        error = (e as Error).message;
        result = null;
      }
    } finally {
      if (controller === current) {
        searching = false;
      }
    }
  }

  /** The snippet split around the matched text, for highlighting. */
  function parts(match: WorkspaceSearchMatch): [string, string, string] {
    const at = match.column - 1 - match.snippetStart;
    const end = at + searchedLength;
    return [match.snippet.slice(0, at), match.snippet.slice(at, end), match.snippet.slice(end)];
  }

  onMount(() => root.querySelector('input')?.focus());

  onDestroy(() => {
    clearTimeout(timer);
    controller?.abort();
  });
</script>

<div class="grid h-full grid-rows-[min-content_min-content_auto]" bind:this={root}>
  <Sidebar.Header className="p-0">
    <PanelHeader>
      <SectionTitle>Find in Workspace</SectionTitle>
    </PanelHeader>
  </Sidebar.Header>
  <div class="flex flex-col gap-1.5 border-b border-border p-2 text-xs">
    <InputStellar
      autocomplete="off"
      sizeVariant="xs"
      class="w-full"
      placeholder="Text in saved files"
      aria-label="Find in workspace"
      bind:value={query}
    />
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
      <div class="flex items-center gap-1">
        <Checkbox
          size="sm"
          id="search-in-folder"
          checked={inFolderOnly}
          disabled={!folder}
          on:click={() => (inFolderOnly = !inFolderOnly)}
        />
        <Label size="sm" for="search-in-folder">Only in {folder ? `${folder}/` : 'the current folder'}</Label>
      </div>
      <div class="flex items-center gap-1">
        <Checkbox
          size="sm"
          id="search-managed"
          checked={includeManaged}
          on:click={() => (includeManaged = !includeManaged)}
        />
        <Label size="sm" for="search-managed">Include managed files</Label>
      </div>
    </div>
    <div class="text-muted-foreground" role="status">
      {#if searching}
        Searching…
      {:else if error}
        <span class="text-destructive">{error}</span>
      {:else if result}
        {shown.length}
        {shown.length === 1 ? 'match' : 'matches'} in {groups.length}
        {groups.length === 1 ? 'file' : 'files'}{result.truncated ? ' (first results only: narrow the search)' : ''}.
        {#if hiddenManaged > 0}{hiddenManaged} in managed files not shown.{/if}
        {#if result.filesSkipped > 0}{result.filesSkipped} binary or large files not searched.{/if}
      {:else}
        Case-insensitive, in saved files (not unsaved edits).
      {/if}
    </div>
  </div>
  <div class="min-h-0 overflow-auto text-xs" aria-label="Search results">
    {#each groups as [path, matches] (path)}
      <div class="sticky top-0 truncate bg-background px-2 pt-1.5 font-medium" title={path}>{path}</div>
      {#each matches as match (match.line)}
        {@const [before, hit, after] = parts(match)}
        <button
          type="button"
          class="flex w-full gap-2 px-2 py-0.5 text-left font-mono hover:bg-muted focus:bg-muted focus:outline-none"
          title="{path}:{match.line}"
          on:click={() => dispatch('openMatch', match)}
        >
          <span class="w-8 flex-shrink-0 text-right text-muted-foreground">{match.line}</span>
          <span class="truncate whitespace-pre"
            >{before.trimStart()}<mark class="bg-yellow-200 dark:bg-yellow-800">{hit}</mark>{after}</span
          >
        </button>
      {/each}
    {/each}
  </div>
</div>
