<svelte:options immutable={true} />

<script lang="ts">
  import { Button, DropdownMenu } from '@nasa-jpl/stellar-svelte';
  import type { EditorCommand } from '@nasa-jpl/plandev-sequence-languages';
  import type { EditorView } from 'codemirror';
  import { ChevronDown } from 'lucide-svelte';
  import { isMacOs } from '../../utilities/browser';
  import Tooltip from '../ui/Tooltip.svelte';

  /** The language's editor commands (e.g. Go to definition), run at the cursor. */
  export let commands: EditorCommand[] = [];
  export let view: EditorView | null = null;

  // Function keys need Fn on most Mac keyboards.
  const shortcutText = (shortcut: string) => (isMacOs() ? shortcut.replace(/\bF(\d+)\b/, 'Fn+F$1') : shortcut);

  function run(command: EditorCommand) {
    if (view) {
      view.focus();
      command.run(view);
    }
  }
</script>

{#if commands.length}
  <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild let:builder>
      <Tooltip content="Code commands at the cursor">
        <Button
          builders={[builder]}
          variant="outline"
          class="flex items-center gap-0.5 px-2"
          aria-label="Code commands"
        >
          Code <ChevronDown size={10} />
        </Button>
      </Tooltip>
    </DropdownMenu.Trigger>
    <DropdownMenu.Content align="end" class="z-[10000]">
      {#each commands as command (command.label)}
        <!-- Enabled state is read when the menu opens: commands depend on the language server being ready. -->
        <DropdownMenu.Item
          size="sm"
          disabled={!view || !(command.isEnabled?.(view) ?? true)}
          on:click={() => run(command)}
        >
          {command.label}
          {#if command.shortcut}
            <DropdownMenu.Shortcut>{shortcutText(command.shortcut)}</DropdownMenu.Shortcut>
          {/if}
        </DropdownMenu.Item>
      {/each}
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{/if}
