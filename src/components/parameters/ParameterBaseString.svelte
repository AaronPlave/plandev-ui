<svelte:options immutable={true} />

<script lang="ts">
  import { Eye, EyeOff } from 'lucide-svelte';
  import { createEventDispatcher } from 'svelte';
  import type { FormParameter } from '../../types/parameter';
  import ParameterInputBox from './ParameterInputBox.svelte';

  export let errorId: string = '';
  export let formParameter: FormParameter;
  export let type: 'text' | 'password' = 'text';

  const dispatch = createEventDispatcher<{ change: FormParameter }>();

  // A secret is masked until someone who can edit it chooses to show it. Nothing is copyable while masked.
  let revealed: boolean = false;

  $: inputType = type === 'password' && !revealed ? 'password' : 'text';

  function handleChange(): void {
    dispatch('change', formParameter);
  }
</script>

<ParameterInputBox trailing={type === 'password'} unit={formParameter.schema?.metadata?.unit?.value}>
  <!-- Type can only be text or password so it's safe to overwrite the type and don't coerce the value. -->
  <input
    bind:value={formParameter.value}
    class="st-input w-full"
    class:error={formParameter.errors !== null}
    aria-label={formParameter.name}
    aria-invalid={formParameter.errors !== null ? true : undefined}
    aria-describedby={formParameter.errors !== null ? errorId : undefined}
    autocomplete="off"
    {...{ type: inputType }}
    on:change={handleChange}
  />
  <svelte:fragment slot="trailing">
    {#if type === 'password'}
      <button
        type="button"
        class="reveal"
        aria-label={revealed ? `Hide ${formParameter.name}` : `Show ${formParameter.name}`}
        aria-pressed={revealed}
        on:click={() => (revealed = !revealed)}
      >
        {#if revealed}<EyeOff size={14} />{:else}<Eye size={14} />{/if}
      </button>
    {/if}
  </svelte:fragment>
</ParameterInputBox>

<style>
  .reveal {
    align-items: center;
    background: none;
    border: 0;
    border-radius: 4px;
    color: hsl(var(--muted-foreground));
    cursor: pointer;
    display: flex;
    height: 20px;
    justify-content: center;
    width: 20px;
  }

  .reveal:hover {
    color: hsl(var(--foreground));
  }
</style>
