<script lang="ts">
  import { tr } from "../../lib/i18n.js";
  import { resolveDropArt } from "../../lib/suggest/dropPools.js";
  import { itemDb } from "../../stores/data.js";
  import { CHIP_TONE, TILE_MICRO, TONE } from "./chips.js";
  import { plainName } from "./rewardArt.js";
  import ItemImage from "../ItemImage.svelte";
  import type { ExchangeDetails } from "../../lib/suggest/vendorExchange.js";

  interface Props {
    exchange: ExchangeDetails;
  }

  const { exchange }: Props = $props();

  /** Both tables open on the same four tracks, so Have lands under Have. */
  const LEAD = "11rem 4rem 4rem 4rem";
  const OFFER_COLS = `${LEAD} 3.5rem minmax(0,1fr)`;

  const HEAD = `${TILE_MICRO} !text-[0.625rem] text-text-muted`;
  const ROW = "grid items-center gap-x-3 border-b border-border/60 px-2 py-1.5 text-xs";
  const NUM = "text-right font-display tabular-nums";
  const TAG = "shrink-0 rounded-[var(--radius-sm)] border px-1 text-[0.625rem] leading-[0.875rem]";
  const SECTION = "font-display text-xs font-semibold uppercase tracking-[0.08em] text-text-muted";

  function art(name: string, uniqueName?: string): string | null {
    return resolveDropArt($itemDb, name, uniqueName)?.imageUrl ?? null;
  }

  function label(name: string, uniqueName?: string): string {
    return plainName(resolveDropArt($itemDb, name, uniqueName)?.name ?? name);
  }

  /** Exact: a spare of 0 beside a need only a few over the stock has to show the gap. */
  function count(value: number): string {
    return value.toLocaleString();
  }

  function range(min: number, max: number): string {
    return min === max ? count(max) : `${count(min)}-${count(max)}`;
  }

  interface Column {
    key: string;
    name: string;
    art: string | null;
  }

  const columns = $derived.by((): Column[] => [
    ...exchange.offers.map((offer) => ({
      key: offer.uniqueName,
      name: label(offer.name, offer.uniqueName),
      art: art(offer.name, offer.uniqueName),
    })),
    ...(exchange.kuva ? [{ key: "kuva", name: $tr("stats.resource.kuva"), art: art("Kuva") }] : []),
  ]);
  const matCols = $derived(`${LEAD} repeat(${columns.length}, minmax(0,6rem))`);
</script>

