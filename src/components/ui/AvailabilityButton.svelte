<svelte:options immutable={true} />

<script lang="ts">
  import { Button } from '@nasa-jpl/stellar-svelte';
  import { AVAILABLE, createAvailabilityBuilder, type Availability } from '../../utilities/availability';

  /**
   * Thin adapter that gives a Stellar `Button` the shared availability behaviour (see utilities/availability.ts).
   * It adds no styling of its own: every other prop is forwarded to the Stellar Button unchanged.
   */
  export let availability: Availability = AVAILABLE;
  /** Tooltip / accessible name while the action is available. */
  export let label: string = '';
  export let placement: 'top' | 'bottom' | 'left' | 'right' = 'top';
  /** Set to false when the reason is already visible beside the button. */
  export let tooltip: boolean = true;

  const availabilityBuilder = createAvailabilityBuilder();

  $: availabilityBuilder.update({ ...availability, label, placement, tooltip });
</script>

<Button builders={[availabilityBuilder.builder]} on:click on:keydown {...$$restProps}>
  <slot />
</Button>
