<script lang="ts">
  import { tr, type MessageKey } from "../../../lib/i18n.js";
  import { suggestionPreferences, toggleSuggestionList } from "../../../stores/suggestionPrefs.js";
  import { MASTERY_KINDS, type MasteryKind } from "../../../types/suggest.js";

  const LABELS: Record<MasteryKind, MessageKey> = {
    frame: "nextUp.masteryKindFrame",
    weapon: "nextUp.masteryKindWeapon",
    forma: "nextUp.masteryKindForma",
  };

  const picked = $derived($suggestionPreferences.options.masteryKinds);
</script>

<div class="flex flex-wrap items-center gap-2.5">
  {#each MASTERY_KINDS as kind (kind)}
    <label class="flex cursor-pointer select-none items-center gap-1 text-xs text-text-secondary">
      <input
        type="checkbox"
        data-mastery-kind={kind}
        checked={picked.includes(kind)}
        onchange={() => toggleSuggestionList("masteryKinds", MASTERY_KINDS, kind)}
      />
      {$tr(LABELS[kind])}
    </label>
  {/each}
</div>
