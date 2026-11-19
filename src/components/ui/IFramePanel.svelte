<svelte:options immutable={true} />

<script lang="ts">
  import { Link } from 'lucide-svelte';
  import { view, viewUpdateIFrame } from '../../stores/views';
  import type { ViewGridSection, ViewIFrame } from '../../types/view';
  import GridMenu from '../menus/GridMenu.svelte';
  import Panel from '../ui/Panel.svelte';
  import IFrame from './IFrame.svelte';

  export let gridSection: ViewGridSection;

  let iFrameId: number = 0;
  let iFrame: ViewIFrame | undefined;
  let iFrameSrc: string = '';
  /** The URL is panel configuration, not something to read while working: shown on demand, or when it is missing. */
  let editingSrc: boolean = false;

  $: iFrame = $view?.definition.plan.iFrames.find(frame => frame.id === iFrameId);
  $: iFrameSrc = iFrame?.src ?? '';
  $: viewUpdateIFrame('src', iFrameSrc, iFrameId);
</script>

<Panel padBody={false}>
  <svelte:fragment slot="header">
    <GridMenu {gridSection} title="External Application" />
    {#if editingSrc || iFrameSrc === ''}
      <!-- svelte-ignore a11y-autofocus -->
      <input
        bind:value={iFrameSrc}
        autofocus={editingSrc}
        aria-label="Application URL"
        class="st-input w-full"
        class:error={iFrameSrc === ''}
        placeholder="Application URL"
        type="text"
        on:blur={() => (editingSrc = false)}
        on:keydown={e => (e.key === 'Enter' || e.key === 'Escape') && (editingSrc = false)}
      />
    {:else}
      <button
        class="st-button icon"
        aria-label="Change the application URL"
        title="Application URL: {iFrameSrc} (click to change)"
        on:click={() => (editingSrc = true)}
      >
        <Link size={14} />
      </button>
    {/if}
  </svelte:fragment>

  <svelte:fragment slot="body">
    <IFrame {iFrameId} {gridSection} />
  </svelte:fragment>
</Panel>
