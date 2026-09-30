<script lang="ts">
  import { tr } from "../../../lib/i18n.js";
  import { UPGRADE_TEXT, type UpgradeKind } from "../../../lib/suggest/upgrades.js";
  import { setSuggestionOption, suggestionPreferences } from "../../../stores/suggestionPrefs.js";

  interface Props {
    kind: UpgradeKind;
  }

  const { kind }: Props = $props();

  const OPTION = { mods: "modSearch", arcanes: "arcaneSearch" } as const;

  const option = $derived(OPTION[kind]);
  const value = $derived($suggestionPreferences.options[option]);
</script>

<div class="flex min-w-0 flex-auto flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
  <input
    type="search"
    class="mr-auto h-6 w-44 rounded-[var(--radius-sm)] border border-border bg-bg-surface px-2
           text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
    data-upgrade-search={kind}
    placeholder={$tr(UPGRADE_TEXT[kind].searchPlaceholder)}
    {value}
    oninput={(event) => setSuggestionOption(option, event.currentTarget.value)}
  />
</div>
