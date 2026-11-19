<svelte:options immutable={true} />

<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { expandedGridSection } from '../../stores/views';
  import type { User } from '../../types/app';
  import type { ViewGridComponent } from '../../types/view';
  import ActivityDirectivesTablePanel from '../activity/ActivityDirectivesTablePanel.svelte';
  import ActivityFormPanel from '../activity/ActivityFormPanel.svelte';
  import ActivitySpansTablePanel from '../activity/ActivitySpansTablePanel.svelte';
  import TimelineItemsPanel from '../activity/TimelineItemsPanel.svelte';
  import ConstraintsPanel from '../constraints/ConstraintsPanel.svelte';
  import CosmolabePanel from '../cosmolabe/CosmolabePanel.svelte';
  import ExpansionPanel from '../expansion/ExpansionPanel.svelte';
  import ExternalEventFormPanel from '../external-events/ExternalEventFormPanel.svelte';
  import ExternalEventsTablePanel from '../external-events/ExternalEventsTablePanel.svelte';
  import ExternalSourcesPanel from '../external-source/ExternalSourcesPanel.svelte';
  import PlanMetadataPanel from '../plan/PlanMetadataPanel.svelte';
  import SchedulingConditionsPanel from '../scheduling/SchedulingConditionsPanel.svelte';
  import SchedulingGoalsPanel from '../scheduling/SchedulingGoalsPanel.svelte';
  import SimulationEventsPanel from '../simulation/SimulationEventsPanel.svelte';
  import SimulationPanel from '../simulation/SimulationPanel.svelte';
  import TimeCursorPanel from '../timeline/TimeCursorPanel.svelte';
  import TimelinePanel from '../timeline/TimelinePanel.svelte';
  import TimelineEditorPanel from '../timeline/form/TimelineEditorPanel.svelte';
  import CssGrid from './CssGrid.svelte';
  import CssGridGutter from './CssGridGutter.svelte';
  import IFramePanel from './IFramePanel.svelte';

  export let columnSizes: string = '1fr 3px 3fr 3px 1fr';
  export let leftComponentBottom: ViewGridComponent = 'SimulationPanel';
  export let leftComponentTop: ViewGridComponent = 'TimelineItemsPanel';
  export let leftHidden: boolean = false;
  export let leftRowSizes: string = '1fr 3px 1fr';
  export let leftSplit: boolean = false;
  export let middleComponentBottom: ViewGridComponent = 'ActivityDirectivesTablePanel';
  export let middleRowSizes: string = '2fr 3px 1fr';
  export let middleSplit: boolean = true;
  export let rightComponentBottom: ViewGridComponent = 'TimelineEditorPanel';
  export let rightComponentTop: ViewGridComponent = 'ActivityFormPanel';
  export let rightHidden: boolean = false;
  export let rightRowSizes: string = '1fr 3px 1fr';
  export let rightSplit: boolean = false;
  export let user: User | null;

  const dispatch = createEventDispatcher<{
    changeColumnSizes: string;
    changeLeftRowSizes: string;
    changeMiddleRowSizes: string;
    changeRightRowSizes: string;
  }>();

  const gridComponentsByName: Record<ViewGridComponent, any> = {
    ActivityDirectivesTablePanel,
    ActivityFormPanel,
    ActivitySpansTablePanel,
    ConstraintsPanel,
    CosmolabePanel,
    ExpansionPanel,
    ExternalEventFormPanel,
    ExternalEventsTablePanel,
    ExternalSourcesPanel,
    IFramePanel,
    PlanMetadataPanel,
    SchedulingConditionsPanel,
    SchedulingGoalsPanel,
    SimulationEventsPanel,
    SimulationPanel,
    TimeCursorPanel,
    TimelineEditorPanel,
    TimelineItemsPanel,
  };

  // Expansion is per page visit: leaving the plan page restores the grid.
  onDestroy(() => expandedGridSection.set(null));

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && $expandedGridSection !== null && !event.defaultPrevented) {
      expandedGridSection.set(null);
    }
  }

  function onChangeColumnSizes(event: CustomEvent<string>) {
    dispatch('changeColumnSizes', event.detail);
  }

  function onChangeLeftRowSizes(event: CustomEvent<string>) {
    dispatch('changeLeftRowSizes', event.detail);
  }

  function onChangeMiddleRowSizes(event: CustomEvent<string>) {
    dispatch('changeMiddleRowSizes', event.detail);
  }

  function onChangeRightRowSizes(event: CustomEvent<string>) {
    dispatch('changeRightRowSizes', event.detail);
  }
