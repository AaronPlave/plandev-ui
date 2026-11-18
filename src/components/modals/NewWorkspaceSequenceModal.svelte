<svelte:options immutable={true} />

<script lang="ts">
  import { Input as InputStellar, Label } from '@nasa-jpl/stellar-svelte';
  import type { FileStarter } from '@nasa-jpl/plandev-sequence-languages';
  import { createEventDispatcher } from 'svelte';
  import InputInternal from '../../components/form/Input.svelte';
  import * as Sidebar from '../../components/ui/Sidebar/index.js';
  import { WorkspaceContentType } from '../../enums/workspace';
  import type { Workspace, WorkspaceNodeEvent } from '../../types/workspace';
  import type { WorkspaceTreeNode } from '../../types/workspace-tree-view';
  import { joinPath, removeFirstPathSegment } from '../../utilities/workspaces';
  import WorkspaceTreeView from '../workspace/WorkspaceTreeView/WorkspaceTreeView.svelte';
  import Modal from './Modal.svelte';
  import ModalContent from './ModalContent.svelte';
  import ModalFooter from './ModalFooter.svelte';
  import ModalHeader from './ModalHeader.svelte';

  export let currentWorkspace: Workspace | null | undefined = null;
  export let currentWorkspaceContents: WorkspaceTreeNode | null;
  export let height: number = 500;
  export let width: number = 420;
  export let startingPath: string = '';
  /** Kinds of file the parcel's adaptation offers, besides a blank file. */
  export let starters: FileStarter[] = [];

  const dispatch = createEventDispatcher<{
    close: void;
    confirm: { filePath: string; starter: FileStarter | null; target: { destination: string; name: string } | null };
  }>();

  let filePath: string = joinPath([currentWorkspace?.name ?? '', startingPath]);
  let fileName: string = '';
  let starterIndex: number = -1; // -1: blank file
  let destination: string = '';

  $: starter = starters[starterIndex] ?? null;
  $: action = starter?.action ?? null;
  // Folders an Action-made file can go to: those holding its marker file (e.g. a Cargo project's Cargo.toml).
  $: destinations = action
    ? foldersContaining(currentWorkspaceContents?.contents ?? [], action.destination.containing)
    : [];
  $: if (action && destinations.length && !destinations.includes(destination)) {
    destination = destinations.find(d => isWithin(startingPath, d)) ?? destinations[0];
  }
  $: choosingNewDestination = !!action && destinations.length === 0 && !!action.destination.createIn;
  $: chosenFolder = removeFirstPathSegment(filePath);
  $: name = starter ? fileName.trim().replace(new RegExp(`${escape(starter.fileExtension)}$`), '') : fileName.trim();
  $: newDestination = joinPath([chosenFolder, action?.destination.newFolder ?? '']);
  $: target = { destination: choosingNewDestination ? newDestination : destination, name };
  $: nameError = name && starter?.validateName ? starter.validateName(name) : null;
  $: unavailable = !!action && destinations.length === 0 && !action.destination.createIn;
  $: resultPath = !name
    ? ''
    : action
      ? action.createdFile(target)
      : joinPath([chosenFolder, starter && !/\.[^/.]+$/.test(name) ? `${name}${starter.fileExtension}` : name]);
  $: canConfirm = !!name && !nameError && !unavailable;

  function escape(text: string) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function isWithin(path: string, folder: string) {
    return folder === '' || path === folder || path.startsWith(`${folder}/`);
  }

  function foldersContaining(nodes: WorkspaceTreeNode[], marker: string, prefix: string = ''): string[] {
    const here = nodes.some(n => n.type !== WorkspaceContentType.Directory && n.name === marker) ? [prefix] : [];
    return here.concat(
      ...nodes
        .filter(n => n.type === WorkspaceContentType.Directory)
        .map(n => foldersContaining(n.contents ?? [], marker, prefix ? `${prefix}/${n.name}` : (n.name ?? ''))),
    );
  }

  function onFolderClicked(event: CustomEvent<WorkspaceNodeEvent>) {
    filePath = event.detail.treeNodePath;
  }

  function onConfirm() {
    if (!canConfirm) {
      return;
    }
    // filePath includes workspace name as first segment (e.g., "workspace/folder/subfolder")
    // Remove it since the API expects paths relative to the workspace root
    dispatch('confirm', { filePath: resultPath, starter, target: starter ? target : null });
  }

  function onKeydown(event: KeyboardEvent) {
    const { key } = event;
    if (key === 'Enter') {
      event.preventDefault();
      onConfirm();
    }
  }
