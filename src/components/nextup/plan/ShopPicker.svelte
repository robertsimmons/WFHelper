<script lang="ts">
  import { formatNumber } from "../../../lib/format.js";
  import { tr } from "../../../lib/i18n.js";
  import { COSMETIC } from "../../../lib/suggest/acquisition/shops/schema.js";
  import type { ResolvedShop } from "../../../lib/suggest/acquisition/shops/picker.js";

  interface Props {
    shop: ResolvedShop;
    onToggle: (unitId: string) => void;
  }

  const { shop, onToggle }: Props = $props();

  type Unit = ResolvedShop["groups"][number]["units"][number];

  const fmt = (value: number): string => formatNumber(value);

  function priceText(unit: Unit): string {
    const entries = Object.entries(unit.price);
    if (unit.either) return $tr("nextUp.pickEither", { amount: fmt(entries[0]?.[1] ?? 0) });
    return entries.map(([currency, amount]) => `${fmt(amount)} ${currency}`).join(" + ");
  }

  const runs = $derived(shop.all.runs ?? 0);
</script>

<div
  class="mt-1 flex flex-col rounded-[var(--radius-md)] border border-border bg-bg-raised px-2.5 py-2"
  data-shop-picker={shop.key}
>
  <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
    <b class="text-text-primary">{shop.vendor}</b>
    <span class="text-text-muted">{shop.place}</span>
    {#if shop.also.length > 0}
      <span
        class="rounded-[var(--radius-sm)] bg-bg-surface px-1.5 text-text-secondary"
        data-shop-also>{$tr("nextUp.pickAlso", { items: shop.also.join(", ") })}</span
      >
    {/if}
  </div>
  <div class="tabular-nums text-text-secondary" data-shop-totals>
    {#each shop.all.totals as line, index (line.currency)}
      <span data-shop-total={line.currency ?? "either"}
        >{index > 0 ? "· " : ""}{line.currency ?? $tr("nextUp.pickPool")}:
        {#if line.balance !== null}{$tr("nextUp.pickHave", { amount: fmt(line.balance) })},
        {/if}{$tr("nextUp.pickNeed", { amount: fmt(line.need) })},
        {#if line.short === null}
          <span class="text-text-muted">{$tr("nextUp.pickUnread")}</span>
        {:else if line.short === 0}
          <span class="text-success">{$tr("nextUp.pickCovered")}</span>
        {:else}
          <span class="text-warning">{$tr("nextUp.pickShort", { amount: fmt(line.short) })}</span>
        {/if}
      </span>
    {/each}
    {#if runs > 0}
      <span class="text-warning">{$tr("nextUp.pickRuns", { runs: String(runs) })}</span>
    {/if}
  </div>

  {#each shop.groups as group (group.item)}
    <span
      class="mt-2 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-text-muted"
      data-shop-group={group.item}
      >{group.item === COSMETIC ? $tr("nextUp.pickCosmetics") : group.item}</span
    >
    {#each group.units as unit (unit.id)}
      {@const held = unit.owned || unit.quest}
      <label
        class="grid cursor-pointer grid-cols-[18px_minmax(0,1fr)_auto] items-baseline gap-2 rounded-[var(--radius-sm)] px-1 hover:bg-bg-surface"
        data-shop-unit={unit.id}
      >
        <input
          type="checkbox"
          checked={held || unit.picked}
          disabled={held}
          onchange={() => onToggle(unit.id)}
        />
        <span class={held ? "text-text-muted line-through" : "text-text-primary"}>{unit.id}</span>
        <span class="tabular-nums {held ? 'text-text-muted' : 'text-text-secondary'}"
          >{unit.owned
            ? $tr("common.owned")
            : unit.quest
              ? $tr("nextUp.pickQuest")
              : priceText(unit)}</span
        >
      </label>
    {/each}
  {/each}
</div>
