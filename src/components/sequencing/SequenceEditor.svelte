<svelte:options immutable={true} />

<script lang="ts">
  import { standardKeymap } from '@codemirror/commands';
  import { lintGutter, openLintPanel, setDiagnostics } from '@codemirror/lint';
  import { Compartment, EditorSelection, EditorState, Transaction, type Extension } from '@codemirror/state';
  import { keymap, type ViewUpdate } from '@codemirror/view';
  import {
    getInputLanguage,
    type CodeHelpStatus,
    type CommandInfoMapper,
    type InputLanguage,
    type OutputLanguage,
    type PhoenixAdaptation,
    type PhoenixContext,
  } from '@nasa-jpl/plandev-sequence-languages';
  import { basicSetup, EditorView } from 'codemirror';
  import { debounce } from 'lodash-es';
  import { ArrowLeft, FileBracesCorner, LoaderCircle } from 'lucide-svelte';
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import { activeDocumentIsDirty } from '../../stores/activeDocument';
  import { clearWorkspaceAdaptationMessages } from '../../stores/workspaceErrors';
  import type { ActionDefinition } from '../../types/actions';
  import type { LintDiagnostic } from '../../types/console';
  import type { WorkspaceFileRevision, WorkspaceRevisionName } from '../../types/workspace';
  import type { WorkspaceFileMetadata } from '../../types/workspace-tree-view';
  import { getLintDiagnostics } from '../../utilities/codemirror/lint';
  import { readOnlyChangeGuard } from '../../utilities/codemirror/readOnly';
  import { blockTheme } from '../../utilities/codemirror/themes/block';
  import {
    codeHelpStatusField,
    phoenixResources,
    setCodeHelpStatus,
  } from '../../utilities/sequence-editor/adaptation-resources';
  import { isMacOs } from '../../utilities/browser';
  import { showFailureToast, showSuccessToast } from '../../utilities/toast';
  import {
    doesFilenameMatchExtension,
    getDownloadOptionsForFile,
    replaceFileExtension,
  } from '../../utilities/workspaces';
  import CssGrid from '../ui/CssGrid.svelte';
  import CssGridGutter from '../ui/CssGridGutter.svelte';
  import Panel from '../ui/Panel.svelte';
  import SectionTitle from '../ui/SectionTitle.svelte';
  import Tooltip from '../ui/Tooltip.svelte';
  import FileMetadataBanner from '../workspace/FileMetadataBanner.svelte';
  import CommandPanel from './CommandPanel/CommandPanel.svelte';
  import EditorContextMenu from './EditorContextMenu.svelte';
  import EditorToolbar from './EditorToolbar.svelte';
  import OutputToolbar from './OutputToolbar.svelte';

  export let availableActions: { action: ActionDefinition; parameter: string }[] = [];
  /** Artifacts built from this file; the banner links to them. */
  export let buildCount: number = 0;
  export let doesWorkingCopyMatchLatestRevision: boolean = false;
  export let fileMetadata: WorkspaceFileMetadata | null = null;
  export let phoenixContext: PhoenixContext | undefined;
  export let includeActions: boolean = false;
  export let preserveAdaptationLog: boolean = false;
  export let isLoading: boolean = false;
  export let isInputFile: boolean = false;
  export let matchingRevisionName: WorkspaceRevisionName | null = null;
  export let previewOnly: boolean = false;
  export let readOnly: boolean = false;
  export let revisionList: WorkspaceFileRevision[] = [];
  export let sequenceAdaptation: PhoenixAdaptation;
  export let sequenceName: string = '';
  export let sequenceFilePath: string = '';
  export let sequenceDefinition: string = '';
  export let sequenceOutput: string = '';
  export let shouldListenForKeyboardSave: boolean = true;
  export let showCommandFormBuilder: boolean = false;
  export let userSequenceEditorColumns: string;
  export let userSequenceEditorColumnsWithFormBuilder: string;
  export let onReadOnlyChange: ((readOnly: boolean) => void) | null = null;
  export let onShowBuilds: (() => void) | null = null;
  /** Where "Back" returns to after Go to Definition, e.g. `startup.rs`; null hides it. */
  export let navigateBackLabel: string | null = null;
  export let onNavigateBack: (() => void) | null = null;

  const dispatch = createEventDispatcher<{
    adaptationError: { error: Error; filePath: string };
    definitionJump: { anchor: number; filePath: string };
    downloadInput: { filePath: string; filename: string };
    downloadOutput: { content: string; filePath: string; filename: string };
    editorViewChange: EditorView | null;
    lintChange: { diagnostics: LintDiagnostic[]; filePath: string };
    runAction: { action: ActionDefinition; parameter: string };
    save: string;
    saveOutput: { filePath: string; formatName: string; input: string; output: string; outputPath: string };
    sequenceInputUpdate: { filePath: string; input: string };
    sequenceOutputUpdate: { filePath: string; output?: string };
  }>();

  let commandFormBuilderGrid: string;
  let compartmentAdaptation: Compartment;
  let compartmentOutputAdaptation: Compartment;
  let compartmentReadonly: Compartment;
  let disableCopyAndExport: boolean = true;
  let editorContextMenu: EditorContextMenu | null = null;
  let editorHeights: string = '1.88fr 3px 80px';
  let editorOutputDiv: HTMLDivElement;
  let editorOutputView: EditorView;
  let editorSequenceDiv: HTMLDivElement;
  let editorSequenceView: EditorView;
  let isDirty: boolean = false;
  let codeHelpStatus: CodeHelpStatus | null = null;
  let codeHelpNotice: 'preparing' | 'ready' | 'unavailable' | null = null;
  let codeHelpTimer: ReturnType<typeof setTimeout> | null = null;
  let selectedOutputFormat: OutputLanguage | undefined;
  let showOutputs: boolean = true;
  let previousShowOutputs: boolean = showOutputs;
  let toggleSeqJsonPreview: boolean = false;
  let commandInfoMapper: CommandInfoMapper;
  let inputEditorExtension: Extension = [];
  let inputLanguage: InputLanguage;
  let outputEditorExtension: Extension = [];
  let previousSequenceFilePath: string = sequenceFilePath;

  // Debounce only the expensive output format computation, not the state sync
  const debouncedOutputUpdate = debounce(updateOutputFormat, 250);

  $: isDirty = $activeDocumentIsDirty;
  // The adaptation may author several languages; this file's is chosen by extension.
  $: inputLanguage = getInputLanguage(sequenceAdaptation, sequenceName) ?? sequenceAdaptation.input;
  $: commandInfoMapper = inputLanguage.commandInfoMapper;
  // Re-read whenever code help changes: formatting may need a ready language server.
  $: canFormat = isFormatAvailable(inputLanguage, editorSequenceView, codeHelpStatus);
  $: updateCodeHelpNotice(codeHelpStatus);

  // Only use input extensions if the sequence file matches the input file extensions
  $: if (phoenixContext && isInputFile && inputLanguage.getEditorExtension) {
    inputEditorExtension = inputLanguage.getEditorExtension(phoenixContext, phoenixResources);
  } else if (phoenixContext && sequenceAdaptation.outputs.length > 0) {
    const matchingOutputLanguage = sequenceAdaptation.outputs.find(output =>
      doesFilenameMatchExtension(output.fileExtension, sequenceName),
    );
    inputEditorExtension = matchingOutputLanguage?.getEditorExtension?.(phoenixContext, phoenixResources) ?? [];
  } else {
    inputEditorExtension = [];
  }

  // Only use output extensions if the sequence file is an input file
  $: if (isInputFile && sequenceAdaptation.outputs.length > 0) {
    selectedOutputFormat = sequenceAdaptation.outputs[0];
  } else {
    selectedOutputFormat = undefined;
  }

  $: if (phoenixContext && selectedOutputFormat?.getEditorExtension) {
    outputEditorExtension = selectedOutputFormat.getEditorExtension(phoenixContext, phoenixResources);
  } else {
    outputEditorExtension = [];
  }

  // insert sequence - use sequenceFilePath as dependency to ensure editor updates when switching files
  // This handles the case where both old and new files have the same content (e.g., both empty)
  $: {
    // note: this statement always runs when sequenceFilePath changes, regardless of value
    // as opposed to the more common $: if (typeof sequenceFilePath === 'string') which will only
    // trigger reactivity if sequenceFilePath is a string and not if it is null / undefined.
    // In this case, we want to trigger reactivity on all possible values.
    void sequenceFilePath;
    // Skip the dispatch if the editor already has the correct content (e.g., after save),
    // to avoid resetting the cursor position. Still dispatch on file path changes since
    // both files could have identical content.
    if (editorSequenceView?.state.doc.toString() !== sequenceDefinition) {
      editorSequenceView?.dispatch({
        annotations: [Transaction.addToHistory.of(false)], // Prevent this change from being added to the undo history
        changes: { from: 0, insert: sequenceDefinition, to: editorSequenceView.state.doc.length },
        userEvent: 'file.open',
      });
    }
  }

  $: commandFormBuilderGrid = showCommandFormBuilder
    ? userSequenceEditorColumnsWithFormBuilder
    : userSequenceEditorColumns;

  $: {
    // Configure sequence editor.
    if (editorSequenceView) {
      editorSequenceView.dispatch({
        // The new extension reports its own code help status, if it has any.
        effects: [compartmentAdaptation.reconfigure(inputEditorExtension), setCodeHelpStatus.of(null)],
      });
      // Clear any stale diagnostics
      editorSequenceView.dispatch(setDiagnostics(editorSequenceView.state, []));
    }
  }

  $: {
    const isEditable = !(readOnly || previewOnly || isLoading);
    editorSequenceView?.dispatch({
      effects: compartmentReadonly.reconfigure([
        EditorState.readOnly.of(!isEditable),
        EditorView.editable.of(isEditable),
        // Block programmatic edits (lint fixes, command panel, sanitizer) that readOnly
        // misses, but allow the editor's own 'file.open' content sync.
        ...(isEditable ? [] : [readOnlyChangeGuard(['file.open'])]),
      ]),
    });
  }

  $: {
    previousShowOutputs = showOutputs;
    showOutputs = isInputFile && sequenceAdaptation.outputs.length > 0;
  }
  $: if (showOutputs) {
    editorHeights = toggleSeqJsonPreview ? '1fr 3px 1fr' : '1.88fr 3px 80px';
  } else {
    editorHeights = '1fr 3px';
  }

  $: if (showOutputs && previousShowOutputs !== showOutputs && editorOutputDiv) {
    if (editorOutputView) {
      editorOutputView.destroy();
    }
    editorOutputView = new EditorView({
      doc: sequenceOutput,
      extensions: [
        basicSetup,
        keymap.of([...standardKeymap, shouldListenForKeyboardSave ? { key: 'Ctrl-s', mac: 'Cmd-s', run: onSave } : {}]),
        EditorView.lineWrapping,
        EditorView.theme({ '.cm-gutter': { 'min-height': '0px' } }),
        EditorView.editable.of(false),
        lintGutter(),
        compartmentOutputAdaptation.of(outputEditorExtension),
        EditorState.readOnly.of(readOnly),
      ],
      parent: editorOutputDiv,
    });
  }

  // Cancel pending debounced events when file path changes to prevent stale events
  // from being dispatched with the wrong file path
  $: if (sequenceFilePath !== previousSequenceFilePath) {
    debouncedOutputUpdate.cancel();
    dispatchLintChange.cancel();
    previousSequenceFilePath = sequenceFilePath;

    // Clear stale output and recompute for the new file
    if (editorOutputView) {
      editorOutputView.dispatch({ changes: { from: 0, insert: '', to: editorOutputView.state.doc.length } });
      debouncedOutputUpdate(editorSequenceView?.state.doc.toString() ?? '');
    }
  }
  $: {
    // Reconfigure output editor when adaptation extensions change
    if (editorOutputView) {
      editorOutputView.dispatch({
        effects: [compartmentOutputAdaptation.reconfigure(outputEditorExtension)],
      });
      debouncedOutputUpdate(editorSequenceView?.state.doc.toString() ?? '');
    }
  }

  function sequenceUpdateListener(viewUpdate: ViewUpdate): void {
    const sequence = viewUpdate.state.doc.toString();
    disableCopyAndExport = sequence === '';

    dispatch('sequenceInputUpdate', { filePath: sequenceFilePath, input: sequence });

    debouncedOutputUpdate(sequence);
  }

  function updateOutputFormat(sequence: string): void {
    if (phoenixContext) {
      let output: string | undefined;

      if (!preserveAdaptationLog) {
        clearWorkspaceAdaptationMessages();
      }

      try {
        output = selectedOutputFormat?.toOutputFormat?.(sequence, phoenixContext, sequenceName);
      } catch (e) {
        console.error('Adaptation toOutputFormat error:', e);
        if (sequenceFilePath) {
          dispatch('adaptationError', { error: e as Error, filePath: sequenceFilePath });
        }
        output = `// Error in adaptation toOutputFormat:\n// ${(e as Error).message}`;
      }

      editorOutputView.dispatch({ changes: { from: 0, insert: output ?? '', to: editorOutputView.state.doc.length } });

      if (output !== undefined) {
        dispatch('sequenceOutputUpdate', { filePath: sequenceFilePath, output });
      }
    }
  }

  function isFormatAvailable(language: InputLanguage, view: EditorView | undefined, _status: CodeHelpStatus | null) {
    return !!language.format && (!view || (language.canFormat?.(view) ?? true));
  }

  /**
   * "Preparing code help…" only once preparation takes noticeably long; "ready" is said briefly
   * and only after that; "unavailable" stays (with the reason in its tooltip).
   */
  function updateCodeHelpNotice(status: CodeHelpStatus | null) {
    if (codeHelpTimer) {
      clearTimeout(codeHelpTimer);
      codeHelpTimer = null;
    }
    if (status?.state === 'preparing') {
      if (codeHelpNotice !== 'preparing') {
        codeHelpNotice = null;
        codeHelpTimer = setTimeout(() => (codeHelpNotice = 'preparing'), 800);
      }
    } else if (status?.state === 'ready') {
      if (codeHelpNotice === 'preparing') {
        codeHelpNotice = 'ready';
        codeHelpTimer = setTimeout(() => (codeHelpNotice = null), 2500);
      } else {
        codeHelpNotice = null;
      }
    } else {
      codeHelpNotice = status?.state === 'unavailable' ? 'unavailable' : null;
    }
  }

  const dispatchLintChange = debounce((view: EditorView) => {
    if (sequenceFilePath) {
      dispatch('lintChange', {
        diagnostics: getLintDiagnostics(view),
        filePath: sequenceFilePath,
      });
    }
  }, 300);

  function downloadOutputFormat(event: CustomEvent<{ name: string }>): void {
    const content = editorOutputView.state.doc.toString();

    if (selectedOutputFormat) {
      dispatch('downloadOutput', {
        content,
        filePath: sequenceFilePath,
        filename: event.detail.name,
      });
    }
  }

  function outputPathFor(format: OutputLanguage): string {
    return replaceFileExtension(sequenceFilePath, inputLanguage.fileExtension, format.fileExtension);
  }

  /** Generated fresh from the editor text, not the debounced preview, so input and output belong together. */
  function saveOutputToWorkspace(): void {
    if (!selectedOutputFormat?.toOutputFormat || !phoenixContext) {
      return;
    }
    const input = editorSequenceView.state.doc.toString();
    let output: string | undefined;
    try {
      output = selectedOutputFormat.toOutputFormat(input, phoenixContext, sequenceName);
    } catch (e) {
      showFailureToast(`${selectedOutputFormat.name} could not be generated: ${(e as Error).message}`);
      return;
    }
    if (output === undefined) {
      showFailureToast(`${selectedOutputFormat.name} produced no output`);
      return;
    }
    dispatch('saveOutput', {
      filePath: sequenceFilePath,
      formatName: selectedOutputFormat.name,
      input,
      output,
      outputPath: outputPathFor(selectedOutputFormat),
    });
  }

  function downloadInputFormat(name: string): void {
    dispatch('downloadInput', { filePath: sequenceFilePath, filename: name });
  }

  async function copyOutputFormatToClipboard(): Promise<void> {
    try {
      await navigator.clipboard.writeText(editorOutputView.state.doc.toString());
      showSuccessToast(`${selectedOutputFormat?.name} copied to clipboard`);
    } catch {
      showFailureToast(`Error copying ${selectedOutputFormat?.name} to clipboard`);
    }
  }

  async function copyInputFormatToClipboard(): Promise<void> {
    try {
      await navigator.clipboard.writeText(editorSequenceView.state.doc.toString());
      showSuccessToast(`${inputLanguage.name} copied to clipboard`);
    } catch {
      showFailureToast(`Error copying ${inputLanguage.name} to clipboard`);
    }
  }

  function toggleSeqJsonEditor(): void {
    toggleSeqJsonPreview = !toggleSeqJsonPreview;
  }

  function showErrorPanel() {
    openLintPanel(editorSequenceView);
  }

  function formatDocument(): boolean {
    if (!canFormat || !inputLanguage.format || !phoenixContext) {
      return false;
    }
    inputLanguage.format(editorSequenceView, phoenixContext);
    return true;
  }

  function onFormatShortcut(event: KeyboardEvent): boolean {
    const isShortcut = event.code === 'KeyF' && event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey;
    if (isShortcut && formatDocument()) {
      event.preventDefault();
      return true;
    }
    return false;
  }

  function onRunAction(event: CustomEvent<{ action: ActionDefinition; parameter: string }>) {
    const { action, parameter } = event.detail;
    dispatch('runAction', { action, parameter });
  }

  function onSave(): boolean {
    const currentSequence = editorSequenceView.state.doc.toString();
    if (currentSequence !== sequenceDefinition) {
      dispatch('save', currentSequence);
    }
    return true;
  }

  /**
   * Replace the editor content and DO record it in the undo history — unlike the file-open sync,
   * which is excluded from history. Used by "take theirs" so the user can Cmd-Z back to the edits
   * they discarded (the full-doc replace and its inverse are exact, so undo/redo stay clean).
   */
  export function rebaseContent(content: string): void {
    if (editorSequenceView && editorSequenceView.state.doc.toString() !== content) {
      editorSequenceView.dispatch({
        changes: { from: 0, insert: content, to: editorSequenceView.state.doc.length },
        userEvent: 'file.rebase',
      });
    }
  }

  // Exported function to allow parent to navigate to a specific line/column
  export function gotoLine(line: number, column: number = 0): void {
    if (editorSequenceView) {
      const doc = editorSequenceView.state.doc;
      if (line > 0 && line <= doc.lines) {
        const lineInfo = doc.line(line);
        const pos = Math.min(lineInfo.from + column, lineInfo.to);
        editorSequenceView.dispatch({
          effects: EditorView.scrollIntoView(pos, { y: 'center' }),
          selection: EditorSelection.cursor(pos),
        });
        editorSequenceView.focus();
      }
    }
  }

  onMount(() => {
    compartmentReadonly = new Compartment();
    compartmentAdaptation = new Compartment();
    compartmentOutputAdaptation = new Compartment();

    editorSequenceView = new EditorView({
      doc: sequenceDefinition,
      extensions: [
        basicSetup,
        keymap.of([...standardKeymap, shouldListenForKeyboardSave ? { key: 'Ctrl-s', mac: 'Cmd-s', run: onSave } : {}]),
        // Shift+Alt+F formats, for every language that can (the usual language-server binding). By
        // physical key: on macOS Option+Shift+F types "Ï", which a keymap's "Shift-Alt-f" never matches.
        EditorView.domEventHandlers({ keydown: onFormatShortcut }),
        EditorView.lineWrapping,
        EditorView.theme({ '.cm-gutter': { 'min-height': '0px' } }),
        lintGutter(),
        codeHelpStatusField,
        EditorView.updateListener.of(viewUpdate => {
          if (viewUpdate.docChanged) {
            sequenceUpdateListener(viewUpdate);
          }
          const status = viewUpdate.state.field(codeHelpStatusField);
          if (status !== codeHelpStatus) {
            codeHelpStatus = status;
          }
          for (const transaction of viewUpdate.transactions) {
            if (transaction.isUserEvent('select.definition')) {
              dispatch('definitionJump', {
                anchor: transaction.startState.selection.main.head,
                filePath: sequenceFilePath,
              });
            }
          }
        }),
        EditorView.updateListener.of(viewUpdate => dispatchLintChange(viewUpdate.view)),
        blockTheme,
        compartmentAdaptation.of(inputEditorExtension),
        compartmentReadonly.of(
          readOnly || previewOnly || isLoading
            ? [EditorState.readOnly.of(true), readOnlyChangeGuard(['file.open'])]
            : [EditorState.readOnly.of(false)],
        ),
        EditorView.updateListener.of(viewUpdate => {
          for (const tr of viewUpdate.transactions) {
            if (tr.annotation(Transaction.userEvent) === 'sanitize.smartQuotes') {
              showSuccessToast('Replaced curly quotes with ASCII quotes, save to accept changes');
            }
          }
        }),
      ],
      parent: editorSequenceDiv,
    });

    editorOutputView = new EditorView({
      doc: sequenceOutput,
      extensions: [
        basicSetup,
        EditorView.lineWrapping,
        EditorView.theme({ '.cm-gutter': { 'min-height': '0px' } }),
        EditorView.editable.of(false),
        lintGutter(),
        compartmentOutputAdaptation.of(outputEditorExtension),
        EditorState.readOnly.of(readOnly),
      ],
      parent: editorOutputDiv,
    });

    // Compute initial output for the starting content (e.g., untitled empty sequence on page load)
    debouncedOutputUpdate(editorSequenceView.state.doc.toString());

    dispatch('editorViewChange', editorSequenceView);
  });

  onDestroy(() => {
    if (codeHelpTimer) {
      clearTimeout(codeHelpTimer);
    }
    dispatchLintChange.cancel();
    editorSequenceView?.destroy();
    editorOutputView?.destroy();
    debouncedOutputUpdate.cancel();
    dispatch('editorViewChange', null);
  });
