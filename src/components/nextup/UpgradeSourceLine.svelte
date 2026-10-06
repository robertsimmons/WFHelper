<script lang="ts">
  import { dropSourcesStore } from "../../lib/dropSourceStore.js";
  import { tr } from "../../lib/i18n.js";
  import { pickedVendorLine } from "../../lib/suggest/upgradeVendorFilters.js";
  import { bestUpgradeLine, type UpgradeCard } from "../../lib/suggest/upgrades.js";
  import { inventoryData } from "../../stores/data.js";

  interface Props {
    card: UpgradeCard;
    tone?: string;
    /** Vendor filter ids the section is narrowed to; the line then names the picked seller. */
    picked?: readonly string[];
  }

  const { card, tone = "", picked = [] }: Props = $props();

  const places = $derived(dropSourcesStore(card.drops, card.name));
  const line = $derived(
    pickedVendorLine(card, picked, $inventoryData, $tr) ?? bestUpgradeLine(card, $places, $tr),
  );
</script>

{#if line}
  <span class="min-w-0 flex-1 truncate {tone}" title={line.title}>{line.text}</span>
  {#if line.amount}<span class="shrink-0 tabular-nums {tone}">{line.amount}</span>{/if}
{/if}
