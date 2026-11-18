<script lang="ts">
  // Test stand-in for ActivityPresetInput: lets a test trigger the events the real control would emit.
  import { createEventDispatcher } from 'svelte';

  // The props the form passes; unused here.
  export let activityDirective: unknown = null;
  export let disabled: boolean = false;
  export let hasChanges: boolean = false;
  export let modelId: number = 0;
  export let plan: unknown = null;
  export let user: unknown = null;
  void [activityDirective, disabled, hasChanges, modelId, plan, user];

  const dispatch = createEventDispatcher();
</script>

<button data-testid="stub-save-new" on:click={() => dispatch('saveNewPreset', { name: 'Fresh' })}>save new</button>
<button data-testid="stub-apply" on:click={() => dispatch('applyPreset', { id: 9, name: 'Other' })}>apply</button>
<button data-testid="stub-save" on:click={() => dispatch('savePreset', { name: 'Renamed' })}>save</button>
<button data-testid="stub-delete" on:click={() => dispatch('deletePreset', { id: 9, name: 'Other' })}>delete</button>
