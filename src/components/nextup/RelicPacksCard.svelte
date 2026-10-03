<script lang="ts">
  import { tr } from "../../lib/i18n.js";
  import { CARD_HEIGHT } from "../../lib/suggest/grid.js";
  import { compactCount } from "../../lib/suggest/ownedRewards.js";
  import {
    AYA_WIKI,
    RELIC_PACKS_WIKI,
    STEEL_PACK_COST,
    SYNDICATE_PACK_COST,
    partArt,
    relicArt,
    relicPacksSummary,
    type RelicPart,
    type RelicPayout,
  } from "../../lib/suggest/relicPacks.js";
  import { inventoryData, itemDb } from "../../stores/data.js";
  import { masteryData } from "../../stores/mastery.js";
  import { relicDb } from "../../stores/relics.js";
  import { worldData } from "../../stores/world.js";
  import { TILE_MICRO, TONE, cardClock, timeLeftText } from "./chips.js";
  import ItemTile from "./ItemTile.svelte";
  import RelicPayoutModal from "./RelicPayoutModal.svelte";

  const PACK_RELICS = 3;
  const LINE =
    "flex h-5 w-full min-w-0 cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-1 " +
    "text-left text-xs leading-4 tabular-nums hover:bg-bg-hover";
  const LABEL = `w-14 shrink-0 ${TILE_MICRO} ${TONE.plain}`;
  /** Wide enough that a pair's names still read; a narrow card shows one pair. */
  const PAIR_MIN = 220;
  const TILE_ROW = 50;

  type Open = "steel" | "syndicate" | "aya" | null;

  const title = $derived($tr("nextUp.relicPacksTitle"));
  const summary = $derived(
    relicPacksSummary({
      inventory: $inventoryData,
      itemDb: $itemDb,
      mastery: $masteryData,
      relicDb: $relicDb,
      world: $worldData,
      nowMs: $cardClock,
    }),
  );

  const syndicateAffords = $derived((summary.syndicate?.standing ?? 0) >= SYNDICATE_PACK_COST);
  const steelShort = $derived((summary.steelEssence ?? 0) < STEEL_PACK_COST);
  const varziaLeft = $derived(timeLeftText(summary.varziaExpiry, $cardClock));

  const parts = $derived(
    summary.poolParts === null
      ? ""
      : $tr(summary.poolParts === 1 ? "nextUp.relicPackPartOne" : "nextUp.relicPackParts", {
          count: String(summary.poolParts),
        }),
  );
  const held = (count: number | null): string =>
    count === null ? "" : $tr("nextUp.relicPackHeld", { count: count.toLocaleString() });
  const steelCost = $derived($tr("nextUp.relicPackSteelCost", { count: String(STEEL_PACK_COST) }));
  const standingCost = compactCount(SYNDICATE_PACK_COST);
  const costTitle = $derived($tr("nextUp.relicPackCostTitle", { count: String(PACK_RELICS) }));
  const syndicateText = $derived(
    summary.syndicate
      ? `${summary.syndicate.name} ${compactCount(Math.max(0, summary.syndicate.standing))}`
      : $tr("nextUp.relicPackNoSyndicate"),
  );

  let open = $state<Open>(null);

  /** The part the relic is bought for: parts are ordered needed-first. */
  function headline(row: RelicPayout): RelicPart | null {
    const first = row.parts[0];
    return first?.status === "needed" ? first : null;
  }

  function onAyaKey(event: KeyboardEvent): void {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    open = "aya";
  }
</script>

<div
  class="flex w-full flex-col gap-1 overflow-hidden rounded-[var(--radius-lg)] border border-border
         bg-bg-raised p-2"
  style="height: {CARD_HEIGHT}px"
  data-suggestion-card="relic-packs"
