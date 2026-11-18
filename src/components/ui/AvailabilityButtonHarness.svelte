<script lang="ts">
  import type { Availability } from '../../utilities/availability';
  import AvailabilityButton from './AvailabilityButton.svelte';

  export let availability: Availability = { available: true };
  export let onClick: () => void = () => {};
</script>

<AvailabilityButton {availability} label="Do the thing" on:click={onClick}>Go</AvailabilityButton>
