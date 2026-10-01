<script lang="ts">
  import { tr } from "../../lib/i18n.js";
  import { CARD_HEIGHT } from "../../lib/suggest/grid.js";
  import { VOSFOR_WIKI, vosforSummary } from "../../lib/suggest/vosfor.js";
  import { inventoryData, itemDb } from "../../stores/data.js";
  import { priceCacheRevision } from "../../stores/pricing.js";
  import { suggestionPreferences } from "../../stores/suggestionPrefs.js";
  import { TONE } from "./chips.js";
  import { rewardArt } from "./rewardArt.js";
  import VosforDetailsModal from "./VosforDetailsModal.svelte";
  import ItemImage from "../ItemImage.svelte";
  import WikiButton from "../WikiButton.svelte";
  import type { Suggestion } from "../../types/suggest.js";

  interface Props {
    suggestion: Suggestion;
  }

  const { suggestion }: Props = $props();

  /** Matches the upgrade cards it leads, so the band reads line for line. */
  const ART_HEIGHT = CARD_HEIGHT / 2 - 24;

  const LINE = "flex h-4 min-w-0 items-center gap-2 text-xs leading-4";

  const title = $derived($tr("stats.resource.vosfor"));
  const art = $derived(rewardArt($itemDb, suggestion.reward).pieces[0]?.imageUrl ?? null);
  const keepMax = $derived($suggestionPreferences.options.vosforKeepMax);
  // The summary reads the price cache directly, so a revision has to rebuild it.
  const summary = $derived.by(() => {
    void $priceCacheRevision;
    return vosforSummary($inventoryData, $itemDb, keepMax);
  });

  const held = $derived.by(() => {
    if (summary.balance === null) return "";
    const packs = summary.packs;
    return [
      $tr("nextUp.vosforHeld", { amount: summary.balance.toLocaleString() }),
      $tr(packs === 1 ? "nextUp.vosforPackOne" : "nextUp.vosforPacks", { count: String(packs) }),
    ].join(" · ");
  });

  const dissolve = $derived.by(() => {
    const plan = summary.dissolve;
    if (!plan) return "";
    return [
      $tr("nextUp.vosforToDissolve", { count: plan.spare.toLocaleString() }),
      $tr("nextUp.vosforGain", { amount: plan.total.toLocaleString() }),
    ].join(" · ");
  });

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
</script>

<div
  class="flex w-full cursor-pointer flex-col overflow-hidden rounded-[var(--radius-lg)] border
         border-border bg-bg-raised transition-colors duration-200 hover:border-border-strong
         hover:bg-bg-hover focus-visible:outline focus-visible:outline-2
         focus-visible:outline-accent"
  style="height: {CARD_HEIGHT}px"
  data-suggestion-card="vosfor"
  role="button"
  tabindex="0"
  aria-label={$tr("common.openDetailsFor", { name: title })}
  onclick={openDetails}
  onkeydown={onCardKey}
>
  <div
    class="relative flex w-full shrink-0 items-center justify-center overflow-hidden border-b
           border-border bg-bg-deep p-1.5"
    style="height: {ART_HEIGHT}px"
  >
    <ItemImage src={art} alt={title} cls="max-h-full max-w-full" eager />
  </div>

  <div class="flex min-h-0 flex-1 flex-col gap-1 p-2">
    <!-- No pin and no dismiss, but their slots stay so the title lines up. -->
    <div class="grid h-6 grid-cols-[minmax(0,1fr)_1.5rem_1.5rem] items-center gap-x-3">
      <h3 class="m-0 min-w-0 truncate font-display text-sm font-medium leading-5 text-text-primary">
        {title}
      </h3>
      <span class="h-6 w-6"></span>
      <span class="h-6 w-6"></span>
    </div>

    <div class={LINE}>
      <span class="min-w-0 truncate tabular-nums text-text-primary">{held}</span>
    </div>
    <div class={LINE}>
      <span class="min-w-0 truncate tabular-nums {TONE.quiet}">{dissolve}</span>
    </div>

    <div class="mt-auto flex h-6 items-center justify-between gap-2">
      <span class="-ml-1 flex [&>button]:h-6 [&>button]:px-1">
        <WikiButton wikiUrl={VOSFOR_WIKI} fallbackName="Vosfor" />
      </span>
    </div>
  </div>
</div>

{#if detailsOpen}
  <VosforDetailsModal {summary} {art} {title} {keepMax} onClose={() => (detailsOpen = false)} />
{/if}
