<svelte:options immutable={true} />

<script lang="ts">
  import { json, jsonParseLinter } from '@codemirror/lang-json';
  import { linter } from '@codemirror/lint';
  import { Compartment, EditorState, Transaction } from '@codemirror/state';
  import { EditorView } from '@codemirror/view';
  import { Button } from '@nasa-jpl/stellar-svelte';
  import { minimalSetup } from 'codemirror';
  import { createEventDispatcher, onDestroy } from 'svelte';
  import type { WorkspaceFileMetadata } from '../../types/workspace-tree-view';
  import { getBuildProvenance, type BuildArtifact } from '../../utilities/buildProvenance';
  import { getGeneratedFrom } from '../../utilities/generatedProvenance';
  import { formatBytes } from '../../utilities/text';
  import { getShortISOForDate } from '../../utilities/time';
  import { getUserDisplayNameFromIdentity } from '../../utilities/workspaces';
  import SectionTitle from '../ui/SectionTitle.svelte';
  import * as Sidebar from '../ui/Sidebar/index.js';
  import BuildProvenance from './BuildProvenance.svelte';
  import GeneratedFromDetails from './GeneratedFromDetails.svelte';
  import PanelHeader from './PanelHeader.svelte';
  import SourceBuilds from './SourceBuilds.svelte';

  const dispatch = createEventDispatcher<{
    updateUserMetadata: Record<string, unknown>;
  }>();

  /** Artifacts built from this file (their provenance names it as the source). */
  export let buildArtifacts: BuildArtifact[] = [];
  export let filePath: string | null = null;
  export let fileMetadata: WorkspaceFileMetadata | null = null;
  /** Bytes, from the workspace listing (not stored in the metadata). */
  export let fileSize: number | null = null;
  export let hasEditPermission: boolean = false;
  /** A sequence source: show Builds even when nothing has been built from it yet. */
  export let isSequenceFile: boolean = false;
  /** Changes when the file is saved (its ETag). */
  export let savedVersion: string | null = null;
  /** The editor's text when it has unsaved edits, else null. */
  export let unsavedText: string | null = null;

  let compartmentReadonly: Compartment = new Compartment();
  let editorReadOnly: boolean = false;
  let editorView: EditorView | null = null;
  let hasJsonError: boolean = false;
  let isEditing: boolean = false;
  let lastSavedContent: string = '';
  let previousFilePath: string | null = null;

  $: buildProvenance = getBuildProvenance(fileMetadata?.user);
  $: generatedFrom = getGeneratedFrom(fileMetadata?.user);
  $: hasReadableProvenance = !!buildProvenance || !!generatedFrom;
  $: editorReadOnly = !hasEditPermission || !isEditing;
  $: if (editorView && compartmentReadonly) {
    editorView.dispatch({
      effects: compartmentReadonly.reconfigure([
        EditorState.readOnly.of(editorReadOnly),
        EditorView.editable.of(!editorReadOnly),
      ]),
    });
  }

  // Detect file switches and external metadata changes
  $: if (filePath !== previousFilePath) {
    isEditing = false;
    previousFilePath = filePath;
    syncEditorContent(fileMetadata);
  } else if (fileMetadata && !isEditing) {
    const newContent = serializeUserMetadata(fileMetadata);
    if (newContent !== lastSavedContent) {
      syncEditorContent(fileMetadata);
    }
  }

  function serializeUserMetadata(metadata: WorkspaceFileMetadata | null): string {
    return metadata?.user ? JSON.stringify(metadata.user, null, 2) : '{}';
  }

  function syncEditorContent(metadata: WorkspaceFileMetadata | null) {
    const newContent = serializeUserMetadata(metadata);
    lastSavedContent = newContent;
    hasJsonError = false;
    if (editorView && editorView.state.doc.toString() !== newContent) {
      editorView.dispatch({
        annotations: [Transaction.addToHistory.of(false)],
        changes: { from: 0, insert: newContent, to: editorView.state.doc.length },
      });
    }
  }

  function isValidJsonObject(text: string): boolean {
    try {
      const parsed = JSON.parse(text);
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
    } catch {
      return false;
    }
  }

  function updateValidationState(node: HTMLDivElement, text: string) {
    hasJsonError = !isValidJsonObject(text);
    if (hasJsonError) {
      node.classList.add('invalid');
    } else {
      node.classList.remove('invalid');
    }
  }

  function onEdit() {
    isEditing = true;
  }

  function onSave() {
    if (!editorView) {
      return;
    }
    const currentText = editorView.state.doc.toString();
    try {
      const parsed = JSON.parse(currentText);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return;
      }
      lastSavedContent = currentText;
      isEditing = false;
      dispatch('updateUserMetadata', parsed);
      if (fileMetadata) {
        fileMetadata.user = parsed;
      }
    } catch {
      // Invalid JSON — don't save
    }
  }

  function onCancel() {
    isEditing = false;
    hasJsonError = false;
    if (editorView && editorView.state.doc.toString() !== lastSavedContent) {
      editorView.dispatch({
        annotations: [Transaction.addToHistory.of(false)],
        changes: { from: 0, insert: lastSavedContent, to: editorView.state.doc.length },
      });
    }
  }

  function initEditor(node: HTMLDivElement) {
    const initialContent = serializeUserMetadata(fileMetadata);
    lastSavedContent = initialContent;
    previousFilePath = filePath;

    editorView = new EditorView({
      doc: initialContent,
      extensions: [
        minimalSetup,
        json(),
        linter(jsonParseLinter()),
        EditorView.lineWrapping,
        EditorView.theme({
          '&': { fontSize: '11px' },
          '.cm-content': { fontFamily: 'monospace', padding: '4px 0' },
          '.cm-focused': { outline: 'none' },
          '.cm-scroller': { overflow: 'auto' },
        }),
        EditorView.updateListener.of(viewUpdate => {
          if (viewUpdate.docChanged) {
            updateValidationState(node, viewUpdate.state.doc.toString());
          }
        }),
        compartmentReadonly.of([EditorState.readOnly.of(editorReadOnly)]),
      ],
      parent: node,
    });

    return {
      destroy() {
        editorView?.destroy();
        editorView = null;
      },
    };
  }

  onDestroy(() => {
    editorView?.destroy();
    editorView = null;
  });
