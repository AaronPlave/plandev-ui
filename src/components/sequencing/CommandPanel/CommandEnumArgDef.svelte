<svelte:options immutable={true} />

<script lang="ts">
  import type { EnumMap, FswCommandArgumentEnum } from '@nasa-jpl/plandev-ampcs';
  import { enumSymbols } from '../../../utilities/sequence-editor/mission-reference';
  import Collapse from '../../Collapse.svelte';
  import CommandArgUnit from './CommandArgUnit.svelte';

  export let argDef: FswCommandArgumentEnum;
  export let enumMap: EnumMap = {};

  let enumValues: string = '';

  $: enumValues = enumSymbols(argDef, enumMap).join('\n');
</script>

<Collapse title={argDef.name}>
  <div class="text-xs">{argDef.description}</div>
  <div>
    <textarea class="enum-values rounded border" disabled>{enumValues}</textarea>
  </div>
  <div slot="right">
    <CommandArgUnit type="enum" unitShortName="enum" />
  </div>
</Collapse>

<style>
  .enum-values {
    color: var(--st-gray-100);
  }
</style>
