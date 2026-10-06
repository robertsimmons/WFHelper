<script lang="ts">
  import { tr, type MessageKey } from "../../../lib/i18n.js";
  import { SCAN_CATEGORIES, type ScanCategory } from "../../../lib/suggest/scannables.js";
  import { setSuggestionOption, suggestionPreferences } from "../../../stores/suggestionPrefs.js";

  const LABELS: Record<ScanCategory, MessageKey> = {
    simulacrum: "nextUp.scanCategorySimulacrum",
    objects: "nextUp.scanCategoryObjects",
    somachords: "nextUp.scanCategorySomachords",
    fragments: "nextUp.scanCategoryFragments",
    frameFighter: "nextUp.scanCategoryFrameFighter",
  };

  const BUTTON =
    "flex h-6 cursor-pointer items-center gap-1 rounded-[var(--radius-sm)] border px-2 " +
    "font-display text-[0.6875rem] font-semibold leading-none transition-colors duration-150";
  const BUTTON_ON = "border-accent bg-bg-surface text-accent";
  const BUTTON_OFF = "border-border bg-bg-surface text-text-muted hover:border-border-strong";

  const picked = $derived($suggestionPreferences.options.scanCategory);
</script>

<div class="flex min-w-0 flex-auto flex-wrap items-center justify-end gap-x-1.5 gap-y-1">
  {#each SCAN_CATEGORIES as category (category)}
    <button
      type="button"
      class="{BUTTON} {picked === category ? BUTTON_ON : BUTTON_OFF}"
      data-scan-category={category}
      aria-pressed={picked === category}
      onclick={() => setSuggestionOption("scanCategory", category)}
    >
      {$tr(LABELS[category])}
    </button>
  {/each}
</div>