</script>

<svelte:window on:keydown={onKeydown} />

<Modal height={starters.length ? height + 40 * (starters.length + 1) : height} {width} on:close>
  <ModalHeader on:close>New File</ModalHeader>
  <ModalContent style="overflow: hidden;">
    <div class="grid h-full grid-rows-[min-content_min-content_auto_min-content_min-content] gap-2 overflow-hidden">
      {#if starters.length}
        <fieldset class="flex flex-col gap-1">
          <legend class="pb-1 text-xs">Kind of file</legend>
          {#each [null, ...starters] as option, i}
            <label class="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 hover:bg-muted">
              <input class="mt-0.5" type="radio" name="file-starter" value={i - 1} bind:group={starterIndex} />
              <span>
                <span class="text-sm">{option?.label ?? 'Blank file'}</span>
                <span class="block text-xs text-muted-foreground">
                  {option ? (option.description ?? '') : 'An empty file with the name you choose'}
                </span>
              </span>
            </label>
          {/each}
        </fieldset>
      {:else}
        <div />
      {/if}

      {#if action}
        <div class="text-xs">
          {#if destinations.length === 1}
            In the {action.destination.label} <span class="font-semibold">{destinations[0] || '(workspace root)'}</span>
          {:else if destinations.length > 1}
            <label class="flex flex-col gap-1">
              <span>{action.destination.label}</span>
              <select class="st-select" bind:value={destination}>
                {#each destinations as d}
                  <option value={d}>{d || '(workspace root)'}</option>
                {/each}
              </select>
            </label>
          {:else if action.destination.createIn}
            No {action.destination.label} yet: a new one{action.destination.newFolder
              ? `, ${action.destination.newFolder}/,`
              : ''} will be set up in the folder you choose.
          {:else}
            <span role="alert">No {action.destination.label} in this workspace yet.</span>
          {/if}
        </div>
      {:else}
        <div>
          <div class="pb-0.5 text-xs">Current Location:</div>
          <div class="py-1">
            <span class="font-semibold">{joinPath([currentWorkspace?.name ?? '', startingPath])}</span>
          </div>
        </div>
      {/if}

      {#if !action || choosingNewDestination}
        <Sidebar.Provider
          style="--sidebar-width: auto"
          className="min-h-full overflow-y-auto rounded-md border-(--st-gray-20) border-2"
        >
          <Sidebar.Content>
            <Sidebar.Menu className="h-full">
              <WorkspaceTreeView
                selectedTreeNodePath={filePath}
                treeNode={currentWorkspaceContents}
                showFiles={false}
                showRootNode={true}
                on:nodeClicked={onFolderClicked}
              />
            </Sidebar.Menu>
          </Sidebar.Content>
        </Sidebar.Provider>
      {:else}
        <div />
      {/if}

      <InputInternal layout="stacked" class="px-0.5 py-1">
        <Label size="sm" for="file-name">{action ? 'Name' : 'File Name'}</Label>
        <InputStellar
          sizeVariant="xs"
          id="file-name"
          name="file-name"
          autocomplete="off"
          aria-label="File Name"
          aria-invalid={!!nameError}
          placeholder={starter
            ? `e.g. ${starter.namePlaceholder ?? 'name'}${action ? '' : starter.fileExtension}`
            : 'Enter file name (e.g. my_sequence.seq)'}
          bind:value={fileName}
        />
      </InputInternal>
      <div class="min-h-4 text-xs" aria-live="polite">
        {#if nameError}
          <span class="text-destructive">{nameError}</span>
        {:else if resultPath && starter}
          Creates <span class="font-mono">{resultPath}</span>
        {/if}
      </div>
    </div>
  </ModalContent>
  <ModalFooter>
    <button class="st-button secondary" on:click={() => dispatch('close')}> Cancel </button>
    <button class="st-button" disabled={!canConfirm} on:click={onConfirm}> Confirm </button>
  </ModalFooter>
</Modal>
