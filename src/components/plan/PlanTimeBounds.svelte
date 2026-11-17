<svelte:options immutable={true} />

<script lang="ts">
  import { Pencil } from 'lucide-svelte';
  import { PlanStatusMessages } from '../../enums/planStatusMessages';
  import { plugins } from '../../stores/plugins';
  import type { User } from '../../types/app';
  import type { Plan, PlanSlim } from '../../types/plan';
  import { availabilityOf } from '../../utilities/availability';
  import { showChangePlanBoundsModal } from '../../utilities/modal';
  import { convertDoyToYmd, convertUsToDurationString, formatDate, getIntervalInMs } from '../../utilities/time';
  import PropertyField from '../form/PropertyField.svelte';
  import AvailabilityButton from '../ui/AvailabilityButton.svelte';

  export let plan: Plan | PlanSlim;
  export let user: User | null = null;
  export let hasUpdatePermission: boolean = false;
  export let permissionError: string = '';
  export let isReadOnly: boolean = false;

  let startTimeString: string = '';
  let endTimeYmd: string | null = null;
  let endTimeString: string = '';
  let durationString: string = '';

  // Start/end/duration are read views (plain, selectable text). Editing goes through ChangePlanBoundsModal, which
  // edits both bounds at once, so the single editing action sits on the Start row.
  $: startTimeString = formatDate(new Date(plan.start_time), $plugins.time.primary.format);
  $: endTimeYmd = convertDoyToYmd(plan.end_time_doy);
  $: endTimeString = endTimeYmd ? formatDate(new Date(endTimeYmd), $plugins.time.primary.format) : plan.end_time_doy;
  $: durationString = convertUsToDurationString(getIntervalInMs(plan.duration) * 1000) || '';
  $: changeBoundsAvailability = isReadOnly
    ? availabilityOf(false, PlanStatusMessages.READ_ONLY)
    : availabilityOf(hasUpdatePermission, permissionError);

  function openChangePlanBoundsModal() {
    showChangePlanBoundsModal(plan, user);
  }
</script>

<PropertyField label={`Start (${$plugins.time.primary.label})`} name="planStartTime" value={startTimeString}>
  <AvailabilityButton
    slot="action"
    aria-label="Change plan time range"
    availability={changeBoundsAvailability}
    label="Change plan time range"
    size="icon-sm"
    variant="ghost"
    on:click={openChangePlanBoundsModal}
  >
    <Pencil size={14} />
  </AvailabilityButton>
</PropertyField>
<PropertyField label={`End (${$plugins.time.primary.label})`} name="planEndTime" value={endTimeString} />
<PropertyField label="Duration" name="planDuration" value={durationString} />
