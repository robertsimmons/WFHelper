<script lang="ts">
  import { flip } from "svelte/animate";

  import { tr } from "../../lib/i18n.js";
  import {
    CARD_GAP,
    clampPage,
    gridMinHeightFor,
    gridTemplateFor,
    pageCountFor,
    pageSizeFor,
  } from "../../lib/suggest/grid.js";
  import { FLIGHT_MS } from "./cardFlight.js";
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
    /** Set only where a card's primary action is to start working on it, which
     *  is what draws the button at all. */
    onWorkOnThis?: ((suggestion: Suggestion) => void) | undefined;
    /** The section's own filters and sort, as a component so each section owns
     *  one file; it reads the preference store rather than taking props. */
    controls: Component<Record<string, never>>;
  }

  const {
    id,
    title,
    suggestions,
    collapsed,
    onToggle,
    onComplete,
    onDismiss,
    onWorkOnThis = undefined,
    controls,
  }: Props = $props();

  const Controls = $derived(controls);

  const label = $derived($tr(collapsed ? "layout.expandSection" : "layout.collapseSection"));

  let page = $state(0);
  let host = $state<HTMLElement | undefined>();
  let headerHeight = $state(0);
  let share = $state(0);
  // Measured off the section itself, which is mounted whether or not the grid
  // is, so the page count stays honest while the section is collapsed.
  let width = $state(0);

  /** Kept for its controls rather than for its cards: the view leaves a section
   *  its own filters emptied on the page, so there is something to undo it with. */
  const empty = $derived(suggestions.length === 0);

  /** A section only claims a share of the column while it has cards to put in
   *  it; one kept for its controls is as fixed in height as the pinned strip. */
  function grows(kid: Element): boolean {
    return kid.hasAttribute("data-suggestion-section") && !kid.hasAttribute("data-section-empty");
  }

  /** No section owns a height region of its own: they share one scrolling
   *  column. The honest budget is that column's visible height split between
   *  the sections actually drawing cards, so two of the four present get half
   *  the column each, not a quarter. */
  $effect(() => {
    const column = host?.parentElement;
    if (!column) return;
    const measure = (): void => {
      const kids = [...column.children];
      const peers = Math.max(1, kids.filter(grows).length);
      const gap = Number.parseFloat(getComputedStyle(column).rowGap) || 0;
      // Whatever else shares the column - the pinned strip, a section kept for
      // its controls - owns its height outright, so it comes off the budget
      // before the sections split it.
      const extra = kids
        .filter((kid) => !grows(kid))
        .reduce((sum, kid) => sum + kid.getBoundingClientRect().height, 0);
      share = (column.clientHeight - extra - gap * (kids.length - 1)) / peers;
    };
    const resize = new ResizeObserver(measure);
    resize.observe(column);
    const watchExtras = (): void => {
      for (const kid of column.children) {
        if (grows(kid)) resize.unobserve(kid);
        else resize.observe(kid);
      }
    };
    watchExtras();
    measure();
    const remeasure = (): void => {
      watchExtras();
      measure();
    };
    const children = new MutationObserver(remeasure);
    children.observe(column, { childList: true });
    // A section its own filters emptied stops claiming a share without the
    // column gaining or losing a child. Its own observer, because childList and
    // a descendant attribute cannot be watched under one set of options without
    // also watching every card added to every section.
    const flags = new MutationObserver(remeasure);
    flags.observe(column, { subtree: true, attributeFilter: ["data-section-empty"] });
    return () => {
      resize.disconnect();
      children.disconnect();
      flags.disconnect();
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
  data-section-empty={empty ? "" : undefined}
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

  {#if !collapsed && empty}
    <p class="m-0 text-xs text-text-muted" data-section-empty-note={id}>
      {$tr("nextUp.sectionFiltered")}
    </p>
  {:else if !collapsed}
    <div
      class="grid content-start"
      style="gap: {CARD_GAP}px; grid-template-columns: {gridTemplateFor(id)};
             min-height: {pageCount > 1 ? gridMinHeightFor(budget) : 0}px"
    >
      {#each shown as suggestion (suggestion.id)}
        <!-- The wrapper exists so the cards around one that leaves slide into
             its place rather than snapping. -->
        <div animate:flip={{ duration: FLIGHT_MS }}>
          <SuggestionCard
            {suggestion}
            onComplete={(count) => onComplete(suggestion, count)}
            onDismiss={() => onDismiss(suggestion)}
            onWorkOnThis={onWorkOnThis ? () => onWorkOnThis(suggestion) : undefined}
          />
        </div>
      {/each}
    </div>
  {/if}
</section>
