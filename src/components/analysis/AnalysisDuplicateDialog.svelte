<svelte:options immutable={true} />

<!--
  Duplicate an analysis: a new analysis, owned by whoever duplicates it, with the saved sources (the same revisions),
  View and annotations of the original as last saved; nothing of a page's unsaved state comes with it, and the original
  is not changed. A plan source stays live in the copy too.
-->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import { Button, Dialog, Input } from '@nasa-jpl/stellar-svelte';
  import type { AnalysisSlim } from '../../types/analysis';
  import type { User } from '../../types/app';
  import effects from '../../utilities/effects';

  /** The analysis to duplicate; the dialog is open while it is set. */
  export let analysis: AnalysisSlim | null = null;
  export let user: User | null;

  let name: string = '';
  let duplicating: boolean = false;
  let open: boolean = false;

  $: open = analysis !== null;
  $: if (analysis) {
    name = `Copy of ${analysis.name}`;
  }

  async function duplicate() {
    if (!analysis) {
      return;
    }
    duplicating = true;
    const id = await effects.duplicateAnalysis(analysis.id, name.trim(), user);
    duplicating = false;
    if (id !== null) {
      analysis = null;
      goto(`${base}/analyses/${id}`);
    }
  }
</script>

<Dialog.Root {open} onOpenChange={next => !next && (analysis = null)}>
  <Dialog.Content class="max-w-[440px]">
    <Dialog.Header>
      <Dialog.Title>Duplicate Analysis</Dialog.Title>
      <Dialog.Description>
        A new analysis of your own with the same sources (the same revisions), View and annotations, as last saved. The
        original is not changed. A plan source stays live in the copy: it still follows the plan's changes.
      </Dialog.Description>
    </Dialog.Header>
    <form class="flex flex-col gap-1 text-xs" on:submit|preventDefault={duplicate}>
      <label for="duplicate-analysis-name">Name</label>
      <Input id="duplicate-analysis-name" sizeVariant="xs" bind:value={name} />
    </form>
    <Dialog.Footer>
      <Button variant="outline" on:click={() => (analysis = null)}>Cancel</Button>
      <Button disabled={!name.trim() || duplicating} on:click={duplicate}
        >{duplicating ? 'Duplicating…' : 'Duplicate'}</Button
      >
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
