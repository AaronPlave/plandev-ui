<svelte:options immutable={true} />

<script lang="ts">
  import { syntaxTree } from '@codemirror/language';
  import { StateEffect } from '@codemirror/state';
  import type { SyntaxNode, Tree } from '@lezer/common';
  import type { CommandDictionary, FswCommand, HwCommand } from '@nasa-jpl/plandev-ampcs';
  import type {
    ArgTextDef,
    CommandInfoMapper,
    DictionaryItemAt,
    PhoenixContext,
    TimeTagInfo,
  } from '@nasa-jpl/plandev-sequence-languages';
  import { EditorView } from 'codemirror';
  import { WorkspaceRightPanelTab } from '../../enums/workspace';
  import type { ActionParameterPair, WorkspaceFileRevision, WorkspaceRevisionName } from '../../types/workspace';
  import type { WorkspaceFileMetadata } from '../../types/workspace-tree-view';
  import { getInspectedNode } from '../../utilities/sequence-editor/cursor';
  import { unquoteUnescape } from '../../utilities/sequence-editor/sequence-utils';
  import CommandDictionaryComponent from '../sequencing/CommandPanel/CommandDictionary.svelte';
  import DictionaryItemDetails from '../sequencing/CommandPanel/DictionaryItemDetails.svelte';
  import SelectedCommand from '../sequencing/CommandPanel/SelectedCommand.svelte';
  import SequenceOutline from '../sequencing/SequenceOutline.svelte';
  import Panel from '../ui/Panel.svelte';
  import SectionTitle from '../ui/SectionTitle.svelte';
  import * as Sidebar from '../ui/Sidebar/index.js';
  import PanelHeader from './PanelHeader.svelte';
  import WorkspaceMetadataPanel from './WorkspaceMetadataPanel.svelte';
  import WorkspaceRevisionsPanel from './WorkspaceRevisionsPanel.svelte';

  export let activeTab: WorkspaceRightPanelTab = WorkspaceRightPanelTab.METADATA;
  export let availableActions: ActionParameterPair[] = [];
  export let commandInfoMapper: CommandInfoMapper | null = null;
  /** The command tab's title, e.g. "Selected Command" (also the icon rail's tooltip). */
  export let commandTabLabel: string = 'Selected Command';
  export let doesWorkingCopyMatchLatestRevision: boolean = false;
  export let editorSequenceView: EditorView | null = null;
  export let fileMetadata: WorkspaceFileMetadata | null = null;
  export let filePath: string | null = null;
  export let fileSize: number | null = null;
  export let hasEditPermission: boolean = false;
  export let hasCreateRevisionPermission: boolean = false;
  export let hasRestoreRevisionPermission: boolean = false;
  export let hasRunActionPermission: boolean = false;
  export let isRevisionsLoading: boolean = false;
  export let isSequenceFile: boolean = false;
  export let matchingRevisionName: WorkspaceRevisionName | null = null;
  export let phoenixContext: PhoenixContext;
  export let revisionList: WorkspaceFileRevision[] = [];
  export let reloadWorkingCopy: () => Promise<void>;

  const emptyCommandDictionary: CommandDictionary = {
    enumMap: {},
    enums: [],
    fswCommandMap: {},
    fswCommands: [],
    header: {
      mission_name: '',
      schema_version: '',
      spacecraft_ids: [],
      version: '',
    },
    hwCommandMap: {},
    hwCommands: [],
    id: '',
    path: null,
  };

  let argInfoArray: ArgTextDef[] = [];
  let commandDef: FswCommand | null = null;
  let commandDictionary: CommandDictionary = emptyCommandDictionary;
  let commandName: string | null = null;
  let commandNameNode: SyntaxNode | null = null;
  let commandNode: SyntaxNode | null = null;
  let currentTree: Tree;
  let dictionaryItem: DictionaryItemAt | null = null;
  let listenerAttached: boolean = false;
  let selectedCommandDefinition: (FswCommand | HwCommand) | null = null;
  let selectedNode: SyntaxNode | null = null;
  let timeTagNode: TimeTagInfo | null = null;
  let variablesInScope: string[] = [];

  $: commandDictionary = phoenixContext?.commandDictionary ?? emptyCommandDictionary;

  // Languages where most code is not a command (Rust) inspect dictionary items at the cursor instead.
  $: isInspector = !!commandInfoMapper?.getDictionaryItemAt;
  $: dictionaryItem =
    editorSequenceView && commandInfoMapper?.getDictionaryItemAt
      ? commandInfoMapper.getDictionaryItemAt(selectedNode, editorSequenceView, phoenixContext)
      : null;
  $: commandNode = isInspector
    ? dictionaryItem?.kind === 'command'
      ? dictionaryItem.node
      : null
    : (commandInfoMapper?.getContainingCommand?.(selectedNode) ?? null);
  $: commandNameNode = commandInfoMapper?.getNameNode?.(commandNode) ?? null;
  $: commandName =
    commandNameNode &&
    editorSequenceView &&
    unquoteUnescape(editorSequenceView.state.sliceDoc(commandNameNode.from, commandNameNode.to));
  $: timeTagNode = editorSequenceView ? commandInfoMapper?.getTimeTagInfo?.(editorSequenceView, commandNode) : null;
  $: argInfoArray = editorSequenceView
    ? (commandInfoMapper?.getArgumentInfo?.(
        commandDef,
        editorSequenceView,
        commandInfoMapper?.getArgumentNodeContainer?.(commandNode),
        commandDef?.arguments,
        undefined,
        phoenixContext,
      ) ?? [])
    : [];
  $: commandDef =
    commandInfoMapper?.getCommandDef?.(commandDictionary, phoenixContext?.librarySequences, commandName ?? '') ?? null;
  $: variablesInScope =
    editorSequenceView && currentTree
      ? (commandInfoMapper?.getVariablesInScope?.(editorSequenceView, currentTree, commandNode?.from) ?? [])
      : [];

  // Expose the tab title to the parent for the icon rail tooltip
  $: commandTabLabel = isInspector
    ? 'At cursor'
    : commandNode
      ? `Selected ${formatTypeName(commandNode.name)}`
      : 'Selected Command';

  function formatTypeName(s: string) {
    return s.replace(/([^A-Z])(?=[A-Z])/g, '$1 ');
  }

  function onSelectCommandDefinition(event: CustomEvent<(FswCommand | HwCommand) | null>) {
    const { detail } = event;
    selectedCommandDefinition = detail;
    activeTab = WorkspaceRightPanelTab.DICTIONARY;
  }

  // Attach editor listener for tracking selected command
  $: if (editorSequenceView && isSequenceFile && !listenerAttached) {
    listenerAttached = true;
    editorSequenceView.dispatch({
      effects: StateEffect.appendConfig.of([
        EditorView.updateListener.of(viewUpdate => {
          const updatedSelectionNode = getInspectedNode(viewUpdate.state, commandInfoMapper);
          if (selectedNode !== updatedSelectionNode) {
            selectedNode = updatedSelectionNode;
            currentTree = syntaxTree(viewUpdate.state);
          }
        }),
      ]),
    });
  }

  // Reset listener when editor view changes (file switch)
  $: if (!editorSequenceView) {
    listenerAttached = false;
    selectedNode = null;
  }
