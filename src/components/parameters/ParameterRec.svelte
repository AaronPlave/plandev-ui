<svelte:options immutable={true} />

<script lang="ts">
  import type { FormParameter, ParameterCapabilities, ParameterType } from '../../types/parameter';

  export let capabilities: ParameterCapabilities;
  export let expanded: boolean = false;
  export let formParameter: FormParameter;
  export let hideDetails: boolean = false;
  export let hideRightAdornments: boolean = false;
  export let indent: number = 0;
  export let level: number = 0;
  export let parameterType: ParameterType = 'activity';
  export let path: string = '';

  let component: any;

  $: loadComponent(formParameter);

  // Struct and series recurse into ParameterRec/ParameterBase, so they are loaded lazily to break the import cycle.
  async function loadComponent(formParameter: FormParameter) {
    if (formParameter.schema.type === 'series') {
      component = (await import('./ParameterRecSeries.svelte')).default;
    } else if (formParameter.schema.type === 'struct') {
      component = (await import('./ParameterRecStruct.svelte')).default;
    }
  }
</script>

<svelte:component
  this={component}
  {capabilities}
  {expanded}
  {formParameter}
  {hideDetails}
  {hideRightAdornments}
  {indent}
  {level}
  {parameterType}
  {path}
  on:change
  on:reset
/>
