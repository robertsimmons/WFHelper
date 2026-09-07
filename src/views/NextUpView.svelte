<script lang="ts">
  import { onMount } from "svelte";

  import SuggestionSection from "../components/nextup/SuggestionSection.svelte";
  import SuggestionSettingsModal from "../components/nextup/SuggestionSettingsModal.svelte";
  import AcquisitionControls from "../components/nextup/controls/AcquisitionControls.svelte";
  import MasteryControls from "../components/nextup/controls/MasteryControls.svelte";
  import RelicsControls from "../components/nextup/controls/RelicsControls.svelte";
  import TasksControls from "../components/nextup/controls/TasksControls.svelte";
  import { tr } from "../lib/i18n.js";
  import { mountWorldPolling } from "../lib/world/useWorldView.js";
  import { ensureDropPools } from "../stores/dropPools.js";
  import {
    collapsedSections,
    suggestionPreferences,
    toggleSectionCollapsed,
  } from "../stores/suggestionPrefs.js";
  import {
    completeTask,
    dismissSuggestion,
    restoreAllSuggestions,
    suggestionFeed,
  } from "../stores/suggestions.js";
  import {
    SUGGESTION_SECTIONS,
    type Suggestion,
    type SuggestionCategory,
    type SuggestionSection as Section,
    type SuggestionSectionId,
    type TaskKind,
  } from "../types/suggest.js";
  import type { Component } from "svelte";

  const CONTROLS: Record<SuggestionSectionId, Component<Record<string, never>>> = {
    tasks: TasksControls,
    relics: RelicsControls,
    acquisition: AcquisitionControls,
    mastery: MasteryControls,
  };

  let settingsOpen = $state(false);

  // Nightwave and every live reward come from world state, which nothing else
  // fetches while this tab is the one on screen.
  onMount(() => {
    ensureDropPools();
    return mountWorldPolling();
  });

  const feed = $derived($suggestionFeed);
  const options = $derived($suggestionPreferences.options);

  function complete(suggestion: Suggestion, count: number): void {
    if (suggestion.complete) completeTask(suggestion.complete, count);
  }

  function shows(category: SuggestionCategory): boolean {
    const picked = options.taskKinds;
    return picked.length === 0 || picked.includes(category as TaskKind);
  }

  /** A section whose controls choose the order keeps the one its provider chose;
   *  the rest rank by score, with a turned-down suggestion banded below the rest
   *  exactly as the engine banded it before the sections were split up. */
  function rank(a: Suggestion, b: Suggestion): number {
    if (a.order != null && b.order != null) return a.order - b.order;
    return (
      Number(a.deprioritized === true) - Number(b.deprioritized === true) ||
      b.score - a.score ||
      a.id.localeCompare(b.id)
    );
  }

  function suggestionsFor(section: Section): Suggestion[] {
    const categories =
      section.id === "tasks" ? section.categories.filter(shows) : section.categories;
    return categories.flatMap((category) => feed.sections[category]).sort(rank);
  }

  const shown = $derived(
    SUGGESTION_SECTIONS.map((section) => ({
      section,
      suggestions: suggestionsFor(section),
    })).filter((row) => row.suggestions.length > 0),
  );
</script>

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

  <div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
    {#if shown.length === 0}
      <div class="empty-state">
        <p>{$tr(feed.hiddenCount > 0 ? "nextUp.emptyDismissed" : "nextUp.empty")}</p>
      </div>
    {:else}
      {#each shown as row (row.section.id)}
        <SuggestionSection
          id={row.section.id}
          title={$tr(row.section.titleKey)}
          suggestions={row.suggestions}
          collapsed={$collapsedSections.includes(row.section.id)}
          onToggle={() => toggleSectionCollapsed(row.section.id)}
          onComplete={complete}
          onDismiss={(suggestion) => dismissSuggestion(suggestion.id, suggestion.fingerprint)}
          controls={CONTROLS[row.section.id]}
        />
      {/each}
    {/if}
  </div>

  {#if settingsOpen}
    <SuggestionSettingsModal onClose={() => (settingsOpen = false)} />
  {/if}
</section>
