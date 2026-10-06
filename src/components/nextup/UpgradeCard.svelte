<script lang="ts">
  import { tr } from "../../lib/i18n.js";
  import { openOnWfm } from "../../lib/priceLoader.js";
  import { CARD_HEIGHT } from "../../lib/suggest/grid.js";
  import {
    upgradeCopiesText,
    upgradeCountText,
    type UpgradeCard,
  } from "../../lib/suggest/upgrades.js";
  import { CHIP_TONE, TONE } from "./chips.js";
  import UpgradeDetailsModal from "./UpgradeDetailsModal.svelte";
  import UpgradeSourceLine from "./UpgradeSourceLine.svelte";
  import ItemImage from "../ItemImage.svelte";
  import WikiButton from "../WikiButton.svelte";
  import { suggestionPreferences } from "../../stores/suggestionPrefs.js";
  import type { Suggestion } from "../../types/suggest.js";

  interface Props {
    suggestion: Suggestion;
    card: UpgradeCard;
    onDismiss: () => void;
    onPin?: (() => void) | undefined;
  }

  const { suggestion, card, onDismiss, onPin }: Props = $props();

  /** Two fixed lines and the button row under the title take more than half the
   *  box leaves, so the art gives up what a relic card's does. */
  const ART_HEIGHT = CARD_HEIGHT / 2 - 24;

  const ICON_BTN =
    "flex h-6 w-6 cursor-pointer items-center justify-center rounded border border-border " +
    "bg-bg-base text-text-muted transition-[border-color,color,background-color] duration-150 " +
    "hover:border-border-strong hover:text-text-primary";

  const LINE = "flex h-4 min-w-0 items-center gap-2 text-xs leading-4";

  const picked = $derived(
    $suggestionPreferences.options[card.kind === "mods" ? "modVendors" : "arcaneVendors"],
  );
  const stats = $derived(card.stats.join("\n"));
  const price = $derived(
    card.platinum === null
      ? ""
      : $tr("nextUp.acqPlatEach", { plat: String(Math.round(card.platinum)) }),
  );

  let detailsOpen = $state(false);

  // The wiki button has no handler of its own to stop the click with.
  function openDetails(event: MouseEvent): void {
    if (event.target instanceof Element && event.target.closest("button")) return;
    detailsOpen = true;
  }

  function onCardKey(event: KeyboardEvent): void {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    detailsOpen = true;
  }

  function clickDismiss(event: MouseEvent): void {
    event.stopPropagation();
    onDismiss();
  }

  function clickPin(event: MouseEvent): void {
    event.stopPropagation();
    onPin?.();
  }
</script>

<div
  class="flex w-full cursor-pointer flex-col overflow-hidden rounded-[var(--radius-lg)] border
         border-border bg-bg-raised transition-colors duration-200 hover:border-border-strong
         hover:bg-bg-hover focus-visible:outline focus-visible:outline-2
         focus-visible:outline-accent"
  style="height: {CARD_HEIGHT}px"
  data-suggestion-card={card.kind}
  data-suggestion-reward={card.name}
  role="button"
  tabindex="0"
  aria-label={$tr("common.openDetailsFor", { name: suggestion.title })}
  title={stats}
  onclick={openDetails}
  onkeydown={onCardKey}
>
  <!-- The tier corner stays empty: a mod or arcane has no tier. -->
  <div
    class="relative flex w-full shrink-0 items-center justify-center overflow-hidden border-b
           border-border bg-bg-deep p-1.5"
    style="height: {ART_HEIGHT}px"
  >
    <ItemImage src={card.imageUrl} alt={card.name} cls="max-h-full max-w-full" eager />
  </div>

  <div class="flex min-h-0 flex-1 flex-col gap-1 p-2">
    <div class="grid h-6 grid-cols-[minmax(0,1fr)_1.5rem_1.5rem] items-center gap-x-3">
      <div class="flex min-w-0 items-center gap-2">
        <h3
          class="m-0 min-w-0 flex-1 truncate font-display text-sm font-medium leading-5
                 text-text-primary"
        >
          {suggestion.title}
        </h3>
        {#if card.owned}
          <span
            class="shrink-0 rounded-[var(--radius-sm)] border px-1 text-[0.625rem]
                   leading-[0.875rem] {CHIP_TONE.good}">{$tr("common.owned")}</span
          >
        {:else if card.copies}
          <span
            class="shrink-0 text-xs tabular-nums {TONE.quiet}"
            title={$tr("nextUp.arcaneCopiesTitle")}>{upgradeCopiesText(card, $tr)}</span
          >
        {/if}
      </div>
      <span class="h-6 w-6"></span>
      <button
        class={ICON_BTN}
        title={$tr("common.dismiss")}
        aria-label={$tr("common.dismiss")}
        onclick={clickDismiss}
      >
        <svg viewBox="0 0 16 16" class="h-3 w-3" aria-hidden="true">
          <path
            d="M4 4 12 12M12 4 4 12"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          />
        </svg>
      </button>
    </div>

    <!-- Every line is held whether or not it has anything to say, so the cards
         in a row read line for line. -->
    <div
      class="grid h-4 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 text-xs leading-4"
    >
      <span class="min-w-0 truncate text-text-primary">{card.slot ?? ""}</span>
      {#if price && card.marketSlug}
        <button
          class="cursor-pointer tabular-nums {TONE.quiet} hover:text-accent hover:underline"
          title={$tr("common.openOnWarframeMarket")}
          onclick={() => openOnWfm(card.marketSlug)}>{price}</button
        >
      {:else}
        <span class="tabular-nums {TONE.quiet}">{price}</span>
      {/if}
      <span class="{TONE.quiet} tabular-nums">{upgradeCountText(card, $tr)}</span>
    </div>
    <div class={LINE}>
      <UpgradeSourceLine {card} {picked} tone={TONE.quiet} />
    </div>

    <div class="mt-auto flex h-6 items-center justify-between gap-2">
      <span class="-ml-1 flex [&>button]:h-6 [&>button]:px-1">
        <WikiButton wikiUrl={card.wikiUrl || null} fallbackName={card.name} />
      </span>
      <!-- An owned one has nothing left to farm, and a pin on it would lift at once. -->
      {#if onPin && !card.owned}
        <button
          class="flex h-6 shrink-0 cursor-pointer items-center rounded-[var(--radius-sm)]
                 border border-accent bg-accent px-2 font-display text-[0.6875rem]
                 font-semibold leading-none text-text-on-accent hover:brightness-110"
          onclick={clickPin}>{$tr("nextUp.modPin")}</button
        >
      {/if}
    </div>
  </div>
</div>

{#if detailsOpen}
  <UpgradeDetailsModal
    {card}
    title={suggestion.title}
    pinned={false}
    onTogglePin={card.owned ? undefined : onPin}
    onClose={() => (detailsOpen = false)}
  />
{/if}
