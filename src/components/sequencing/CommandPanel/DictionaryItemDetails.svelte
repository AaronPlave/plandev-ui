<svelte:options immutable={true} />

<script lang="ts">
  import type { PhoenixContext } from '@nasa-jpl/plandev-sequence-languages';

  /** A telemetry channel or parameter read at the cursor, shown from the parcel's dictionaries. */
  export let kind: 'parameter' | 'telemetry';
  export let name: string;
  export let phoenixContext: PhoenixContext;

  let rows: [string, string | number | null | undefined][] = [];
  let description: string = '';

  $: if (kind === 'telemetry') {
    const channel = phoenixContext.channelDictionary?.telemetryMap[name];
    description = channel?.description ?? '';
    rows = [
      ['Type', channel?.type],
      ['ID', channel?.measurement_id],
    ];
  } else {
    const parameter = phoenixContext.parameterDictionaries.map(d => d.paramMap[name]).find(Boolean);
    description = parameter?.description ?? '';
    const range = parameter && 'range' in parameter ? parameter.range : null;
    rows = [
      ['Type', parameter?.param_type.replace(/_param$/, '')],
      ['ID', parameter?.param_id],
      ['Default', parameter?.default_value as string | number | null | undefined],
      ['Range', range ? `${range.min} … ${range.max}` : null],
      ['Units', parameter && 'units' in parameter ? parameter.units : null],
    ];
  }
</script>

<div class="text-xs">
  <div class="border-b bg-muted px-4 py-2 font-medium">
    <span class="text-muted-foreground">{kind === 'telemetry' ? 'Telemetry read' : 'Parameter read'}</span>
    <div class="break-all">{name}</div>
  </div>
  {#if description}
    <p class="px-4 py-2">{description}</p>
  {/if}
  <dl class="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 px-4 py-2">
    {#each rows.filter(([, value]) => value !== null && value !== undefined && value !== '') as [label, value]}
      <dt class="text-muted-foreground">{label}</dt>
      <dd class="break-all">{value}</dd>
    {/each}
  </dl>
</div>
