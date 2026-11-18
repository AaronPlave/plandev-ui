<svelte:options immutable={true} />

<script lang="ts">
  import { selectAll } from '@codemirror/commands';
  import { ContextMenu } from '@nasa-jpl/stellar-svelte';
  import type { EditorCommand } from '@nasa-jpl/plandev-sequence-languages';
  import type { EditorView } from 'codemirror';
  import { isMacOs } from '../../utilities/browser';
  import { showFailureToast } from '../../utilities/toast';
  import ContextMenuInternal from '../context-menu/ContextMenu.svelte';

  /** The language's editor commands (e.g. Go to definition), run at the right-clicked symbol. */
  export let commands: EditorCommand[] = [];
  export let view: EditorView | null = null;

  let contextMenu: ContextMenuInternal;
  let enabled: boolean[] = [];
  let hasSelection: boolean = false;
  let editable: boolean = false;

  const mac = isMacOs();
  // Function keys need Fn on most Mac keyboards.
  const shortcutText = (shortcut: string) => (mac ? shortcut.replace(/\bF(\d+)\b/, 'Fn+F$1') : shortcut);
  const key = (letter: string) => (mac ? `⌘${letter}` : `Ctrl+${letter}`);

  /** Right-click: like other editors, a click outside the selection moves the cursor there first. */
  export function show(event: MouseEvent) {
    if (!view) {
      return;
    }
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos !== null && !view.state.selection.ranges.some(r => r.from <= pos && pos <= r.to && !r.empty)) {
      view.dispatch({ selection: { anchor: pos } });
    }
    view.focus();
    // Read when the menu opens: commands depend on the language server being ready.
    enabled = commands.map(command => command.isEnabled?.(view as EditorView) ?? true);
    hasSelection = view.state.selection.ranges.some(r => !r.empty);
    editable = !view.state.readOnly;
    contextMenu.show(event);
  }

  function run(command: EditorCommand) {
    if (view) {
      view.focus();
      command.run(view);
    }
  }

  function selectedText(v: EditorView) {
    return v.state.selection.ranges.map(r => v.state.sliceDoc(r.from, r.to)).join(v.state.lineBreak);
  }

  async function copy(cut: boolean) {
    if (!view) {
      return;
    }
    const v = view;
    try {
      await navigator.clipboard.writeText(selectedText(v));
      if (cut) {
        v.dispatch(v.state.replaceSelection(''));
      }
    } catch {
      showFailureToast(`The browser blocked the clipboard: use ${key(cut ? 'X' : 'C')}`);
    }
    v.focus();
  }

  async function paste() {
    if (!view) {
      return;
    }
    const v = view;
    try {
      const text = await navigator.clipboard.readText();
      v.dispatch(v.state.replaceSelection(text));
    } catch {
      showFailureToast(`The browser blocked reading the clipboard: use ${key('V')}`);
    }
    v.focus();
  }
</script>

<ContextMenuInternal bind:this={contextMenu} closeFocus={view?.contentDOM}>
  {#each commands as command, i (command.label)}
    <ContextMenu.Item size="sm" disabled={!enabled[i]} on:click={() => run(command)}>
      {command.label}
      {#if command.shortcut}
        <ContextMenu.Shortcut class="pl-4">{shortcutText(command.shortcut)}</ContextMenu.Shortcut>
      {/if}
    </ContextMenu.Item>
  {/each}
  {#if commands.length}
    <ContextMenu.Separator />
  {/if}
  <ContextMenu.Item size="sm" disabled={!hasSelection || !editable} on:click={() => copy(true)}>
    Cut<ContextMenu.Shortcut>{key('X')}</ContextMenu.Shortcut>
  </ContextMenu.Item>
  <ContextMenu.Item size="sm" disabled={!hasSelection} on:click={() => copy(false)}>
    Copy<ContextMenu.Shortcut>{key('C')}</ContextMenu.Shortcut>
  </ContextMenu.Item>
  <ContextMenu.Item size="sm" disabled={!editable} on:click={paste}>
    Paste<ContextMenu.Shortcut>{key('V')}</ContextMenu.Shortcut>
  </ContextMenu.Item>
  <ContextMenu.Separator />
  <ContextMenu.Item size="sm" on:click={() => view && selectAll(view)}>
    Select All<ContextMenu.Shortcut>{key('A')}</ContextMenu.Shortcut>
  </ContextMenu.Item>
</ContextMenuInternal>
