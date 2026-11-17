<svelte:options immutable={true} />

<script lang="ts">
  import { Eye } from 'lucide-svelte';

  /** The reason (from PlanDev's existing permission/state messages) the panel can't be edited. */
  export let reason: string;
  export let title: string = 'View only.';
</script>

<!-- One banner per panel/page. Values, selection, details and provenance stay available below it. -->
<div class="restriction-banner" role="status" data-testid="restriction-banner">
  <Eye size={14} aria-hidden="true" class="shrink-0" />
  <span><strong>{title}</strong> {reason}</span>
</div>

<style>
  .restriction-banner {
    align-items: flex-start;
    background: hsl(var(--muted));
    border: 1px solid hsl(var(--border));
    border-radius: 4px;
    color: hsl(var(--muted-foreground));
    display: flex;
    font-size: 12px;
    gap: 8px;
    line-height: 16px;
    margin: 0 0 4px;
    padding: 6px 8px;
  }

  .restriction-banner :global(svg) {
    margin-top: 1px;
  }

  strong {
    color: hsl(var(--foreground));
    font-weight: 600;
  }
</style>