</script>

<CssGrid class="z-0 w-full" bind:columns={commandFormBuilderGrid} minHeight={'0'} columnMinSizes={{ 0: 400, 2: 292 }}>
  <CssGrid rows={editorHeights} minHeight={'0'}>
    <Panel padBody={false}>
      <svelte:fragment slot="header">
        <SectionTitle alt={sequenceFilePath} overflow="hidden">
          <FileBracesCorner size={16} slot="icon" />
          {sequenceName || 'Untitled'}{readOnly || (previewOnly && !isLoading) ? ' (Read only)' : ''}
        </SectionTitle>

        {#if navigateBackLabel && onNavigateBack}
          <Tooltip content="Back to where you were before Go to definition">
            <button class="st-button tertiary flex items-center gap-1 text-xs" on:click={onNavigateBack}>
              <ArrowLeft size={12} />
              {navigateBackLabel}
            </button>
          </Tooltip>
        {/if}

        <!-- Language intelligence (e.g. a language server): said only when it matters, and politely. -->
        <span class="flex shrink-0 items-center gap-1 text-xs text-muted-foreground" role="status" aria-live="polite">
          {#if codeHelpNotice === 'preparing'}
            <LoaderCircle size={12} class="animate-spin" /> Preparing code help…
          {:else if codeHelpNotice === 'ready'}
            Code help ready
          {:else if codeHelpNotice === 'unavailable'}
            <Tooltip content={codeHelpStatus?.message ?? 'The language server is not available'}>
              <span class="underline decoration-dotted">
                Code help unavailable<span class="sr-only">: {codeHelpStatus?.message ?? ''}</span>
              </span>
            </Tooltip>
          {/if}
        </span>

        <EditorToolbar
          actions={availableActions}
          actionsDisabled={sequenceName === '' || availableActions.length === 0}
          showActions={includeActions}
          showErrorPanelButton
          onShowErrorPanel={showErrorPanel}
          showFormatButton={!!inputLanguage.format}
          onFormat={formatDocument}
          formatDisabled={!canFormat}
          formatTooltip={canFormat ? 'Format document' : 'Format document (available once code help is ready)'}
          formatShortcut={isMacOs() ? '⇧⌥F' : 'Shift+Alt+F'}
          showCopyButton
          copyDisabled={disableCopyAndExport}
          copyTooltip="Copy sequence contents"
          onCopy={copyInputFormatToClipboard}
          showDownloadButton
          downloadDisabled={disableCopyAndExport}
          downloadLabel="Download sequence contents"
          downloadOptions={getDownloadOptionsForFile(
            sequenceName,
            doesWorkingCopyMatchLatestRevision,
            revisionList[0]?.name ?? null,
            isDirty,
          )}
          onDownload={downloadInputFormat}
          showSaveButton={!(readOnly || previewOnly || isLoading)}
          saveDisabled={!isDirty}
          saveHighlighted={isDirty}
          {onSave}
          on:runAction={onRunAction}
        />
      </svelte:fragment>

      <svelte:fragment slot="body">
        {#if fileMetadata}
          <FileMetadataBanner
            {buildCount}
            {doesWorkingCopyMatchLatestRevision}
            {onShowBuilds}
            {fileMetadata}
            hasEditPermission={!previewOnly}
            hasRevisions={revisionList.length > 0}
            {isDirty}
            {matchingRevisionName}
            {onReadOnlyChange}
          />
        {/if}
        <!-- Languages with editor commands get a right-click menu (with Cut/Copy/Paste); others keep the browser's. -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div
          class="p-2"
          bind:this={editorSequenceDiv}
          on:contextmenu={event => {
            if (inputLanguage.editorCommands?.length) {
              editorContextMenu?.show(event);
            }
          }}
        />
        <EditorContextMenu
          bind:this={editorContextMenu}
          commands={inputLanguage.editorCommands ?? []}
          view={editorSequenceView}
        />
      </svelte:fragment>
    </Panel>

    {#if showOutputs}
      <CssGridGutter draggable={toggleSeqJsonPreview} track={1} type="row" />
      <Panel>
        <svelte:fragment slot="header">
          <SectionTitle>{selectedOutputFormat?.name} (Read-only)</SectionTitle>

          <div class="right">
            <OutputToolbar
              bind:selectedOutputFormat
              isPreviewOpen={toggleSeqJsonPreview}
              outputLanguages={sequenceAdaptation.outputs}
              outputDisabled={disableCopyAndExport}
              saveTargetPath={!previewOnly && !readOnly && selectedOutputFormat?.toOutputFormat
                ? outputPathFor(selectedOutputFormat)
                : null}
              downloadOptions={selectedOutputFormat
                ? getDownloadOptionsForFile(
                    replaceFileExtension(sequenceName, inputLanguage.fileExtension, selectedOutputFormat.fileExtension),
                    doesWorkingCopyMatchLatestRevision,
                    revisionList[0]?.name ?? null,
                    isDirty,
                  )
                : []}
              on:copyOutput={copyOutputFormatToClipboard}
              on:downloadOutput={downloadOutputFormat}
              on:saveOutput={saveOutputToWorkspace}
              on:togglePreview={toggleSeqJsonEditor}
            />
          </div>
        </svelte:fragment>

        <svelte:fragment slot="body">
          <div bind:this={editorOutputDiv} data-testid="output-editor" />
        </svelte:fragment>
      </Panel>
    {/if}
  </CssGrid>

  {#if showCommandFormBuilder}
    <CssGridGutter track={1} type="column" />
    {#if phoenixContext && phoenixContext.commandDictionary !== null}
      <CommandPanel
        {phoenixContext}
        {commandInfoMapper}
        {editorSequenceView}
        readOnly={readOnly || previewOnly || isLoading}
      />
    {:else}
      <Panel overflowYBody="hidden" padBody>
        <svelte:fragment slot="header">
          <SectionTitle><span class="p-2">Selected Command</span></SectionTitle>
        </svelte:fragment>

        <svelte:fragment slot="body">
          <div class="p-2 text-muted-foreground">Select a parcel to enable the Selected Command panel.</div>
        </svelte:fragment>
      </Panel>
    {/if}
  {/if}
</CssGrid>