{#snippet icon(src: string | null, alt: string, size: string)}
  <span class="flex {size} shrink-0 items-center justify-center overflow-hidden">
    <ItemImage {src} {alt} cls="max-h-full max-w-full" eager />
  </span>
{/snippet}

<div class="flex flex-col gap-4" data-exchange-tables>
  <section class="flex flex-col">
    <span class="{SECTION} mb-1">{$tr("nextUp.exchangeOffersHeading")}</span>
    <div class="{ROW} {HEAD} py-1" style="grid-template-columns: {OFFER_COLS}">
      <span>{$tr("nextUp.exchangeItem")}</span>
      <span class="text-right">{$tr("nextUp.exchangeHave")}</span>
      <span class="text-right">{$tr("nextUp.exchangeNeedLabel")}</span>
      <span class="text-right">{$tr("nextUp.exchangeShortLabel")}</span>
      <span class="text-right">{$tr("nextUp.exchangeGivesLabel")}</span>
      <span>{$tr("nextUp.exchangeWantedBy")}</span>
    </div>
    {#each exchange.offers as offer (offer.uniqueName)}
      {@const name = label(offer.name, offer.uniqueName)}
      <div
        class={ROW}
        style="grid-template-columns: {OFFER_COLS}"
        data-exchange-offer={offer.uniqueName}
      >
        <span class="flex min-w-0 items-center gap-2">
          {@render icon(art(offer.name, offer.uniqueName), name, "h-7 w-7")}
          <span class="min-w-0 truncate text-sm text-text-primary" title={name}>{name}</span>
          {#if !offer.affordable}
            <span class="{TAG} {CHIP_TONE.bad}">{$tr("nextUp.exchangeShort")}</span>
          {/if}
        </span>
        <span class="{NUM} text-text-primary">{count(offer.held)}</span>
        <span class="{NUM} {TONE.quiet}">{count(offer.needed)}</span>
        <span class="{NUM} {offer.short > 0 ? TONE.warn : TONE.plain}">{count(offer.short)}</span>
        <span class="{NUM} {TONE.quiet}">x{count(offer.quantity)}</span>
        <span class="flex min-w-0 flex-wrap gap-x-2 gap-y-0.5 {TONE.quiet}">
          {#if offer.kind === "upgrade"}
            <span class="{TAG} {CHIP_TONE.plain}">{$tr("nextUp.exchangeUnowned")}</span>
          {:else}
            {#each offer.wantedBy as wanter, index (index)}
              <span class="whitespace-nowrap"
                >{wanter.name}
                <span class="tabular-nums text-text-muted">{count(wanter.count)}</span></span
              >
            {/each}
          {/if}
        </span>
      </div>
    {/each}
    {#if exchange.kuva}
      <div class={ROW} style="grid-template-columns: {OFFER_COLS}" data-exchange-offer="kuva">
        <span class="flex min-w-0 items-center gap-2">
          {@render icon(art("Kuva"), $tr("stats.resource.kuva"), "h-7 w-7")}
          <span class="min-w-0 truncate text-sm text-text-primary"
            >{$tr("stats.resource.kuva")}</span
          >
        </span>
        <span class="{NUM} text-text-primary">{count(exchange.kuva.held)}</span>
        <span class="{NUM} {TONE.plain}">-</span>
        <span class="{NUM} {TONE.plain}">-</span>
        <span class="{NUM} {TONE.good}">x{count(exchange.kuva.quantity)}</span>
        <span class="flex"
          ><span class="{TAG} {CHIP_TONE.plain}">{$tr("dailies.groupWeekly")}</span></span
        >
      </div>
    {/if}
  </section>

  <section class="flex flex-col">
    <span class="{SECTION} mb-1">{$tr("nextUp.exchangeMatsHeading")}</span>
    <div class="{ROW} {HEAD} py-1" style="grid-template-columns: {matCols}">
      <span>{$tr("nextUp.exchangeMat")}</span>
      <span class="text-right">{$tr("nextUp.exchangeHave")}</span>
      <span class="text-right">{$tr("nextUp.exchangeNeeded")}</span>
      <span class="text-right">{$tr("nextUp.exchangeSpareLabel")}</span>
      {#each columns as column (column.key)}
        <span class="flex min-w-0 flex-col items-end gap-0.5" title={column.name}>
          {@render icon(column.art, column.name, "h-4 w-4")}
          <span class="line-clamp-2 min-w-0 text-right normal-case leading-tight tracking-normal"
            >{column.name}</span
          >
        </span>
      {/each}
    </div>
    {#each exchange.mats as mat (mat.uniqueName)}
      {@const name = label(mat.name, mat.uniqueName)}
      <div class={ROW} style="grid-template-columns: {matCols}" data-exchange-mat={mat.uniqueName}>
        <span class="flex min-w-0 items-center gap-2">
          {@render icon(art(mat.name, mat.uniqueName), name, "h-7 w-7")}
          <span class="min-w-0 truncate text-sm text-text-primary" title={name}>{name}</span>
        </span>
        <span class="{NUM} text-text-primary">{count(mat.held)}</span>
        <span
          class="{NUM} {TONE.quiet}"
          title={mat.wantedBy.map((row) => `${row.name} ${count(row.count)}`).join("\n")}
          data-exchange-wanted={mat.wantedBy.map((row) => `${row.name}=${row.count}`).join("; ")}
          >{count(mat.needed)}</span
        >
        <span class="{NUM} {mat.spare > 0 ? TONE.good : TONE.plain}">{count(mat.spare)}</span>
        {#each mat.prices as price, index (index)}
          <span
            class="{NUM} {price === null ? TONE.plain : price.covers ? TONE.good : TONE.bad}"
            title={price ? $tr("nextUp.exchangeSpare", { count: count(mat.spare) }) : ""}
            >{price ? range(price.min, price.max) : "-"}</span
          >
        {/each}
        {#if exchange.kuva}
          <span
            class="{NUM} {mat.kuva === null
              ? TONE.plain
              : mat.spare >= mat.kuva
                ? TONE.good
                : TONE.bad}">{mat.kuva === null ? "-" : count(mat.kuva)}</span
          >
        {/if}
      </div>
    {/each}
  </section>
</div>
