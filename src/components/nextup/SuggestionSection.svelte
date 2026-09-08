<script lang="ts">
  import { tr } from "../../lib/i18n.js";
  import {
    CARD_GAP,
    clampPage,
    gridMinHeightFor,
    gridTemplateFor,
    pageCountFor,
    pageSizeFor,
  } from "../../lib/suggest/grid.js";
  import SectionPager from "./SectionPager.svelte";
  import SuggestionCard from "./SuggestionCard.svelte";
  import type { Component } from "svelte";
  import type { Suggestion, SuggestionSectionId } from "../../types/suggest.js";

  interface Props {
    id: SuggestionSectionId;
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
  let host = $state<HTMLElement | undefined>();
  let headerHeight = $state(0);
  let share = $state(0);
  // Measured off the section itself, which is mounted whether or not the grid
  // is, so the page count stays honest while the section is collapsed.
  let width = $state(0);

  /** No section owns a height region of its own: they share one scrolling
   *  column. The honest budget is that column's visible height split between
   *  the sections actually in it — a section with no cards does not render, so
   *  two of the four present get half the column each, not a quarter. */
  $effect(() => {
    const column = host?.parentElement;
    if (!column) return;
    const measure = (): void => {
      const peers = Math.max(
        1,
        column.querySelectorAll(":scope > [data-suggestion-section]").length,
      );
      const gap = Number.parseFloat(getComputedStyle(column).rowGap) || 0;
      share = (column.clientHeight - gap * (peers - 1)) / peers;
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(column);
    const children = new MutationObserver(measure);
    children.observe(column, { childList: true });
    return () => {
      resize.disconnect();
      children.disconnect();
    };
  });

  const budget = $derived(Math.max(0, share - headerHeight));
  const pageSize = $derived(pageSizeFor(width, id, budget));
  const pageCount = $derived(pageCountFor(suggestions.length, pageSize));
  // The page is only ever clamped, never persisted: world state drops and adds
  // cards under the reader, and a stored page would point at other cards.
  const current = $derived(clampPage(page, pageCount));
  const shown = $derived(suggestions.slice(current * pageSize, current * pageSize + pageSize));
</script>

<section
  data-suggestion-section={id}
  data-section-count={suggestions.length}
  bind:this={host}
  bind:clientWidth={width}
>
  <!-- Two groups, never one: the toggle, pager and title sit in a group that
       cannot wrap or shrink, so the variable-width controls can only ever wrap
       away from the pager, never push it. -->
  <div class="mb-2 flex flex-wrap items-center gap-2" bind:clientHeight={headerHeight}>
    <div class="flex shrink-0 items-center gap-2">
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
      <SectionPager
        {id}
        page={current}
        {pageCount}
        disabled={collapsed}
        onPage={(next) => (page = next)}
      />
      <h3 class="m-0 font-display text-sm font-bold uppercase tracking-[0.08em] text-text-primary">
        {title}
        <span class="font-normal text-text-muted">({suggestions.length})</span>
      </h3>
    </div>
    {#if !collapsed}
      <Controls />
    {/if}
  </div>

  {#if !collapsed}
    <div
      class="grid content-start"
      style="gap: {CARD_GAP}px; grid-template-columns: {gridTemplateFor(id)};
             min-height: {pageCount > 1 ? gridMinHeightFor(budget) : 0}px"
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