>
  <!-- No pin and no dismiss, but their slots stay so the title lines up. -->
  <div class="grid h-6 shrink-0 grid-cols-[minmax(0,1fr)_1.5rem_1.5rem] items-center gap-x-3">
    <h3 class="m-0 min-w-0 truncate font-display text-sm font-medium leading-5 text-text-primary">
      {title}
    </h3>
    <span class="h-6 w-6"></span>
    <span class="h-6 w-6"></span>
  </div>

  <button
    class={LINE}
    title={$tr("nextUp.relicPackSteel")}
    data-relic-pack="steel"
    onclick={() => (open = "steel")}
  >
    <span class={LABEL}>{$tr("nextUp.relicPackSteelShort")}</span>
    <span class="shrink-0 text-text-primary" title={costTitle}>{steelCost}</span>
    <span class="min-w-0 truncate {steelShort ? TONE.plain : TONE.quiet}"
      >{held(summary.steelEssence)}</span
    >
    <span class="ml-auto shrink-0 {TONE.quiet}" title={$tr("nextUp.relicPackPartsTitle")}
      >{parts}</span
    >
  </button>

  <button
    class="{LINE} {$inventoryData && !syndicateAffords ? 'opacity-45' : ''}"
    title={$tr("nextUp.relicPackSyndicate")}
    data-relic-pack="syndicate"
    onclick={() => (open = "syndicate")}
  >
    <span class={LABEL}>{$tr("nextUp.relicPackSyndicateShort")}</span>
    <span class="shrink-0 text-text-primary" title={costTitle}>{standingCost}</span>
    <span class="min-w-0 truncate {TONE.quiet}" title={$tr("nextUp.relicPackStandingTitle")}
      >{summary.syndicate || $inventoryData ? syndicateText : ""}</span
    >
    <span class="ml-auto shrink-0 {TONE.quiet}" title={$tr("nextUp.relicPackPartsTitle")}
      >{parts}</span
    >
  </button>

  <div
    class="flex min-h-0 flex-1 cursor-pointer flex-col gap-1 rounded-[var(--radius-sm)]
           hover:bg-bg-hover focus-visible:outline focus-visible:outline-2
           focus-visible:outline-accent"
    role="button"
    tabindex="0"
    aria-label={$tr("common.openDetailsFor", { name: "Aya" })}
    data-relic-pack="aya"
    onclick={() => (open = "aya")}
    onkeydown={onAyaKey}
  >
    <span class="{LINE} hover:bg-transparent">
      <span class={LABEL}>{$tr("nextUp.relicPackAyaLabel")}</span>
      <span class="min-w-0 truncate text-text-primary">{held(summary.aya)}</span>
      <span class="ml-auto shrink-0 {TONE.quiet}" title={$tr("nextUp.relicPackVarziaTitle")}
        >{varziaLeft ?? $tr("nextUp.relicPackVarziaAway")}</span
      >
    </span>
    {#if varziaLeft && summary.ayaPicks.length > 0}
      <div
        class="grid gap-x-2 overflow-hidden"
        style="grid-template-columns: repeat(auto-fill, minmax(min({PAIR_MIN}px, 100%), 1fr));
               grid-auto-rows: {TILE_ROW}px; height: {TILE_ROW}px"
        data-aya-picks
      >
        {#each summary.ayaPicks as pick (pick.key)}
          {@const part = headline(pick)}
          <div class="flex min-w-0 items-center gap-1">
            <span class="min-w-0 flex-1">
              <ItemTile name={pick.name} imageUrl={relicArt(pick)} stretch />
            </span>
            <span class="shrink-0 {TONE.plain}" aria-hidden="true">→</span>
            {#if part}
              <span class="min-w-0 flex-[1.4]">
                <ItemTile
                  name={part.name}
                  imageUrl={partArt($itemDb, part)}
                  rarity={part.rarity}
                  stretch
                />
              </span>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

{#if open === "steel" || open === "syndicate"}
  <RelicPayoutModal
    title={$tr(open === "steel" ? "nextUp.relicPackSteel" : "nextUp.relicPackSyndicate")}
    facts={open === "steel"
      ? [
          { text: steelCost, title: costTitle },
          ...(summary.steelEssence === null
            ? []
            : [{ text: held(summary.steelEssence), title: $tr("stats.resource.steelEssence") }]),
        ]
      : [
          { text: standingCost, title: costTitle },
          ...(summary.syndicate
            ? [
                {
                  text: syndicateText,
                  title: $tr("nextUp.relicPackStandingTitle"),
                  dim: !syndicateAffords,
                },
              ]
            : []),
        ]}
    rows={summary.pool}
    wikiUrl={RELIC_PACKS_WIKI}
    onClose={() => (open = null)}
  />
{:else if open === "aya"}
  <RelicPayoutModal
    title={$tr("nextUp.relicPackAyaLabel")}
    facts={[
      ...(summary.aya === null ? [] : [{ text: held(summary.aya), title: "Aya" }]),
      ...(varziaLeft
        ? [
            {
              text: $tr("nextUp.relicPackVarziaLeft", { time: varziaLeft }),
              title: $tr("nextUp.relicPackVarziaTitle"),
            },
          ]
        : []),
    ]}
    rows={summary.varzia}
    allParts
    wikiUrl={AYA_WIKI}
    onClose={() => (open = null)}
  />
{/if}
