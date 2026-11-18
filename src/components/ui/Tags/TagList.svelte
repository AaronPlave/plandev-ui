<svelte:options immutable={true} />

<script lang="ts">
  import type { Tag } from '../../../types/tags';
  import ReadValue from '../../form/ReadValue.svelte';
  import TagChip from './Tag.svelte';

  /** Read-only presentation of a set of tags (chips, or muted "None"). */
  export let tags: Partial<Tag>[] = [];
</script>

<div class="flex flex-wrap gap-[2px]" data-testid="tags-read">
  {#each tags as tag (tag.id)}
    <TagChip {tag} removable={false} />
  {:else}
    <ReadValue value={null} />
  {/each}
</div>
