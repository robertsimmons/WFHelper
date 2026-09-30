<script lang="ts">
  import { dropSourcesStore } from "../../lib/dropSourceStore.js";
  import { tr } from "../../lib/i18n.js";
  import { bestUpgradeLine, type UpgradeCard } from "../../lib/suggest/upgrades.js";

  interface Props {
    card: UpgradeCard;
    tone?: string;
  }

  const { card, tone = "" }: Props = $props();

  const places = $derived(dropSourcesStore(card.drops, card.name));
  const line = $derived(bestUpgradeLine(card, $places, $tr));
</script>

{#if line}
  <span class="min-w-0 flex-1 truncate {tone}" title={line.title}>{line.text}</span>
  {#if line.amount}<span class="shrink-0 tabular-nums {tone}">{line.amount}</span>{/if}
{/if}
