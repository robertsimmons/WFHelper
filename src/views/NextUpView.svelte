<script lang="ts">
  import SuggestionCard from "../components/nextup/SuggestionCard.svelte";
  import { tr, type MessageKey } from "../lib/i18n.js";
  import { currentView } from "../stores/app.js";
  import {
    completeTask,
    dismissCategory,
    dismissSuggestion,
    restoreAllSuggestions,
    suggestionFeed,
  } from "../stores/suggestions.js";
  import type { Suggestion, SuggestionCategory } from "../types/suggest.js";

  const GROUP_LABELS: Record<SuggestionCategory, MessageKey> = {
    daily: "dailies.groupDaily",
    weekly: "dailies.groupWeekly",
    nightwave: "dailies.groupNightwave",
  };

  /** Enough to choose between without turning the page into another checklist. */
  const COLLAPSED_LIMIT = 5;

  let expanded = $state<Record<string, boolean>>({});

  const feed = $derived($suggestionFeed);

  function shown(category: SuggestionCategory, suggestions: Suggestion[]): Suggestion[] {
    return expanded[category] ? suggestions : suggestions.slice(0, COLLAPSED_LIMIT);
  }

  function toggleExpanded(category: SuggestionCategory): void {
    expanded = { ...expanded, [category]: !expanded[category] };
  }

  function complete(suggestion: Suggestion, count: number): void {
    if (suggestion.complete) completeTask(suggestion.complete, count);
  }

  function follow(suggestion: Suggestion): void {
    if (suggestion.link) currentView.set(suggestion.link.view);
  }
</script>

<section class="view active">
  <div class="view-header">
    <h2>{$tr("common.nextUp")}</h2>
    <div class="flex items-center gap-3">
      {#if feed.hiddenCount > 0}
        <span class="text-sm text-text-muted"
          >{$tr("nextUp.hiddenCount", { count: String(feed.hiddenCount) })}</span
        >
        <button
          class="cursor-pointer rounded border border-border bg-bg-soft px-3 py-1 text-sm
                 text-text-secondary transition-[border-color,color] duration-150
                 hover:border-border-strong hover:text-text-primary"
          onclick={restoreAllSuggestions}>{$tr("nextUp.showAll")}</button
        >
      {/if}
    </div>
  </div>

  <p class="mb-4 mt-0 text-sm text-text-muted">{$tr("nextUp.subtitle")}</p>

  {#if feed.groups.length === 0}
    <div class="empty-state">
      <p>{$tr(feed.hiddenCount > 0 ? "nextUp.emptyDismissed" : "nextUp.empty")}</p>
    </div>
  {:else}
    <div class="flex flex-col gap-6">
      {#each feed.groups as group (group.category)}
        <div class="flex flex-col gap-2">
          <header class="flex items-center justify-between gap-3">
            <h3 class="m-0 font-display text-lg font-medium text-text-primary">
              {$tr(GROUP_LABELS[group.category])}
            </h3>
            <button
              class="cursor-pointer rounded border-0 bg-transparent px-1 py-1 text-sm
                     text-text-muted transition-colors duration-150 hover:text-text-secondary"
              onclick={() => dismissCategory(group.category, group.fingerprint)}
              >{$tr("nextUp.notNow")}</button
            >
          </header>

          <div class="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {#each shown(group.category, group.suggestions) as suggestion (suggestion.id)}
              <SuggestionCard
                {suggestion}
                onComplete={(count) => complete(suggestion, count)}
                onDismiss={() => dismissSuggestion(suggestion.id, suggestion.fingerprint)}
                onLink={() => follow(suggestion)}
              />
            {/each}
          </div>

          {#if group.suggestions.length > COLLAPSED_LIMIT}
            <button
              class="cursor-pointer self-start rounded border-0 bg-transparent px-1 py-1 text-sm
                     text-text-muted transition-colors duration-150 hover:text-text-secondary"
              onclick={() => toggleExpanded(group.category)}
            >
              {expanded[group.category]
                ? $tr("nextUp.showFewer")
                : $tr("nextUp.showMore", {
                    count: String(group.suggestions.length - COLLAPSED_LIMIT),
                  })}
            </button>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</section>
