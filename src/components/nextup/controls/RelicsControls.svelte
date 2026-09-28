<script lang="ts">
  import SortControl from "../../SortControl.svelte";
  import { tr, type MessageKey } from "../../../lib/i18n.js";
  import {
    setSuggestionOption,
    suggestionPreferences,
    toggleSuggestionList,
  } from "../../../stores/suggestionPrefs.js";
  import {
    RELIC_ERAS,
    RELIC_GOALS,
    type RelicEra,
    type RelicGoal,
  } from "../../../types/suggest.js";

  const ERA_LABELS: Record<RelicEra, MessageKey> = {
    Lith: "relics.tier.lith",
    Meso: "relics.tier.meso",
    Neo: "relics.tier.neo",
    Axi: "relics.tier.axi",
    Requiem: "relics.tier.requiem",
  };

  const GOAL_LABELS: Record<RelicGoal, MessageKey> = {
    mr: "nextUp.relicGoalMr",
    platinum: "common.platinum",
    ducats: "common.ducats",
  };

  const options = $derived($suggestionPreferences.options);

  const goalOptions = $derived(RELIC_GOALS.map((key) => [key, $tr(GOAL_LABELS[key])] as const));

  /** The goal is the order: each one ranks its own relics, best first. */
  function pickGoal(value: string): void {
    if (!(RELIC_GOALS as readonly string[]).includes(value)) return;
    setSuggestionOption("relicGoal", value as RelicGoal);
    setSuggestionOption("relicSortDir", "asc");
  }
</script>

<div class="flex min-w-0 flex-auto flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
  <div class="flex flex-wrap items-center justify-end gap-x-2.5 gap-y-1">
    {#each RELIC_ERAS as era (era)}
      <label
        class="flex cursor-pointer select-none items-center gap-1 whitespace-nowrap text-xs
               text-text-secondary"
      >
        <input
          type="checkbox"
          data-relic-era={era}
          checked={options.relicEras.includes(era)}
          onchange={() => toggleSuggestionList("relicEras", RELIC_ERAS, era)}
        />
        {$tr(ERA_LABELS[era])}
      </label>
    {/each}
  </div>
  <SortControl
    value={options.relicGoal}
    options={goalOptions}
    direction={options.relicSortDir}
    onSelect={pickGoal}
    onToggleDirection={() =>
      setSuggestionOption("relicSortDir", options.relicSortDir === "asc" ? "desc" : "asc")}
  />
</div>
