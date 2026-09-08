<script lang="ts">
  import SortControl from "../../SortControl.svelte";
  import { defaultSortDirection } from "../../../lib/filters.js";
  import { tr, type MessageKey } from "../../../lib/i18n.js";
  import {
    setSuggestionOption,
    suggestionPreferences,
    toggleSuggestionList,
  } from "../../../stores/suggestionPrefs.js";
  import {
    RELIC_ERAS,
    RELIC_SORTS,
    type RelicEra,
    type RelicSort,
  } from "../../../types/suggest.js";

  const ERA_LABELS: Record<RelicEra, MessageKey> = {
    Lith: "relics.tier.lith",
    Meso: "relics.tier.meso",
    Neo: "relics.tier.neo",
    Axi: "relics.tier.axi",
    Requiem: "relics.tier.requiem",
  };

  const SORT_LABELS: Record<RelicSort, MessageKey> = {
    recommended: "common.recommended",
    platinum: "common.platinum",
    ducats: "common.ducats",
  };

  const options = $derived($suggestionPreferences.options);

  const sortOptions = $derived(RELIC_SORTS.map((key) => [key, $tr(SORT_LABELS[key])] as const));

  /** Sorting by a payout is also picking it: the goal decides which relics get
   *  offered at all, so the two can never disagree. */
  function pickSort(value: string): void {
    if (!(RELIC_SORTS as readonly string[]).includes(value)) return;
    setSuggestionOption("relicSort", value as RelicSort);
    // A payout reads best-first, a recommendation reads top-first; the shared
    // table owns which way each key leans so the arrow never contradicts itself.
    setSuggestionOption("relicSortDir", defaultSortDirection(value));
    if (value === "platinum" || value === "ducats") setSuggestionOption("relicGoal", value);
  }
</script>

<div class="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
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
    value={options.relicSort}
    options={sortOptions}
    direction={options.relicSortDir}
    onSelect={pickSort}
    onToggleDirection={() =>
      setSuggestionOption("relicSortDir", options.relicSortDir === "asc" ? "desc" : "asc")}
  />
</div>
