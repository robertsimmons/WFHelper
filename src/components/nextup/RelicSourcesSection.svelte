<script lang="ts">
  import { untrack } from "svelte";
  import { SvelteMap } from "svelte/reactivity";

  import { formatNumber } from "../../lib/format.js";
  import { tr } from "../../lib/i18n.js";
  import { loadItemPriceBySlug, openOnWfm } from "../../lib/priceLoader.js";
  import { relicGroupSlug } from "../../lib/relic/relicPriceCache.js";
  import {
    neededRelics,
    type AabcRound,
    type NeededRelic,
    type RankedSource,
    type RelicVendor,
  } from "../../lib/suggest/acquisition/relicSources.js";
  import { relicArt } from "../../lib/suggest/relicPacks.js";
  import { relicDb } from "../../stores/relics.js";
  import { suggestionPreferences } from "../../stores/suggestionPrefs.js";
  import { worldData } from "../../stores/world.js";
  import { CHIP_TONE, TONE, cardClock, missionChipTone } from "./chips.js";
  import ItemTile from "./ItemTile.svelte";
  import type { MessageKey } from "../../lib/i18n.js";
  import type { PartState } from "../../lib/suggest/acquisition/types.js";

  interface Props {
    missing: readonly PartState[];
  }

  const { missing }: Props = $props();

  const LABEL = "text-xs font-semibold uppercase tracking-[0.08em] text-text-muted";
  const CHIP = "rounded-[var(--radius-sm)] border px-1 py-0.5 leading-none";
  const SOURCE_GRID = "grid min-w-0 grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-2";
  /** The best few lead; the rest stay one click away, never dropped. */
  const SOURCE_LIMIT = 4;

  const ROUND_LABEL: Record<AabcRound, MessageKey> = {
    A: "nextUp.relicRoundA",
    B: "nextUp.relicRoundB",
    C: "nextUp.relicRoundC",
  };

  const relics = $derived(
    $relicDb
      ? neededRelics(missing, $relicDb, $suggestionPreferences, $worldData, $cardClock)
      : null,
  );

  /** Undefined is still loading; a null plat is a listing with no recent trades. */
  const prices = new SvelteMap<string, { plat: number | null; slug: string } | undefined>();

  $effect(() => {
    for (const relic of relics ?? []) {
      const key = relic.group.key;
      untrack(() => {
        if (prices.has(key)) return;
        prices.set(key, undefined);
        const slug = relicGroupSlug(key);
        void loadItemPriceBySlug(slug).then((state) => {
          const plat = state?.messageParams?.["plat"];
          prices.set(key, {
            plat: typeof plat === "number" ? plat : null,
            slug: state?.slug ?? slug,
          });
        });
      });
    }
  });

  /** A rare drop needs its decimals; a common one does not. */
  function chanceText(chance: number): string {
    if (chance >= 10) return chance.toFixed(0);
    return chance.toFixed(2).replace(/\.?0+$/, "") || chance.toPrecision(1);
  }

  function kindLabel(source: RankedSource): string | null {
    if (source.kind === "bounty") return $tr("nextUp.acqKindBounty");
    if (source.kind === "quest") return $tr("common.quest");
    if (source.kind === "caches") return $tr("nextUp.relicSourceCaches");
    return null;
  }

  function typeLabel(source: RankedSource): string | null {
    if (source.missionType) return source.missionType;
    return source.kind === "mission" ? $tr("nextUp.relicSourceTypeUnknown") : null;
  }

  function rotationLabel(source: RankedSource): string | null {
    if (source.round) return $tr(ROUND_LABEL[source.round]);
    return source.rotation ? $tr("dropSources.rotation", { rotation: source.rotation }) : null;
  }

  function vendorChip(vendor: RelicVendor): string {
    // Trader names read the same in every language.
    if (vendor.trader === "varzia") {
      const aya =
        vendor.aya === null ? "?" : $tr("nextUp.relicPackAya", { count: String(vendor.aya) });
      return `Varzia ${aya}`;
    }
    const parts = [$tr("world.baroKiteer")];
    if (vendor.ducats) {
      parts.push($tr("world.baro.ducatsShort", { count: formatNumber(vendor.ducats) }));
    }
    if (vendor.credits) {
      parts.push($tr("world.baro.creditsShort", { amount: formatNumber(vendor.credits) }));
    }
    return parts.join(" ");
  }

  function shopChips(relic: NeededRelic): string[] {
    const chips = (relic.vendors ?? []).map(vendorChip);
    if (relic.pack) {
      chips.push($tr("nextUp.relicPackSyndicate"), $tr("nextUp.relicPackSteel"));
    }
    return chips;
  }
</script>

