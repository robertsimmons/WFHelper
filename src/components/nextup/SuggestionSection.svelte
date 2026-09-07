<script lang="ts">
  import { tr } from "../../lib/i18n.js";
  import { CARD_GAP } from "../../lib/suggest/grid.js";
  import SuggestionCard from "./SuggestionCard.svelte";
  import type { Component } from "svelte";
  import type { Suggestion } from "../../types/suggest.js";

  interface Props {
    title: string;
    suggestions: Suggestion[];
    collapsed: boolean;
    onToggle: () => void;
    onComplete: (suggestion: Suggestion, count: number) => void;
    onDismiss: (suggestion: Suggestion) => void;
    /** The section's own filters and sort, as a component so each section owns
     *  one file; it reads the preference store rather than taking props. */
    controls: Component<Record<string, never>>;
  }

  const { title, suggestions, collapsed, onToggle, onComplete, onDismiss, controls }: Props =
    $props();

  const Controls = $derived(controls);

  const label = $derived($tr(collapsed ? "layout.expandSection" : "layout.collapseSection"));
</script>

<section>
  <div class="mb-2 flex flex-wrap items-center gap-2">
    <h3
      class="m-0 mr-auto font-display text-sm font-bold uppercase tracking-[0.08em] text-text-primary"
    >
      {title}
      <span class="font-normal text-text-muted">({suggestions.length})</span>
    </h3>
    {#if !collapsed}
      <Controls />
    {/if}
    <button
      class="flex cursor-pointer items-center rounded border border-border bg-bg-surface px-2 py-1
             text-text-secondary transition-[border-color,color] duration-150
             hover:border-border-strong hover:text-text-primary"
      aria-expanded={!collapsed}
      title={label}
      aria-label={label}
      onclick={onToggle}
    >
      <svg
        class="h-3 w-3 transition-transform duration-150 {collapsed ? '-rotate-90' : ''}"
        viewBox="0 0 12 12"
        aria-hidden="true"
      >
        <polygon points="2,3 10,3 6,9" fill="currentColor" />
      </svg>
    </button>
  </div>

  {#if !collapsed}
    <div class="flex flex-wrap content-start" style="gap: {CARD_GAP}px">
      {#each suggestions as suggestion (suggestion.id)}
        <SuggestionCard
          {suggestion}
          onComplete={(count) => onComplete(suggestion, count)}
          onDismiss={() => onDismiss(suggestion)}
        />
      {/each}
    </div>
  {/if}
</section>