</script>

<svelte:window on:keydown={onKeydown} />

<!-- An expanded panel is the same element (and component instance) restyled over the grid, so an iframe in
     it is never reloaded; the grid's sizes are untouched and come back as they were. -->
<CssGrid class="plan-grid plan-grid-root" columns={columnSizes} on:changeColumnSizes={onChangeColumnSizes}>
  {#if $expandedGridSection !== null}
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="plan-grid-backdrop" title="Restore the grid" on:click={() => expandedGridSection.set(null)} />
  {/if}
  {#if !leftHidden}
    {#if leftSplit}
      <CssGrid class="plan-grid" rows={leftRowSizes} on:changeRowSizes={onChangeLeftRowSizes}>
        <div
          class="plan-grid-component"
          class:expanded={$expandedGridSection === 'LeftTop'}
          data-component-name={leftComponentTop}
        >
          <svelte:component this={gridComponentsByName[leftComponentTop]} gridSection="LeftTop" {user} />
        </div>
        <CssGridGutter track={1} type="row" />
        <div
          class="plan-grid-component"
          class:expanded={$expandedGridSection === 'LeftBottom'}
          data-component-name={leftComponentBottom}
        >
          <svelte:component this={gridComponentsByName[leftComponentBottom]} gridSection="LeftBottom" {user} />
        </div>
      </CssGrid>
    {:else}
      <div
        class="plan-grid-component"
        class:expanded={$expandedGridSection === 'LeftTop'}
        data-component-name={leftComponentTop}
      >
        <svelte:component this={gridComponentsByName[leftComponentTop]} gridSection="LeftTop" {user} />
      </div>
    {/if}

    <CssGridGutter track={1} type="column" />
  {/if}

  {#if middleSplit}
    <CssGrid class="plan-grid" rows={middleRowSizes} on:changeRowSizes={onChangeMiddleRowSizes}>
      <div class="plan-grid-component" data-component-name="TimelinePanel">
        <TimelinePanel {user} />
      </div>
      <CssGridGutter track={1} type="row" />
      <div
        class="plan-grid-component"
        class:expanded={$expandedGridSection === 'MiddleBottom'}
        data-component-name={middleComponentBottom}
      >
        <svelte:component this={gridComponentsByName[middleComponentBottom]} gridSection="MiddleBottom" {user} />
      </div>
    </CssGrid>
  {:else}
    <div class="plan-grid-component" data-component-name="TimelinePanel">
      <TimelinePanel {user} />
    </div>
  {/if}

  {#if !rightHidden}
    <CssGridGutter track={leftHidden ? 1 : 3} type="column" />

    {#if rightSplit}
      <CssGrid class="plan-grid" rows={rightRowSizes} on:changeRowSizes={onChangeRightRowSizes}>
        <div
          class="plan-grid-component"
          class:expanded={$expandedGridSection === 'RightTop'}
          data-component-name={rightComponentTop}
        >
          <svelte:component this={gridComponentsByName[rightComponentTop]} gridSection="RightTop" {user} />
        </div>
        <CssGridGutter track={1} type="row" />
        <div
          class="plan-grid-component"
          class:expanded={$expandedGridSection === 'RightBottom'}
          data-component-name={rightComponentBottom}
        >
          <svelte:component this={gridComponentsByName[rightComponentBottom]} gridSection="RightBottom" {user} />
        </div>
      </CssGrid>
    {:else}
      <div
        class="plan-grid-component"
        class:expanded={$expandedGridSection === 'RightTop'}
        data-component-name={rightComponentTop}
      >
        <svelte:component this={gridComponentsByName[rightComponentTop]} gridSection="RightTop" {user} />
      </div>
    {/if}
  {/if}
</CssGrid>

<style>
  :global(.plan-grid) {
    overflow: auto;
  }

  :global(.plan-grid-root) {
    position: relative;
  }

  .plan-grid-component {
    display: grid;
    height: 100%;
    overflow-y: auto;
    width: 100%;
  }

  /* The grid cell stays in place (so the other panels keep their tracks); its panel is lifted over the grid. */
  .plan-grid-component.expanded > :global(*) {
    background: var(--st-utility-white, #fff);
    border: 1px solid var(--st-gray-30, #ccc);
    border-radius: 4px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    height: auto;
    inset: 8px;
    position: absolute;
    width: auto;
    z-index: 30;
  }

  .plan-grid-backdrop {
    background: rgba(0, 0, 0, 0.25);
    inset: 0;
    position: absolute;
    z-index: 29;
  }
</style>
