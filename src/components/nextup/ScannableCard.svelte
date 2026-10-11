<script lang="ts">
  import { tr } from "../../lib/i18n.js";
  import { CARD_HEIGHT } from "../../lib/suggest/grid.js";
  import type { ScannablePlaceCard } from "../../lib/suggest/scannablePlaces.js";
  import { placeArtUrl } from "../../lib/suggest/scannablePlacesData.js";
  import { TONE } from "./chips.js";
  import { SCAN_GROUP_LABEL, SCAN_GROUP_SHORT } from "./scanGroupLabels.js";
  import ScannablePlaceModal from "./ScannablePlaceModal.svelte";
  import ItemImage from "../ItemImage.svelte";
  import WikiButton from "../WikiButton.svelte";

  interface Props {
    card: ScannablePlaceCard;
  }

  const { card }: Props = $props();

  const ART_HEIGHT = 56;
  /** Past this many groups the rest fold into one +N chip, so the row never wraps. */
  const GROUP_CHIPS = 3;
  const LINE = "m-0 flex h-4 min-w-0 items-center gap-1 text-xs leading-4";
  const ROW = "flex h-5 min-w-0 items-center gap-1 overflow-hidden";
  const CHIP =
    "flex h-4 min-w-0 shrink-0 items-center gap-1 rounded-[var(--radius-sm)] border " +
    "border-border bg-bg-deep px-1 text-[0.625rem] leading-none";

  const place = $derived(card.place);
  const heading = $derived(place?.name ?? $tr("nextUp.scanPlaceUnplaced"));
  const art = $derived(placeArtUrl(place?.art ?? null));
  const shownGroups = $derived(
    card.groups.length > GROUP_CHIPS ? card.groups.slice(0, GROUP_CHIPS - 1) : card.groups,
  );
  const foldedGroups = $derived(card.groups.slice(shownGroups.length));
  const foldedTitle = $derived(
    foldedGroups.map((row) => `${$tr(SCAN_GROUP_LABEL[row.group])} ${row.count}`).join(" · "),
  );

  let open = $state(false);

  function openDetails(event: MouseEvent): void {
    if (event.target instanceof Element && event.target.closest("button")) return;
    open = true;
  }

  function onKey(event: KeyboardEvent): void {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    open = true;
  }
</script>

<div
  class="flex w-full cursor-pointer flex-col overflow-hidden rounded-[var(--radius-lg)] border
         border-border bg-bg-raised transition-colors duration-200 hover:border-border-strong
         hover:bg-bg-hover focus-visible:outline focus-visible:outline-2
         focus-visible:outline-accent"
  style="height: {CARD_HEIGHT}px"
  data-suggestion-card="scannable-place"
  data-scannable-place={card.key}
  role="button"
  tabindex="0"
  aria-label={$tr("common.openDetailsFor", { name: heading })}
  onclick={openDetails}
  onkeydown={onKey}
>
  <div
    class="relative flex w-full shrink-0 items-center justify-center overflow-hidden border-b
           border-border bg-bg-deep"
    style="height: {ART_HEIGHT}px"
  >
    {#if art}
      <span class="absolute inset-0 flex items-center justify-end p-1">
        <ItemImage src={art} alt={heading} cls="max-h-full max-w-full" eager />
      </span>
      <span class="over-art absolute inset-x-0 bottom-1 z-[1] flex min-w-0 flex-col px-2">
        <span class="truncate font-display text-base font-semibold leading-5 text-text-primary"
          >{heading}</span
        >
      </span>
    {:else}
      <span
        class="max-w-full truncate px-2 text-center font-display text-lg font-semibold leading-6
               text-text-primary">{heading}</span
      >
    {/if}
  </div>

  <div class="flex min-h-0 flex-1 flex-col gap-1 p-2">
    <p class="{LINE} tabular-nums" data-scannable-place-left>
      <span class="shrink-0 text-text-primary"
        >{$tr("nextUp.scanPlaceLeft", { count: String(card.left) })}</span
      >
      {#if place}
        <span class="shrink-0 {TONE.plain}">·</span>
        <span class="shrink-0 {TONE.quiet}"
          >{$tr("nextUp.scanPlacePerRun", { count: String(card.perRun) })}</span
        >
      {/if}
    </p>

    <p class="{LINE} {TONE.quiet}" title={place?.run}>
      <span class="min-w-0 truncate">{place?.run ?? ""}</span>
    </p>

    <div class={ROW}>
      {#each place?.gear ?? [] as gear (gear)}
        <span class="{CHIP} text-text-primary" title={gear}>
          <span class="min-w-0 truncate">{gear}</span>
        </span>
      {/each}
    </div>

    <div class={ROW}>
      {#each shownGroups as row (row.group)}
        <span class={CHIP} title="{$tr(SCAN_GROUP_LABEL[row.group])} {row.count}">
          <span class="text-text-primary">{$tr(SCAN_GROUP_SHORT[row.group])}</span>
          <span class="tabular-nums {TONE.quiet}">{row.count}</span>
        </span>
      {/each}
      {#if foldedGroups.length > 0}
        <span class="{CHIP} tabular-nums {TONE.quiet}" title={foldedTitle}
          >+{foldedGroups.length}</span
        >
      {/if}
    </div>

    {#if place?.wiki}
      <div class="mt-auto flex h-6 items-center">
        <span class="-ml-1 flex [&>button]:h-6 [&>button]:px-1">
          <WikiButton wikiUrl={place.wiki} fallbackName={place.name} />
        </span>
      </div>
    {/if}
  </div>
</div>

{#if open}
  <ScannablePlaceModal {card} title={heading} onClose={() => (open = false)} />
{/if}

<style>
  /* Stroke under the fill keeps the name readable over any artwork. */
  .over-art {
    -webkit-text-stroke: 2px var(--bg-deep);
    paint-order: stroke fill;
  }
</style>