{#snippet sourceTile(source: RankedSource)}
  {@const kind = kindLabel(source)}
  {@const type = typeLabel(source)}
  {@const rotation = rotationLabel(source)}
  <ItemTile name={source.place} showArt={false} stretch>
    {#snippet actions()}
      {#if kind}<span class="{CHIP} {CHIP_TONE.plain}">{kind}</span>{/if}
      {#if type}<span
          class="{CHIP} {source.opinion ? '' : 'border-border'} {missionChipTone(source.opinion)}"
          >{type}</span
        >{/if}
      {#if rotation}<span class="{CHIP} {CHIP_TONE.plain}">{rotation}</span>{/if}
      {#if source.stage}<span class="{CHIP} {CHIP_TONE.plain}">{source.stage}</span>{/if}
      {#if source.refinement}<span class="{CHIP} {CHIP_TONE.plain}">{source.refinement}</span>{/if}
      <span
        class="ml-auto shrink-0 pl-2 tabular-nums {TONE.quiet}"
        title={$tr("nextUp.detailsChance")}>{chanceText(source.chance)}%</span
      >
    {/snippet}
  </ItemTile>
{/snippet}

{#snippet priceButton(key: string)}
  {@const price = prices.get(key)}
  {#if price}
    <button
      type="button"
      class="ml-auto shrink-0 cursor-pointer pl-2 tabular-nums underline underline-offset-2
             transition-colors duration-150 hover:text-accent {TONE.quiet}"
      title={$tr("common.openOnWarframeMarket")}
      onclick={() => openOnWfm(price.slug)}
      >{price.plat === null
        ? $tr("analysis.noPrice")
        : $tr("nextUp.acqPlatEach", { plat: String(Math.round(price.plat)) })}</button
    >
  {:else}
    <span class="ml-auto shrink-0 pl-2 {TONE.plain}">-</span>
  {/if}
{/snippet}

{#if relics === null}
  <div class="flex flex-col gap-1">
    <span class={LABEL}>{$tr("nextUp.relicSourcesHeading")}</span>
    <span class="{CHIP} w-fit text-[0.6875rem] {CHIP_TONE.plain}"
      >{$tr("nextUp.relicSourcesUnknown")}</span
    >
  </div>
{:else if relics.length > 0}
  <div class="flex flex-col gap-2" data-relic-sources>
    <span class={LABEL}>{$tr("nextUp.relicSourcesHeading")}</span>
    {#each relics as relic (relic.group.key)}
      {@const shop = shopChips(relic)}
      {@const sources = relic.sources ?? []}
      <div class="flex min-w-0 items-start gap-2" data-relic-sources-row={relic.group.name}>
        <span class="w-56 shrink-0">
          <ItemTile name={relic.group.name} imageUrl={relicArt(relic.group)} stretch>
            {#snippet actions()}
              {@render priceButton(relic.group.key)}
            {/snippet}
            <span
              class="truncate text-[0.6875rem] text-text-secondary"
              title={relic.parts.join(", ")}>{relic.parts.join(", ")}</span
            >
            {#if shop.length > 0 || relic.vendors === null}
              <span class="flex flex-wrap gap-1 text-[0.6875rem]">
                {#each shop as chip (chip)}
                  <span class="{CHIP} {CHIP_TONE.good}">{chip}</span>
                {/each}
                {#if relic.vendors === null}
                  <span class="{CHIP} {CHIP_TONE.plain}">{$tr("nextUp.relicVendorsUnknown")}</span>
                {/if}
              </span>
            {/if}
          </ItemTile>
        </span>
        <div class="flex min-w-0 flex-1 flex-col gap-1.5">
          {#if relic.sources === null}
            <span class="{CHIP} w-fit text-[0.6875rem] {CHIP_TONE.plain}"
              >{$tr("nextUp.relicSourcesUnknown")}</span
            >
          {:else if sources.length === 0}
            <span class="{CHIP} w-fit text-[0.6875rem] {CHIP_TONE.warn}"
              >{$tr("common.vaulted")}</span
            >
          {:else}
            <div class={SOURCE_GRID}>
              {#each sources.slice(0, SOURCE_LIMIT) as source, index (index)}
                {@render sourceTile(source)}
              {/each}
            </div>
            {#if sources.length > SOURCE_LIMIT}
              <details>
                <summary class="{LABEL} cursor-pointer list-none [&::-webkit-details-marker]:hidden"
                  ><span class="mr-[7px] font-bold text-accent" aria-hidden="true">&rsaquo;</span
                  >{$tr("nextUp.modDropsMore", {
                    count: String(sources.length - SOURCE_LIMIT),
                  })}</summary
                >
                <div class="{SOURCE_GRID} mt-1.5">
                  {#each sources.slice(SOURCE_LIMIT) as source, index (index)}
                    {@render sourceTile(source)}
                  {/each}
                </div>
              </details>
            {/if}
          {/if}
        </div>
      </div>
    {/each}
  </div>
{/if}
