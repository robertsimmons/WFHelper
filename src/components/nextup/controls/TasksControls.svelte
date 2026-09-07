<script lang="ts">
  import { tr, type MessageKey } from "../../../lib/i18n.js";
  import { suggestionPreferences, toggleSuggestionList } from "../../../stores/suggestionPrefs.js";
  import { TASK_KINDS, type TaskKind } from "../../../types/suggest.js";

  const LABELS: Record<TaskKind, MessageKey> = {
    daily: "dailies.groupDaily",
    weekly: "dailies.groupWeekly",
    vendor: "dailies.groupVendors",
    nightwave: "dailies.groupNightwave",
  };

  const picked = $derived($suggestionPreferences.options.taskKinds);
</script>

<div class="flex flex-wrap items-center gap-2.5">
  {#each TASK_KINDS as kind (kind)}
    <label class="flex cursor-pointer select-none items-center gap-1 text-xs text-text-secondary">
      <input
        type="checkbox"
        data-task-kind={kind}
        checked={picked.includes(kind)}
        onchange={() => toggleSuggestionList("taskKinds", TASK_KINDS, kind)}
      />
      {$tr(LABELS[kind])}
    </label>
  {/each}
</div>
