<script lang="ts">
  import { tick } from "svelte";
  import { flip } from "svelte/animate";

  import { itemDb } from "../../stores/data.js";
  import { tr } from "../../lib/i18n.js";
  import { send } from "../../lib/ipc.js";
  import { openOnWfm } from "../../lib/priceLoader.js";
  import { acquisitionStatuses } from "../../lib/suggest/providers/acquisition.js";
  import { upgradeCopiesText } from "../../lib/suggest/upgrades.js";
  import { buildWikiUrl, toOfficialWikiUrl } from "../../lib/wikiUrl.js";
  import {
    FLIGHT_MS,
    liftCard,
    pinnedNode,
    suggestionNode,
    upgradePinnedNode,
    upgradeSuggestionNode,
  } from "./cardFlight.js";
  import { nextStep, type PinnedEntry } from "./pinnedAcquisitions.js";
  import type { PinnedUpgrade } from "./pinnedUpgrades.js";
  import { rewardArt } from "./rewardArt.js";
  import StateChip from "./StateChip.svelte";
  import UpgradeDetailsModal from "./UpgradeDetailsModal.svelte";
  import UpgradeSourceLine from "./UpgradeSourceLine.svelte";
  import ItemImage from "../ItemImage.svelte";

  interface Props {
    entries: PinnedEntry[];
    upgrades?: PinnedUpgrade[];
    onOpen: (entry: PinnedEntry) => void;
    onUnpin: (entry: PinnedEntry) => void;
    onUnpinUpgrade?: ((entry: PinnedUpgrade) => void) | undefined;
  }

  const { entries, upgrades = [], onOpen, onUnpin, onUnpinUpgrade }: Props = $props();

  // Fixed so an upgrade pin stands as tall as an acquisition pin's three lines.
  const CARD =
    "flex h-[4.25rem] w-64 cursor-pointer items-center gap-2 rounded-[var(--radius-md)] border " +
    "border-border bg-bg-surface py-1.5 pl-2 pr-6 text-left " +
    "transition-[border-color] duration-150 hover:border-accent";
  const UNPIN =
    "absolute right-1 top-1 flex h-4 w-4 cursor-pointer items-center justify-center " +
    "rounded text-xs leading-none text-text-muted transition-colors duration-150 " +
    "hover:text-text-primary";
  const WIKI =
    "absolute bottom-1 right-1 flex h-4 w-4 cursor-pointer items-center justify-center " +
    "rounded text-text-muted transition-colors duration-150 hover:text-text-primary";
  const SUB = "text-[0.6875rem] leading-tight text-text-secondary";

  function openWiki(wikiUrl: string | null | undefined, fallbackName: string): void {
    send("open-external", wikiUrl ? toOfficialWikiUrl(wikiUrl) : buildWikiUrl(fallbackName));
  }

  let openUpgrade = $state<PinnedUpgrade | null>(null);

  function unpinUpgrade(entry: PinnedUpgrade): void {
    onUnpinUpgrade?.(entry);
    const flight = liftCard(upgradePinnedNode(entry.kind, entry.name));
    void tick().then(() => flight.settle(upgradeSuggestionNode(entry.kind, entry.name)));
  }

  // The price sits inside the card's button, where a nested button is not allowed.
  function clickUpgrade(event: MouseEvent, entry: PinnedUpgrade): void {
    const onPrice = event.target instanceof Element && event.target.closest("[data-market]");
    if (onPrice && entry.card.platinum !== null) openOnWfm(entry.card.marketSlug);
    else openUpgrade = entry;
  }

  function upgradePrice(entry: PinnedUpgrade): string {
    const plat = entry.card.platinum;
    return plat === null ? "" : $tr("nextUp.acqPlatEach", { plat: String(Math.round(plat)) });
  }

  function art(entry: PinnedEntry): string | null {
    return rewardArt($itemDb, entry.suggestion.reward).pieces[0]?.imageUrl ?? null;
  }

  function name(entry: PinnedEntry): string {
    return entry.suggestion.reward?.name ?? entry.suggestion.title;
  }

  // The card only comes back where the feed has a place to draw it: another
  // page of the grid, or a collapsed section, leaves nothing to land on and the
  // copy fades where it stood.
  function unpin(entry: PinnedEntry): void {
    onUnpin(entry);
    const flight = liftCard(pinnedNode(entry.uniqueName));
    void tick().then(() => flight.settle(suggestionNode(entry.uniqueName)));
  }
</script>

