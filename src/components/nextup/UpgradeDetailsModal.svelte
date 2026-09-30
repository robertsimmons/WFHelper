<script lang="ts">
  import { tr } from "../../lib/i18n.js";
  import { openOnWfm } from "../../lib/priceLoader.js";
  import { dropSourcesStore } from "../../lib/dropSourceStore.js";
  import {
    UPGRADE_TEXT,
    upgradeCopiesText,
    upgradeCountText,
    upgradeSources,
    type UpgradeCard,
  } from "../../lib/suggest/upgrades.js";
  import { CHIP_TONE } from "./chips.js";
  import UpgradeVendorTile from "./UpgradeVendorTile.svelte";
  import DropSourceTile from "../DropSourceTile.svelte";
  import ItemImage from "../ItemImage.svelte";
  import ModalShell from "../ModalShell.svelte";
  import WikiButton from "../WikiButton.svelte";

  interface Props {
    card: UpgradeCard;
    title: string;
    pinned: boolean;
    onTogglePin?: (() => void) | undefined;
    onClose: () => void;
  }

  const { card, title, pinned, onTogglePin, onClose }: Props = $props();

  const CHIP = "rounded-[var(--radius-sm)] border border-border px-1.5 py-0.5 text-[0.6875rem]";
  /** The detail modal's own track floor, so a drop tile reads its full place name. */
  const TILE_GRID = "grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-2";
  /** Enough to answer where to farm it; the rest wait behind the disclosure. */
  const DROP_PREVIEW = 4;

  interface Fact {
    value: string;
    title: string;
    marketSlug?: string | null;
    tone: string;
  }

  function capitalized(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  const facts = $derived.by((): Fact[] => {
    const out: Fact[] = [];
    const plain = CHIP_TONE.plain;
    if (card.slot) out.push({ value: card.slot, title: $tr("nextUp.modFactSlot"), tone: plain });
    if (card.polarity) {
      out.push({
        value: capitalized(card.polarity),
        title: $tr("marketAlerts.polarity"),
        tone: plain,
      });
    }
    if (card.rarity) {
      out.push({ value: card.rarity, title: $tr("nextUp.modFactRarity"), tone: plain });
    }
    if (card.drain) {
      out.push({
        value: $tr("nextUp.modDrainRange", {
          min: String(card.drain.min),
          max: String(card.drain.max),
        }),
        title: $tr("nextUp.modFactDrain"),
        tone: plain,
      });
    }
    if (card.platinum !== null) {
      out.push({
        value: $tr("nextUp.acqPlatEach", { plat: String(Math.round(card.platinum)) }),
        title: $tr("nextUp.modFactPrice"),
        tone: plain,
        marketSlug: card.marketSlug,
      });
    }
    out.push({
      value: upgradeCountText(card, $tr),
      title: $tr(UPGRADE_TEXT[card.kind].countTitle),
      tone: plain,
    });
    if (card.owned) {
      out.push({ value: $tr("common.owned"), title: $tr("common.owned"), tone: CHIP_TONE.good });
    } else if (card.copies) {
      const copies = upgradeCopiesText(card, $tr);
      out.push({ value: copies, title: $tr("nextUp.arcaneCopiesTitle"), tone: plain });
    } else if (card.kind === "mods") {
      out.push({ value: $tr("mastery.notOwned"), title: $tr("mastery.notOwned"), tone: plain });
    }
    return out;
  });

  let showAll = $state(false);
  const places = $derived(dropSourcesStore(card.drops, card.name));
  const sources = $derived(upgradeSources(card, $places));
  const shown = $derived(showAll ? sources : sources.slice(0, DROP_PREVIEW));
  const hidden = $derived(sources.length - DROP_PREVIEW);
  /** Pin first, as the card's Work on this does: the caller may lift the card. */
  function clickPin(): void {
    onTogglePin?.();
    onClose();
  }
</script>

<ModalShell ariaLabel={title} {onClose}>
  <div class="detail-panel w-[1180px] max-w-[95vw] p-4">
    <div class="mb-3 flex items-start justify-between gap-2">
      <span class="flex min-w-0 items-center gap-2 pl-2">
        <h3 class="m-0 truncate font-display text-lg text-text-primary">{title}</h3>
        <span class="shrink-0"
          ><WikiButton wikiUrl={card.wikiUrl || null} fallbackName={card.name} /></span
        >
      </span>
      <span class="flex shrink-0 items-center gap-2">
        {#if onTogglePin}
          <button
            class="flex h-6 shrink-0 cursor-pointer items-center rounded-[var(--radius-sm)]
                   border border-accent bg-accent px-2 font-display text-[0.6875rem]
                   font-semibold leading-none text-text-on-accent hover:brightness-110"
            onclick={clickPin}>{$tr(pinned ? "nextUp.modUnpin" : "nextUp.modPin")}</button
          >
        {/if}
        <button
          class="btn-secondary btn-sm !px-2"
          aria-label={$tr("common.close")}
          title={$tr("common.close")}
          onclick={onClose}>&times;</button
        >
      </span>
    </div>

    <div class="mb-3 flex flex-wrap gap-1.5">
      {#each facts as fact, index (index)}
        {#if fact.marketSlug}
          {@const slug = fact.marketSlug}
          <button
            class="{CHIP} cursor-pointer font-semibold {fact.tone} hover:border-accent hover:text-accent"
            title={$tr("common.openOnWarframeMarket")}
            onclick={() => openOnWfm(slug)}>{fact.value}</button
          >
        {:else}
          <span class="{CHIP} font-semibold {fact.tone}" title={fact.title}>{fact.value}</span>
        {/if}
      {/each}
    </div>

    <div class="flex gap-4">
      <div class="flex min-w-0 flex-1 flex-col gap-3">
        {#if card.stats.length > 0}
          <div class="flex flex-col gap-0.5 text-sm leading-snug text-text-primary">
            {#each card.stats as line, index (index)}
              <span>{line}</span>
            {/each}
          </div>
        {/if}

        {#if sources.length > 0}
          <div class="flex flex-col gap-1.5">
            <div class={TILE_GRID}>
              {#each shown as source, index (index)}
                {#if source.kind === "drop"}
                  <DropSourceTile source={source.source} />
                {:else}
                  <UpgradeVendorTile vendor={source.vendor} />
                {/if}
              {/each}
            </div>
            {#if hidden > 0}
              <button
                class="w-fit cursor-pointer text-xs text-text-secondary hover:text-text-primary
                       hover:underline"
                aria-expanded={showAll}
                onclick={() => (showAll = !showAll)}
                >{showAll
                  ? $tr("nextUp.modDropsFewer")
                  : $tr("nextUp.modDropsMore", { count: String(hidden) })}</button
              >
            {/if}
          </div>
        {/if}
      </div>

      <span
        class="relative flex w-48 shrink-0 items-start justify-center overflow-hidden
               rounded-[var(--radius-md)] bg-bg-deep p-2"
      >
        <ItemImage src={card.imageUrl} alt={card.name} cls="max-h-72 max-w-full" eager />
      </span>
    </div>
  </div>
</ModalShell>
