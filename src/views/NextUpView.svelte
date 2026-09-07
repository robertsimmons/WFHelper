<script lang="ts">
  import { onMount } from "svelte";

  import SortControl from "../components/SortControl.svelte";
  import SuggestionSection from "../components/nextup/SuggestionSection.svelte";
  import SuggestionSettingsModal from "../components/nextup/SuggestionSettingsModal.svelte";
  import { tr, type MessageKey } from "../lib/i18n.js";
  import { ACQUISITION_SORTS, type AcquisitionSort } from "../lib/suggest/acquisition/sort.js";
  import { sortAcquisitionSuggestions } from "../lib/suggest/providers/acquisition.js";
  import { mountWorldPolling } from "../lib/world/useWorldView.js";
  import { ensureDropPools } from "../stores/dropPools.js";
  import {
    collapsedSections,
    setSuggestionOption,
    suggestionPreferences,
    toggleSectionCollapsed,
  } from "../stores/suggestionPrefs.js";
  import {
    categoryFilter,
    completeTask,
    dismissSuggestion,
    restoreAllSuggestions,
    suggestionFeed,
    toggleCategoryFilter,
  } from "../stores/suggestions.js";
  import {
    SUGGESTION_SECTIONS,
    type Suggestion,
    type SuggestionSection as Section,
  } from "../types/suggest.js";

  const SORT_LABELS: Record<AcquisitionSort, MessageKey> = {
    recommended: "nextUp.sortRecommended",
    difficulty: "nextUp.sortDifficulty",
    tier: "nextUp.sortTier",
    plat: "nextUp.sortPlat",
  };

  let settingsOpen = $state(false);

  // Nightwave and every live reward come from world state, which nothing else
  // fetches while this tab is the one on screen.
  onMount(() => {
    ensureDropPools();
    return mountWorldPolling();
  });

  const feed = $derived($suggestionFeed);
  const shown = $derived(
    SUGGESTION_SECTIONS.filter(
      (section) =>
        $categoryFilter.includes(section.category) && feed.sections[section.category].length > 0,
    ),
  );

  const options = $derived($suggestionPreferences.options);

  const sortOptions = $derived(
    ACQUISITION_SORTS.map((key) => [key, $tr(SORT_LABELS[key])] as const),
  );

  function complete(suggestion: Suggestion, count: number): void {
    if (suggestion.complete) completeTask(suggestion.complete, count);
  }

  function suggestionsFor(section: Section): Suggestion[] {
    const list = feed.sections[section.category];
    return section.category === "acquisition"
      ? sortAcquisitionSuggestions(list, options.acquisitionSort, options.acquisitionSortDir)
      : list;
  }

  function pickSort(value: string): void {
    if ((ACQUISITION_SORTS as readonly string[]).includes(value)) {
      setSuggestionOption("acquisitionSort", value as AcquisitionSort);
    }
  }
</script>

{#snippet acquisitionControls()}
  <SortControl
    value={options.acquisitionSort}
    options={sortOptions}
    direction={options.acquisitionSortDir}
    onSelect={pickSort}
    onToggleDirection={() =>
      setSuggestionOption(
        "acquisitionSortDir",
        options.acquisitionSortDir === "asc" ? "desc" : "asc",
      )}
  />
{/snippet}

<section class="view active">
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
    <button
      class="cursor-pointer rounded border border-border bg-bg-surface px-2 py-1 text-base
             leading-none text-text-secondary transition-[border-color,color] duration-150
             hover:border-border-strong hover:text-text-primary"
      title={$tr("nextUp.settings")}
      aria-label={$tr("nextUp.settings")}
      onclick={() => (settingsOpen = true)}>⚙</button
    >
  </div>

  <div class="mb-4 flex flex-wrap items-center gap-3">
    {#each SUGGESTION_SECTIONS as section (section.category)}
      <label
        class="flex cursor-pointer select-none items-center gap-1.5 text-sm text-text-secondary"
      >
        <input
          type="checkbox"
          checked={$categoryFilter.includes(section.category)}
          onchange={() => toggleCategoryFilter(section.category)}
        />
        {$tr(section.titleKey)}
        <span class="text-text-muted">({feed.sections[section.category].length})</span>
      </label>
    {/each}
  </div>

  <div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
    {#if shown.length === 0}
      <div class="empty-state">
        <p>{$tr(feed.hiddenCount > 0 ? "nextUp.emptyDismissed" : "nextUp.empty")}</p>
      </div>
    {:else}
      {#each shown as section (section.category)}
        <SuggestionSection
          title={$tr(section.titleKey)}
          suggestions={suggestionsFor(section)}
          collapsed={$collapsedSections.includes(section.category)}
          onToggle={() => toggleSectionCollapsed(section.category)}
          onComplete={complete}
          onDismiss={(suggestion) => dismissSuggestion(suggestion.id, suggestion.fingerprint)}
          controls={section.category === "acquisition" ? acquisitionControls : undefined}
        />
      {/each}
    {/if}
  </div>

  {#if settingsOpen}
    <SuggestionSettingsModal onClose={() => (settingsOpen = false)} />
  {/if}
</section>
