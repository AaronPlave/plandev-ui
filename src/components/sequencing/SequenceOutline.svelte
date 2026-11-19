<svelte:options immutable={true} />

<script lang="ts">
  import { syntaxTree } from '@codemirror/language';
  import type { Tree } from '@lezer/common';
  import type { CommandInfoMapper, OutlineEntry, PhoenixContext } from '@nasa-jpl/plandev-sequence-languages';
  import type { EditorView } from 'codemirror';

  export let commandInfoMapper: CommandInfoMapper;
  export let editorSequenceView: EditorView;
  export let phoenixContext: PhoenixContext;
  /** The editor's current tree; a new one recomputes the outline. */
  export let tree: Tree | null = null;

  const kindMarks: Record<OutlineEntry['kind'], string> = {
    branch: '⋔',
    command: '▸',
    function: 'ƒ',
    loop: '↻',
    read: '?',
    section: '§',
    wait: '⏱',
  };

  let open: boolean = false;
  let outline: OutlineEntry[] = [];

  $: if (open) {
    outline = computeOutline(tree);
  }
  $: isRecognizedOnly = !!commandInfoMapper.getOutline;

  /** The language's outline, else every step its command mapper recognizes, labeled by time tag and name. */
  function computeOutline(_tree: Tree | null): OutlineEntry[] {
    const view = editorSequenceView;
    if (commandInfoMapper.getOutline) {
      return commandInfoMapper.getOutline(view.state, phoenixContext);
    }
    const entries: OutlineEntry[] = [];
    syntaxTree(view.state).iterate({
      enter: ref => {
        const step = commandInfoMapper.getContainingCommand(ref.node);
        if (!step || step.from !== ref.from || step.to !== ref.to || step.name !== ref.name) {
          return undefined;
        }
        const name = commandInfoMapper.getNameNode(step);
        const timeTag = commandInfoMapper.getTimeTagInfo(view, step)?.text.trim();
        const label = [timeTag, name ? view.state.sliceDoc(name.from, name.to) : step.name].filter(Boolean).join(' ');
        entries.push({ depth: 0, from: step.from, kind: 'command', label });
        return false;
      },
    });
    return entries;
  }

  function goTo(entry: OutlineEntry) {
    editorSequenceView.dispatch({ scrollIntoView: true, selection: { anchor: entry.from } });
    editorSequenceView.focus();
  }
</script>

<details class="border-t px-4 py-2 text-xs" bind:open>
  <summary class="cursor-pointer font-medium">Outline</summary>
  {#if isRecognizedOnly}
    <div class="py-1 text-muted-foreground">
      Constructs as written in the source, not an execution trace: helper calls are not expanded and branches may not
      run.
    </div>
  {/if}
  <ol class="flex flex-col py-1" aria-label="Sequence outline">
    {#each outline as entry (`${entry.from}:${entry.kind}`)}
      <li style:padding-left="{entry.depth * 12}px">
        <button
          class="flex w-full min-w-0 items-baseline gap-1 rounded px-1 text-left hover:bg-muted"
          on:click={() => goTo(entry)}
        >
          <span class="w-4 shrink-0 text-center text-muted-foreground">{kindMarks[entry.kind]}</span>
          <span class="truncate font-mono">{entry.label}</span>
          <span class="ml-auto shrink-0 text-muted-foreground"
            >{editorSequenceView.state.doc.lineAt(Math.min(entry.from, editorSequenceView.state.doc.length))
              .number}</span
          >
        </button>
      </li>
    {:else}
      <li class="text-muted-foreground">Nothing recognized.</li>
    {/each}
  </ol>
</details>
