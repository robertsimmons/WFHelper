<script lang="ts">
  import { tr } from "../../lib/i18n.js";
  import {
    CARD_GAP,
    CARD_MIN_WIDTH,
    clampPage,
    pageCountFor,
    pageSizeFor,
  } from "../../lib/suggest/grid.js";
  import SectionPager from "./SectionPager.svelte";
  import SuggestionCard from "./SuggestionCard.svelte";
  import type { Component } from "svelte";
  import type { Suggestion } from "../../types/suggest.js";

  interface Props {
    id: string;
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

  const { id, title, suggestions, collapsed, onToggle, onComplete, onDismiss, controls }: Props =
    $props();

  const Controls = $derived(controls);

  const label = $derived($tr(collapsed ? "layout.expandSection" : "layout.collapseSection"));

  let page = $state(0);
  let width = $state(0);

  const pageSize = $derived(pageSizeFor(width));
  const pageCount = $derived(pageCountFor(suggestions.length, pageSize));
  // The page is only ever clamped, never persisted: world state drops and adds
  // cards under the reader, and a stored page would point at other cards.
  const current = $derived(clampPage(page, pageCount));
  const shown = $derived(suggestions.slice(current * pageSize, current * pageSize + pageSize));
</script>

<section data-suggestion-section={id} data-section-count={suggestions.length}>
  <div class="mb-2 flex flex-wrap items-center gap-2">
    <button
      class="flex shrink-0 cursor-pointer items-center rounded border border-border bg-bg-surface
             px-2 py-1 text-text-secondary transition-[border-color,color] duration-150
             hover:border-border-strong hover:text-text-primary"
      data-section-toggle={id}
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
    <h3
      class="m-0 mr-auto font-display text-sm font-bold uppercase tracking-[0.08em] text-text-primary"
    >
      {title}
      <span class="font-normal text-text-muted">({suggestions.length})</span>
    </h3>
    {#if !collapsed}
      <Controls />
      <SectionPager {id} page={current} {pageCount} onPage={(next) => (page = next)} />
    {/if}
  </div>

  {#if !collapsed}
    <div
      class="grid content-start"
      style="gap: {CARD_GAP}px;
             grid-template-columns: repeat(auto-fill, minmax({CARD_MIN_WIDTH}px, 1fr))"
      bind:clientWidth={width}
    >
      {#each shown as suggestion (suggestion.id)}
        <SuggestionCard
          {suggestion}
          onComplete={(count) => onComplete(suggestion, count)}
          onDismiss={() => onDismiss(suggestion)}
        />
      {/each}
    </div>
  {/if}
</section>
