<script lang="ts">
  import { formatDropChance } from "../../lib/dropDisplay.js";
  import { tr } from "../../lib/i18n.js";
  import { toMarketSlug } from "../../lib/marketNaming.js";
  import { openOnWfm } from "../../lib/priceLoader.js";
  import { ARCANE_CATALOG, arcaneCopies } from "../../lib/suggest/arcanes.js";
  import { cardFor, type UpgradeCard } from "../../lib/suggest/upgrades.js";
  import type { PackRank } from "../../lib/suggest/vosfor.js";
  import { inventoryData, itemDb } from "../../stores/data.js";
  import { priceCacheRevision } from "../../stores/pricing.js";
  import { toggleUpgradePin, upgradePins } from "../../stores/upgradePins.js";
  import { CHIP_TONE, TONE } from "./chips.js";
  import ItemTile from "./ItemTile.svelte";
  import UpgradeDetailsModal from "./UpgradeDetailsModal.svelte";
  import ModalShell from "../ModalShell.svelte";

  interface Props {
    rank: PackRank;
    /** Only the platinum ranking has a per-pack figure worth a chip. */
    headline: { text: string; title: string } | null;
    onClose: () => void;
  }

  const { rank, headline, onClose }: Props = $props();

  const CHIP = "rounded-[var(--radius-sm)] border border-border px-1.5 py-0.5 text-[0.6875rem]";
  const META = "flex min-w-0 items-center gap-x-2 text-[0.6875rem] leading-tight tabular-nums";

  const arcanePins = upgradePins.arcanes;
  const holdings = $derived(arcaneCopies($inventoryData, $itemDb));
  // The card reads the price cache directly, so a revision has to rebuild it.
  const cards = $derived.by(() => {
    void $priceCacheRevision;
    return new Map(
      rank.rows.map((row) => [row.name, cardFor(ARCANE_CATALOG, row.name, $itemDb, holdings)]),
    );
  });

  let openName = $state<string | null>(null);
  const openCard = $derived(openName === null ? null : (cards.get(openName) ?? null));

  function plat(value: number): string {
    return $tr("nextUp.acqPlatEach", { plat: String(Math.round(value)) });
  }

  // The price is a button of its own and opens the market instead.
  function clickRow(event: MouseEvent, name: string): void {
    if (event.target instanceof Element && event.target.closest("button")) return;
    openName = name;
  }

  function onRowKey(event: KeyboardEvent, name: string): void {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openName = name;
  }

  function togglePin(card: UpgradeCard): (() => void) | undefined {
    return card.owned ? undefined : () => toggleUpgradePin("arcanes", card.name);
  }
</script>

<ModalShell ariaLabel={rank.collection} {onClose}>
  <div class="detail-panel w-[680px] max-w-[95vw] p-4" data-vosfor-pack-details>
    <div class="mb-3 flex items-start justify-between gap-2">
      <span class="flex min-w-0 items-center gap-2 pl-2">
        <h3 class="m-0 truncate font-display text-lg text-text-primary">{rank.collection}</h3>
        {#if rank.top && headline}
          <span
            class="shrink-0 {CHIP} font-semibold tabular-nums {CHIP_TONE.plain}"
            title={headline.title}>{headline.text}</span
          >
        {/if}
      </span>
      <button
        class="btn-secondary btn-sm !px-2"
        aria-label={$tr("common.close")}
        title={$tr("common.close")}
        onclick={onClose}>&times;</button
      >
    </div>

    <div class="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-2">
      {#each rank.rows as row (row.name)}
        {@const slug = row.platinum === null ? null : toMarketSlug(row.name)}
        {@const card = cards.get(row.name)}
        {@const stats = card?.stats ?? []}
        <div
          class="flex min-w-0 cursor-pointer rounded-[var(--radius-md)] hover:bg-bg-hover
                 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          role="button"
          tabindex="0"
          aria-label={$tr("common.openDetailsFor", { name: row.name })}
          data-vosfor-pack-row={row.name}
          onclick={(event) => clickRow(event, row.name)}
          onkeydown={(event) => onRowKey(event, row.name)}
        >
          <ItemTile name={row.name} imageUrl={card?.imageUrl ?? null} stretch>
            <span
              class="min-w-0 truncate text-[0.6875rem] leading-tight {TONE.quiet}"
              title={stats.join("\n")}>{stats.join(" · ") || " "}</span
            >
            <span class={META}>
              <span class="w-12 shrink-0 {TONE.quiet}" title={$tr("nextUp.arcaneCopiesTitle")}
                >{row.held === null
                  ? ""
                  : $tr("nextUp.arcaneCopies", {
                      held: String(row.held),
                      max: String(row.max),
                    })}</span
              >
              <span class="w-12 shrink-0">
                {#if row.platinum !== null && slug}
                  <button
                    class="cursor-pointer tabular-nums {TONE.quiet} hover:text-accent hover:underline"
                    title={$tr("common.openOnWarframeMarket")}
                    onclick={() => openOnWfm(slug)}>{plat(row.platinum)}</button
                  >
                {:else if row.platinum !== null}
                  <span class={TONE.quiet}>{plat(row.platinum)}</span>
                {/if}
              </span>
              <span class="ml-auto {TONE.quiet}" title={$tr("nextUp.vosforChanceTitle")}
                >{formatDropChance(row.chance * 100)}</span
              >
            </span>
          </ItemTile>
        </div>
      {/each}
    </div>
  </div>
</ModalShell>

<!-- A sibling, as this modal is to the Vosfor one, so only the topmost hears Escape. -->
{#if openCard}
  {@const card = openCard}
  <UpgradeDetailsModal
    {card}
    title={card.displayName ?? card.name}
    pinned={$arcanePins.includes(card.name)}
    onTogglePin={togglePin(card)}
    onClose={() => (openName = null)}
  />
{/if}