</script>

<div class="grid h-full grid-rows-[min-content_auto]">
  <Sidebar.Header className="p-0">
    <PanelHeader>
      <SectionTitle>Metadata</SectionTitle>
    </PanelHeader>
  </Sidebar.Header>
  <Sidebar.Content className="h-full">
    <Sidebar.Group className="h-full p-0">
      <Sidebar.GroupContent className="h-full">
        <Sidebar.Menu className="h-full text-xs">
          {#if fileMetadata}
            <div class="flex flex-col gap-4 p-3">
              {#if fileSize != null}
                <div class="flex flex-col gap-0.5">
                  <span class="font-medium text-muted-foreground">Size</span>
                  <span>{fileSize.toLocaleString()} bytes{fileSize >= 1024 ? ` (${formatBytes(fileSize)})` : ''}</span>
                </div>
              {/if}
              {#if fileMetadata.createdBy}
                <div class="flex flex-col gap-0.5">
                  <span class="font-medium text-muted-foreground">Created by</span>
                  <span>{fileMetadata.createdBy}</span>
                </div>
              {/if}
              {#if fileMetadata.createdAt}
                <div class="flex flex-col gap-0.5">
                  <span class="font-medium text-muted-foreground">Created</span>
                  <span>{getShortISOForDate(new Date(fileMetadata.createdAt))}</span>
                </div>
              {/if}
              {#if fileMetadata.lastEditedBy}
                <div class="flex flex-col gap-0.5">
                  <span class="font-medium text-muted-foreground">Last edited by</span>
                  <span>{getUserDisplayNameFromIdentity(fileMetadata.lastEditedBy)}</span>
                </div>
              {/if}
              {#if fileMetadata.lastEditedAt}
                <div class="flex flex-col gap-0.5">
                  <span class="font-medium text-muted-foreground">Last edited</span>
                  <span>{getShortISOForDate(new Date(fileMetadata.lastEditedAt))}</span>
                </div>
              {/if}

              {#if generatedFrom}
                <GeneratedFromDetails from={generatedFrom} />
              {/if}
              {#if filePath && buildProvenance}
                <BuildProvenance {filePath} provenance={buildProvenance} on:openActionRun on:openFile />
              {/if}
              {#if filePath && (buildArtifacts.length || (isSequenceFile && !buildProvenance))}
                <SourceBuilds
                  artifacts={buildArtifacts}
                  {filePath}
                  refreshKey={savedVersion}
                  {unsavedText}
                  on:openActionRun
                  on:openActionRuns
                  on:openArtifactHistory
                  on:openFile
                />
              {/if}

              <details class="flex flex-col gap-1" open={!hasReadableProvenance}>
                <summary class="mb-1 cursor-pointer font-medium text-muted-foreground">
                  {hasReadableProvenance ? 'Raw user metadata (JSON)' : 'User metadata'}
                </summary>
                {#if hasJsonError || (hasEditPermission && !isEditing)}
                  <div class="mb-1 flex items-center justify-end gap-1">
                    {#if hasJsonError}
                      <span class="text-xxs text-destructive">Invalid JSON</span>
                    {/if}
                    {#if hasEditPermission && !isEditing}
                      <Button size="sm" variant="outline" on:click={onEdit} aria-label="Edit user metadata">
                        Edit
                      </Button>
                    {/if}
                  </div>
                {/if}
                <div class="user-metadata-editor overflow-hidden rounded border border-border" use:initEditor />
                {#if isEditing}
                  <div class="mt-1 flex justify-end gap-1">
                    <Button size="sm" variant="outline" on:click={onCancel}>Cancel</Button>
                    <Button size="sm" variant="default" disabled={hasJsonError} on:click={onSave}>Save</Button>
                  </div>
                {/if}
              </details>
            </div>
          {:else}
            <!-- This message only displays when a folder (not a file) is selected, as folders currently don't have metadata -->
            <div class="p-3 text-muted-foreground">No metadata available for this folder.</div>
          {/if}
        </Sidebar.Menu>
      </Sidebar.GroupContent>
    </Sidebar.Group>
  </Sidebar.Content>
</div>

<style>
  .user-metadata-editor :global(.cm-editor) {
    max-height: 300px;
  }

  .user-metadata-editor:global(.invalid) {
    border-color: hsl(var(--destructive));
  }
</style>
