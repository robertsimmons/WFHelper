<script lang="ts">
  import { tr } from "../../lib/i18n.js";
  import { CARD_HEIGHT } from "../../lib/suggest/grid.js";
  import type { SimulacrumCard, SimulacrumGap } from "../../lib/suggest/simulacrum.js";
  import {
    cardArt,
    cardTitle,
    enemiesLeft,
    isProbable,
    regularsByFaction,
    stopLabel,
  } from "../../lib/suggest/simulacrumView.js";
  import { simulacrum } from "../../stores/simulacrum.js";
  import { TILE_MICRO, TONE } from "./chips.js";
  import SimulacrumDetailsModal from "./SimulacrumDetailsModal.svelte";
  import ItemImage from "../ItemImage.svelte";

  interface Props {
    card: SimulacrumCard;
  }

  const { card }: Props = $props();

  /** Three stops of two lines each and the regulars line fill what is left. */
  const ART_HEIGHT = 56;
  const LINE = "m-0 flex h-4 min-w-0 items-center gap-1 text-xs leading-4";
  const CHIP =
    "flex h-4 min-w-0 items-center gap-0.5 rounded-[var(--radius-sm)] border border-border " +
    "bg-bg-deep pr-1 text-[0.625rem] leading-none";

  const art = $derived(cardArt(card, $simulacrum.enemyImage));
  const title = $derived(cardTitle(card, $tr));
  const heading = $derived(title[0]);
  const subheading = $derived(title[1]);
  const regulars = $derived(regularsByFaction(card, $simulacrum.factionOf));
  const left = $derived($tr("nextUp.simEnemiesLeft", { count: String(enemiesLeft(card)) }));

  let open = $state(false);

  function onKey(event: KeyboardEvent): void {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    open = true;
  }
</script>

{#snippet chip(gap: SimulacrumGap)}
  <span class={CHIP} title="{gap.name} {gap.scanned}/{gap.required}">
    <span class="flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden">
      <ItemImage
        src={$simulacrum.enemyImage(gap.image)}
        alt={gap.name}
        cls="max-h-4 max-w-4"
        eager
      />
    </span>
    {#if gap.eximus}
      <span class="shrink-0 {TILE_MICRO} {TONE.warn}">EX</span>
    {/if}
    <span class="min-w-0 truncate text-text-primary">{gap.name}</span>
    <span class="shrink-0 tabular-nums {TONE.quiet}">{gap.scanned}/{gap.required}</span>
    {#if isProbable(gap)}
      <span class="shrink-0 {TONE.plain}" title={$tr("nextUp.simProbable")}>?</span>
    {/if}
  </span>
{/snippet}

{#snippet subline()}
  {#if subheading}
    <span class="min-w-0 truncate">{subheading}</span>
    <span class="shrink-0">·</span>
  {/if}
  <span class="shrink-0 tabular-nums" data-simulacrum-left>{left}</span>
{/snippet}

<div
  class="flex w-full cursor-pointer flex-col overflow-hidden rounded-[var(--radius-lg)] border
         border-border bg-bg-raised transition-colors duration-200 hover:border-border-strong
         hover:bg-bg-hover focus-visible:outline focus-visible:outline-2
         focus-visible:outline-accent"
  style="height: {CARD_HEIGHT}px"
  data-suggestion-card="simulacrum"
  data-simulacrum-card={card.key}
  role="button"
  tabindex="0"
  aria-label={$tr("common.openDetailsFor", { name: heading })}
  onclick={() => (open = true)}
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
        <span class="flex min-w-0 gap-1 text-xs leading-4 text-text-secondary">
          {@render subline()}
        </span>
      </span>
    {:else}
      <span class="flex min-w-0 max-w-full flex-col items-center px-2 text-center">
        <span
          class="max-w-full truncate font-display text-lg font-semibold leading-6
                     text-text-primary">{heading}</span
        >
        <span class="flex min-w-0 max-w-full gap-1 text-sm leading-5 {TONE.quiet}">
          {@render subline()}
        </span>
      </span>
    {/if}
  </div>

  <div class="flex min-h-0 flex-1 flex-col gap-0.5 p-2">
    {#each card.stops as stop, index (stop.node.key)}
      {@const [where, what] = stopLabel(card, stop)}
      <div class="flex min-w-0 flex-col" data-simulacrum-stop={index + 1}>
        <p class={LINE}>
          <span class="w-3 shrink-0 font-display font-semibold text-accent">{index + 1}</span>
          <span class="min-w-0 truncate text-text-primary">{where}</span>
          <span class="shrink-0 {TONE.plain}">·</span>
          <span class="min-w-0 truncate {TONE.quiet}">{what}</span>
        </p>
        <div class="flex h-4 min-w-0 items-center gap-1 overflow-hidden pl-4">
          {#each stop.gaps as gap (gap.type)}
            {@render chip(gap)}
          {/each}
        </div>
      </div>
    {/each}

    {#if card.stops.length === 0}
      {#if card.kind === "steelPath"}
        <p class="{LINE} {TONE.quiet}">{$tr("nextUp.simAnySteelPath")}</p>
      {/if}
      <div class="flex min-h-0 flex-1 flex-wrap content-start gap-1 overflow-hidden">
        {#each card.gaps as gap (gap.type)}
          {@render chip(gap)}
        {/each}
      </div>
    {/if}

    {#if regulars.length > 0}
      <p class="{LINE} mt-auto {TONE.quiet}" title={$tr("nextUp.simRegularsTitle")}>
        {#each regulars as group (group.faction)}
          <span class="shrink-0 tabular-nums">+{group.count} {group.faction}</span>
        {/each}
      </p>
    {/if}
  </div>
</div>

{#if open}
  <SimulacrumDetailsModal
    {card}
    title={subheading ? `${heading} · ${subheading}` : heading}
    onClose={() => (open = false)}
  />
{/if}

<style>
  /* Stroke under the fill keeps the name readable over any artwork. */
  .over-art {
    -webkit-text-stroke: 2px var(--bg-deep);
    paint-order: stroke fill;
  }
</style>
