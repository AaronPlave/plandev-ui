<script lang="ts">
  import { field } from '../../stores/form';
  import { required } from '../../utilities/validators';
  import Field from './Field.svelte';
  import PropertyField from './PropertyField.svelte';

  export let editable: boolean = true;
  export let saved: string = 'Saved name';
  export let onChange: (value: string) => void = () => {};

  const nameField = field<string>('', [required]);
  $: nameField.validateAndSet(saved);
</script>

<Field field={nameField} on:change={() => onChange($nameField.value)}>
  <PropertyField {editable} id="name" label="Name" value={saved}>
    <input class="st-input w-full" id="name" name="name" />
  </PropertyField>
</Field>
