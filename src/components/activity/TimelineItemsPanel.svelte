<svelte:options immutable={true} />

<script lang="ts">
  import DirectiveAndSpanIcon from '../../assets/timeline-directive-and-span.svg?component';
  import TimelineLineLayerIcon from '../../assets/timeline-line-layer.svg?component';
  import type { User } from '../../types/app';
  import type { ViewGridSection } from '../../types/view';
  import ActivityList from '../ActivityList.svelte';
  import GridMenu from '../menus/GridMenu.svelte';
  import ResourceList from '../ResourceList.svelte';
  import SourceBrowser from '../sources/SourceBrowser.svelte';
  import Panel from '../ui/Panel.svelte';
  import Tab from '../ui/Tabs/Tab.svelte';
  import TabPanel from '../ui/Tabs/TabPanel.svelte';
  import Tabs from '../ui/Tabs/Tabs.svelte';

  export let gridSection: ViewGridSection;
  export let user: User | null;
</script>

<!--
  Plan: what the editable plan and its mission model know how to create (activity types) or declare
  (model resource types). Sources: the data actually available to this plan's timeline, by where it comes from.
-->
<Panel padBody={false}>
  <svelte:fragment slot="header">
    <GridMenu {gridSection} title="Plan & Sources" />
  </svelte:fragment>

  <svelte:fragment slot="body">
    <Tabs class="timeline-items-tabs" tabListClassName="timeline-items-tabs-list">
      <svelte:fragment slot="tab-list">
        <Tab class="timeline-items-tab text-xs">Plan</Tab>
        <Tab class="timeline-items-tab text-xs">Sources</Tab>
      </svelte:fragment>
      <TabPanel>
        <Tabs class="plan-catalog-tabs" tabListClassName="plan-catalog-tabs-list">
          <svelte:fragment slot="tab-list">
            <Tab class="plan-catalog-tab text-xs"><DirectiveAndSpanIcon /> Activity Types</Tab>
            <Tab class="plan-catalog-tab text-xs"><TimelineLineLayerIcon /> Model Resources</Tab>
          </svelte:fragment>
          <TabPanel>
            <ActivityList {user} />
          </TabPanel>
          <TabPanel>
            <ResourceList />
          </TabPanel>
        </Tabs>
      </TabPanel>
      <TabPanel>
        <SourceBrowser showAddSource {user} />
      </TabPanel>
    </Tabs>
  </svelte:fragment>
</Panel>

<style>
  :global(.tab-list.plan-catalog-tabs-list) {
    border-bottom: 1px solid var(--st-gray-20);
  }

  :global(button.plan-catalog-tab) {
    align-items: center;
    display: flex;
    gap: 8px;
  }

  :global(.tab-list.timeline-items-tabs-list) {
    background-color: var(--st-gray-10);
  }

  :global(button.timeline-items-tab) {
    align-items: center;
    display: flex;
    gap: 8px;
    text-align: left;
  }

  :global(button.timeline-items-tab:last-of-type) {
    flex: 1;
  }

  :global(button.timeline-items-tab:last-of-type.selected) {
    box-shadow: 1px 0px 0px inset var(--st-gray-20);
  }

  :global(button.timeline-items-tab:first-of-type.selected) {
    box-shadow: -1px 0px 0px inset var(--st-gray-20);
  }

  :global(button.timeline-items-tab:not(.selected)) {
    box-shadow: 0px -1px 0px inset var(--st-gray-20);
  }

  :global(.timeline-items-tabs .timeline-items-tabs-list button.timeline-items-tab.selected) {
    background-color: white;
    box-shadow:
      1px 0px 0px inset var(--st-gray-20),
      -1px 0px 0px inset var(--st-gray-20);
  }
</style>
