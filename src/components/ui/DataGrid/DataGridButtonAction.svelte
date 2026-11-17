<svelte:options immutable={true} />

<!-- A labeled Stellar button for a grid cell (DataGridActions has icon buttons only): mounted by a cellRenderer. -->
<script lang="ts">
  import { Button } from '@nasa-jpl/stellar-svelte';

  export let disabled: boolean = false;
  export let label: string;
  export let onClick: () => void;
  export let title: string | undefined = undefined;
  export let variant: 'outline' | 'ghost' | 'destructive' = 'outline';
</script>

<Button size="xs" class="h-6 px-2" {variant} {disabled} {title} on:click={event => (event.stopPropagation(), onClick())}
  >{label}</Button
>