</script>

<div class="h-full w-full overflow-auto">
  {#if activeTab === WorkspaceRightPanelTab.COMMAND && isSequenceFile && editorSequenceView}
    {#if phoenixContext.commandDictionary !== null && commandInfoMapper}
      <div class="grid h-full grid-rows-[min-content_auto]">
        <Sidebar.Header className="p-0">
          <PanelHeader>
            <SectionTitle>{commandTabLabel}</SectionTitle>
          </PanelHeader>
        </Sidebar.Header>
        <Sidebar.Content className="h-full overflow-auto">
          {#if dictionaryItem && dictionaryItem.kind !== 'command'}
            <DictionaryItemDetails kind={dictionaryItem.kind} name={dictionaryItem.name} {phoenixContext} />
          {:else if isInspector && !commandDef}
            <div class="px-2 py-9 text-center text-xs text-muted-foreground">
              No dictionary item at cursor.
              <div class="pt-1">Put the cursor in a command call, a telemetry read or a parameter read.</div>
            </div>
          {:else}
            <SelectedCommand
              {commandDef}
              {commandName}
              {commandNode}
              {argInfoArray}
              {variablesInScope}
              {commandNameNode}
              {commandDictionary}
              {commandInfoMapper}
              {editorSequenceView}
              readOnly={!hasEditPermission || !!fileMetadata?.readOnly}
              {timeTagNode}
              on:selectCommandDefinition={onSelectCommandDefinition}
            />
          {/if}
          <SequenceOutline {commandInfoMapper} {editorSequenceView} {phoenixContext} tree={currentTree ?? null} />
        </Sidebar.Content>
      </div>
    {:else}
      <Panel overflowYBody="hidden" padBody>
        <svelte:fragment slot="header">
          <SectionTitle><span class="p-2">{commandTabLabel}</span></SectionTitle>
        </svelte:fragment>
        <svelte:fragment slot="body">
          <div class="p-2 text-muted-foreground">
            {#if phoenixContext.commandDictionary == null}
              Select a parcel with a command dictionary to enable the Selected Command panel.
            {:else}
              Select a parcel with an adaptation containing a command mapping to enable the Selected Command panel.
            {/if}
          </div>
        </svelte:fragment>
      </Panel>
    {/if}
  {:else if activeTab === WorkspaceRightPanelTab.DICTIONARY && isSequenceFile}
    {#if phoenixContext.commandDictionary !== null}
      <div class="grid h-full grid-rows-[min-content_auto]">
        <Sidebar.Header className="p-0">
          <PanelHeader>
            <SectionTitle>Mission Reference</SectionTitle>
          </PanelHeader>
        </Sidebar.Header>
        <Sidebar.Content className="h-full overflow-auto">
          <CommandDictionaryComponent
            {commandDictionary}
            {commandInfoMapper}
            {editorSequenceView}
            enableComparison
            enableFindUses
            {phoenixContext}
            readOnly={!hasEditPermission || !!fileMetadata?.readOnly}
            {selectedCommandDefinition}
            on:findUses
            on:selectCommandDefinition={onSelectCommandDefinition}
          />
        </Sidebar.Content>
      </div>
    {:else}
      <Panel overflowYBody="hidden" padBody>
        <svelte:fragment slot="header">
          <SectionTitle><span class="p-2">Mission Reference</span></SectionTitle>
        </svelte:fragment>
        <svelte:fragment slot="body">
          <div class="p-2 text-muted-foreground">
            Select a parcel with a command dictionary to enable the Mission Reference.
          </div>
        </svelte:fragment>
      </Panel>
    {/if}
  {:else if activeTab === WorkspaceRightPanelTab.METADATA}
    <WorkspaceMetadataPanel
      {filePath}
      {fileMetadata}
      {fileSize}
      {hasEditPermission}
      on:openFile
      on:updateUserMetadata
    />
  {:else if activeTab === WorkspaceRightPanelTab.REVISIONS}
    <WorkspaceRevisionsPanel
      {availableActions}
      {doesWorkingCopyMatchLatestRevision}
      {filePath}
      {hasCreateRevisionPermission}
      {hasRestoreRevisionPermission}
      {hasRunActionPermission}
      isReadOnly={!!fileMetadata?.readOnly}
      {isRevisionsLoading}
      {matchingRevisionName}
      {revisionList}
      {reloadWorkingCopy}
      on:createdFileRevision
      on:runAction
    />
  {/if}
</div>
