<script lang="ts">
  import SortControl from "../../SortControl.svelte";
  import { tr, type MessageKey } from "../../../lib/i18n.js";
  import {
    ACQUISITION_INCLUDES,
    type AcquisitionInclude,
  } from "../../../lib/suggest/acquisition/kinds.js";
  import {
    ACQUISITION_SORTS,
    type AcquisitionSort,
  } from "../../../lib/suggest/acquisition/sort.js";
  import {
    setSuggestionOption,
    suggestionPreferences,
    toggleSuggestionList,
  } from "../../../stores/suggestionPrefs.js";

  const KIND_LABELS: Record<AcquisitionInclude, MessageKey> = {
    warframe: "nextUp.kindWarframe",
    primary: "nextUp.kindPrimary",
    secondary: "nextUp.kindSecondary",
    melee: "nextUp.kindMelee",
    archwing: "nextUp.kindArchwing",
    archgun: "nextUp.kindArchgun",
    archmelee: "nextUp.kindArchmelee",
    companion: "nextUp.kindCompanion",
  };

  const SORT_LABELS: Record<AcquisitionSort, MessageKey> = {
    recommended: "common.recommended",
    difficulty: "nextUp.sortDifficulty",
    tier: "nextUp.sortTier",
    plat: "nextUp.sortPlat",
  };

  const options = $derived($suggestionPreferences.options);

  const sortOptions = $derived(
    ACQUISITION_SORTS.map((key) => [key, $tr(SORT_LABELS[key])] as const),
  );

  function pickSort(value: string): void {
    if ((ACQUISITION_SORTS as readonly string[]).includes(value)) {
      setSuggestionOption("acquisitionSort", value as AcquisitionSort);
    }
  }
</script>

<!-- Eight boxes outgrow the header row. Claiming the free space and wrapping
     inside it keeps the section's collapse button beside the title. -->
<div class="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
  <div class="flex flex-wrap items-center justify-end gap-x-2.5 gap-y-1">
    {#each ACQUISITION_INCLUDES as kind (kind)}
      <label
        class="flex cursor-pointer select-none items-center gap-1 whitespace-nowrap text-xs
               text-text-secondary"
      >
        <input
          type="checkbox"
          data-acquisition-kind={kind}
          checked={options.acquisitionKinds.includes(kind)}
          onchange={() => toggleSuggestionList("acquisitionKinds", ACQUISITION_INCLUDES, kind)}
        />
        {$tr(KIND_LABELS[kind])}
      </label>
    {/each}
  </div>
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
</div>