{#snippet wiki(wikiUrl: string | null | undefined, fallbackName: string)}
  <button
    class={WIKI}
    title={$tr("wiki.openOnWikiTitle")}
    aria-label={$tr("wiki.openOnWikiTitle")}
    onclick={() => openWiki(wikiUrl, fallbackName)}
  >
    <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true">
      <path
        d="M9 2h5v5l-1.8-1.8L9 8.4 7.6 7l3.2-3.2L9 2zM4 4h3v1.5H4v7h7V9.5h1.5V13a.5.5 0 0 1-.5.5H3.5A.5.5 0 0 1 3 13V4.5A.5.5 0 0 1 3.5 4H4z"
      />
    </svg>
  </button>
{/snippet}

{#if entries.length > 0 || upgrades.length > 0}
  <div class="flex flex-col gap-1">
    <div class="flex flex-wrap gap-2">
      {#each entries as entry (entry.uniqueName)}
        <div
          class="relative"
          data-acquisition-pin={entry.uniqueName}
          animate:flip={{ duration: FLIGHT_MS }}
        >
          <button class={CARD} onclick={() => onOpen(entry)}>
            <span
              class="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden
                     rounded-[var(--radius-sm)] bg-bg-deep"
            >
              <ItemImage src={art(entry)} alt={name(entry)} cls="max-h-10 max-w-10" eager />
            </span>
            <span class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="min-w-0 truncate text-sm font-semibold leading-5 text-text-primary"
                >{name(entry)}</span
              >
              <!-- Held empty on gear with no chips, so every pin reads line for line. -->
              <span class="flex h-4 min-w-0 items-center gap-1.5">
                {#if entry.suggestion.details?.acquisition}
                  {#each acquisitionStatuses(entry.suggestion.details.acquisition) as status (status.win)}
                    <StateChip {status} />
                  {/each}
                {/if}
              </span>
              {#if entry.steps && entry.steps.total > 0}
                <span class={SUB}
                  >{$tr("nextUp.pinnedStepCount", {
                    step: nextStep(entry.steps),
                    total: entry.steps.total,
                  })}</span
                >
              {/if}
            </span>
          </button>
          <button
            class={UNPIN}
            title={$tr("nextUp.unpinAcquisition")}
            aria-label={$tr("nextUp.unpinAcquisition")}
            onclick={() => unpin(entry)}>×</button
          >
          {@render wiki(null, entry.suggestion.wiki ?? name(entry))}
        </div>
      {/each}
      {#each upgrades as entry (`${entry.kind}:${entry.name}`)}
        {@const copies = upgradeCopiesText(entry.card, $tr)}
        <div
          class="relative"
          data-upgrade-pin={`${entry.kind}:${entry.name}`}
          animate:flip={{ duration: FLIGHT_MS }}
        >
          <button class={CARD} onclick={(event) => clickUpgrade(event, entry)}>
            <span
              class="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden
                     rounded-[var(--radius-sm)] bg-bg-deep"
            >
              <ItemImage src={entry.card.imageUrl} alt={entry.name} cls="max-h-10 max-w-10" eager />
            </span>
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="flex min-w-0 items-center gap-1.5">
                <span class="min-w-0 truncate text-sm font-semibold text-text-primary"
                  >{entry.card.displayName ?? entry.name}</span
                >
                {#if copies}
                  <span class="shrink-0 tabular-nums {SUB}" title={$tr("nextUp.arcaneCopiesTitle")}
                    >{copies}</span
                  >
                {/if}
              </span>
              <span class="flex min-w-0 gap-1.5 {SUB}">
                <UpgradeSourceLine card={entry.card} />
                {#if entry.card.marketSlug}
                  <span
                    class="ml-auto shrink-0 tabular-nums hover:text-accent hover:underline"
                    title={$tr("common.openOnWarframeMarket")}
                    data-market>{upgradePrice(entry)}</span
                  >
                {:else}
                  <span class="ml-auto shrink-0 tabular-nums">{upgradePrice(entry)}</span>
                {/if}
              </span>
            </span>
          </button>
          <button
            class={UNPIN}
            title={$tr("nextUp.modUnpin")}
            aria-label={$tr("nextUp.modUnpin")}
            onclick={() => unpinUpgrade(entry)}>×</button
          >
          {@render wiki(entry.card.wikiUrl, entry.name)}
        </div>
      {/each}
    </div>
  </div>
{/if}

{#if openUpgrade}
  {@const entry = openUpgrade}
  <UpgradeDetailsModal
    card={entry.card}
    title={entry.card.displayName ?? entry.name}
    pinned
    onTogglePin={() => unpinUpgrade(entry)}
    onClose={() => (openUpgrade = null)}
  />
{/if}
