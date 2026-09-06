<script lang="ts">
  import { onMount } from "svelte";

  import SuggestionCard from "../components/nextup/SuggestionCard.svelte";
  import SuggestionSettingsModal from "../components/nextup/SuggestionSettingsModal.svelte";
  import { tr, type MessageKey } from "../lib/i18n.js";
  import { filterByCategory } from "../lib/suggest/engine.js";
  import { CARD_GAP, clampPage, gridCapacity, pageCountFor } from "../lib/suggest/grid.js";
  import { mountWorldPolling } from "../lib/world/useWorldView.js";
  import { ensureDropPools } from "../stores/dropPools.js";
  import {
    categoryFilter,
    completeTask,
    dismissSuggestion,
    restoreAllSuggestions,
    suggestionFeed,
    toggleCategoryFilter,
  } from "../stores/suggestions.js";
  import { SUGGESTION_CATEGORIES, type Suggestion } from "../types/suggest.js";
  import type { SuggestionCategory } from "../types/suggest.js";

  const FILTER_LABELS: Record<SuggestionCategory, MessageKey> = {
    daily: "dailies.groupDaily",
    weekly: "dailies.groupWeekly",
    nightwave: "dailies.groupNightwave",
  };

  const ARROW_CLASS =
    "cursor-pointer rounded border border-border bg-bg-surface px-2 py-1 text-base leading-none " +
    "text-text-secondary transition-[border-color,color] duration-150 hover:border-border-strong " +
    "hover:text-text-primary disabled:cursor-default disabled:opacity-40";

  let page = $state(0);
  let settingsOpen = $state(false);
  let gridEl = $state<HTMLDivElement | null>(null);
  let box = $state({ width: 0, height: 0 });

  // Nightwave and every live reward come from world state, which nothing else
  // fetches while this tab is the one on screen.
  onMount(() => {
    ensureDropPools();
    return mountWorldPolling();
  });

  $effect(() => {
    const el = gridEl;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      // Rounded and compared so sub-pixel jitter cannot loop the observer.
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      if (width === box.width && height === box.height) return;
      box = { width, height };
    });
    observer.observe(el);
    return () => observer.disconnect();
  });

  const feed = $derived($suggestionFeed);
  const visible = $derived(filterByCategory(feed.suggestions, $categoryFilter));
  const pageSize = $derived(gridCapacity(box.width, box.height).pageSize);
  const pageCount = $derived(pageCountFor(visible.length, pageSize));
  const current = $derived(clampPage(page, pageCount));
  const shown = $derived(visible.slice(current * pageSize, current * pageSize + pageSize));

  function complete(suggestion: Suggestion, count: number): void {
    if (suggestion.complete) completeTask(suggestion.complete, count);
  }

  /** A narrower filter can strand the reader past the end of the list. */
  function toggle(category: SuggestionCategory): void {
    toggleCategoryFilter(category);
    page = 0;
  }
</script>

<section class="view active">
  <!-- The pager lives above the grid, so nothing the cards do can shift it, and
       both arrows are always drawn so the group never changes size. -->
  <div class="view-header">
    <div class="flex items-center gap-3">
      <h2>{$tr("common.nextUp")}</h2>
      {#if feed.hiddenCount > 0}
        <button
          class="cursor-pointer rounded border border-border bg-bg-surface px-3 py-1 text-sm
                 text-text-secondary transition-[border-color,color] duration-150
                 hover:border-border-strong hover:text-text-primary"
          onclick={restoreAllSuggestions}
          >{$tr("nextUp.restoreHidden", { count: String(feed.hiddenCount) })}</button
        >
      {/if}
    </div>
    <div class="flex items-center gap-3">
      <div class="flex items-center gap-1.5">
        <button
          class={ARROW_CLASS}
          disabled={current === 0}
          title={$tr("nextUp.previous")}
          aria-label={$tr("nextUp.previous")}
          onclick={() => (page = current - 1)}>&lt;</button
        >
        <button
          class={ARROW_CLASS}
          disabled={current >= pageCount - 1}
          title={$tr("nextUp.next")}
          aria-label={$tr("nextUp.next")}
          onclick={() => (page = current + 1)}>&gt;</button
        >
      </div>
      <button
        class="cursor-pointer rounded border border-border bg-bg-surface px-2 py-1 text-base
               leading-none text-text-secondary transition-[border-color,color] duration-150
               hover:border-border-strong hover:text-text-primary"
        title={$tr("nextUp.settings")}
        aria-label={$tr("nextUp.settings")}
        onclick={() => (settingsOpen = true)}>⚙</button
      >
    </div>
  </div>

  <div class="mb-4 flex flex-wrap items-center gap-3">
    {#each SUGGESTION_CATEGORIES as category (category)}
      <label
        class="flex cursor-pointer select-none items-center gap-1.5 text-sm text-text-secondary"
      >
        <input
          type="checkbox"
          checked={$categoryFilter.includes(category)}
          onchange={() => toggle(category)}
        />
        {$tr(FILTER_LABELS[category])}
        <span class="text-text-muted">({feed.counts[category]})</span>
      </label>
    {/each}
  </div>

  <!-- The region is sized by the space left under the filters, never by what it
       holds, so paging cannot move anything above it. -->
  <div class="min-h-0 flex-1 overflow-hidden" bind:this={gridEl}>
    {#if visible.length === 0}
      <div class="empty-state">
        <p>{$tr(feed.hiddenCount > 0 ? "nextUp.emptyDismissed" : "nextUp.empty")}</p>
      </div>
    {:else}
      <div class="flex flex-wrap content-start" style="gap: {CARD_GAP}px">
        {#each shown as suggestion (suggestion.id)}
          <SuggestionCard
            {suggestion}
            onComplete={(count) => complete(suggestion, count)}
            onDismiss={() => dismissSuggestion(suggestion.id, suggestion.fingerprint)}
          />
        {/each}
      </div>
    {/if}
  </div>

  {#if settingsOpen}
    <SuggestionSettingsModal onClose={() => (settingsOpen = false)} />
  {/if}
</section>
