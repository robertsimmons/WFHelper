<script lang="ts">
  import { tr } from "../../lib/i18n.js";
  import { toMarketSlug } from "../../lib/marketNaming.js";
  import { openOnWfm } from "../../lib/priceLoader.js";
  import { arcaneImage } from "../../lib/suggest/arcanes.js";
  import {
    VOSFOR_WIKI,
    type DissolveRow,
    type PackGoal,
    type PackRank,
    type VosforSummary,
  } from "../../lib/suggest/vosfor.js";
  import { itemDb } from "../../stores/data.js";
  import { setSuggestionOption } from "../../stores/suggestionPrefs.js";
  import { CHIP_TONE, TILE_MICRO, TONE } from "./chips.js";
  import ItemTile from "./ItemTile.svelte";
  import VosforPackModal from "./VosforPackModal.svelte";
  import ItemImage from "../ItemImage.svelte";
  import ModalShell from "../ModalShell.svelte";
  import WikiButton from "../WikiButton.svelte";
  import type { MessageKey } from "../../lib/i18n.js";

  interface Props {
    summary: VosforSummary;
    art: string | null;
    title: string;
    keepMax: boolean;
    onClose: () => void;
  }

  const { summary, art, title, keepMax, onClose }: Props = $props();

  const CHIP = "rounded-[var(--radius-sm)] border border-border px-1.5 py-0.5 text-[0.6875rem]";
  const TILE_GRID = "grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-2";
  const LABEL = "text-xs font-semibold uppercase tracking-[0.08em] text-text-muted";
  const MORE =
    "w-fit cursor-pointer text-xs text-text-secondary hover:text-text-primary hover:underline";
  const META = "flex min-w-0 items-center gap-x-2 text-[0.6875rem] leading-tight tabular-nums";
  const DISSOLVE_PREVIEW = 24;
  const HEADING: Record<PackGoal, MessageKey> = {
    arcanes: "nextUp.vosforForArcanes",
    platinum: "nextUp.vosforForPlatinum",
  };

  interface Fact {
    value: string;
    title: string;
  }

  const facts = $derived.by((): Fact[] => {
    const out: Fact[] = [];
    if (summary.balance !== null) {
      out.push({
        value: $tr("nextUp.vosforBalance", { amount: summary.balance.toLocaleString() }),
        title: $tr("stats.resource.vosfor"),
      });
      const count = String(summary.packs);
      const packs = $tr(summary.packs === 1 ? "nextUp.vosforPackOne" : "nextUp.vosforPacks", {
        count,
      });
      out.push({ value: packs, title: packs });
    }
    if (summary.dissolve) {
      const value = $tr("nextUp.vosforFromDissolving", {
        amount: summary.dissolve.total.toLocaleString(),
      });
      out.push({ value, title: value });
    }
    return out;
  });

  let allDissolve = $state(false);
  let openPack = $state<{ collection: string; goal: PackGoal } | null>(null);
  // Looked up live, so a price revision under the open pack redraws it.
  const openRank = $derived.by(() => {
    if (!openPack) return null;
    const { collection, goal } = openPack;
    const ranks = goal === "arcanes" ? summary.forArcanes : summary.forPlatinum;
    const rank = ranks?.find((entry) => entry.collection === collection);
    return rank ? { rank, goal } : null;
  });

  const dissolveRows = $derived(summary.dissolve?.rows ?? []);
  const dissolveShown = $derived(
    allDissolve ? dissolveRows : dissolveRows.slice(0, DISSOLVE_PREVIEW),
  );
  const dissolveHidden = $derived(dissolveRows.length - DISSOLVE_PREVIEW);

  function plat(value: number): string {
    return $tr("nextUp.acqPlatEach", { plat: String(Math.round(value)) });
  }

  function perPack(value: number): string {
    return $tr("nextUp.vosforPlatShort", { plat: String(Math.round(value)) });
  }

  function perPackTitle(value: number): string {
    return $tr("nextUp.vosforPlatPerPack", { plat: String(Math.round(value)) });
  }
</script>

{#snippet price(name: string, value: number)}
  {@const slug = toMarketSlug(name)}
  {#if slug}
    <button
      class="cursor-pointer tabular-nums {TONE.quiet} hover:text-accent hover:underline"
      title={$tr("common.openOnWarframeMarket")}
      onclick={() => openOnWfm(slug)}>{plat(value)}</button
    >
  {:else}
    <span class="tabular-nums {TONE.quiet}">{plat(value)}</span>
  {/if}
{/snippet}

{#snippet packLine(goal: PackGoal, rank: PackRank)}
  <button
    class="flex h-7 w-full min-w-0 cursor-pointer items-center gap-2 rounded-[var(--radius-sm)]
           px-1.5 text-left hover:bg-bg-hover"
    data-vosfor-pack-line={rank.collection}
    onclick={() => (openPack = { collection: rank.collection, goal })}
  >
    <span class="min-w-0 flex-1 truncate text-sm text-text-primary">{rank.collection}</span>
    {#if rank.top}
      {@const top = rank.top}
      <span class="flex min-w-0 max-w-[65%] items-center gap-1.5 text-[0.6875rem] tabular-nums">
        {#if goal === "platinum"}
          <span class="shrink-0 font-semibold text-text-primary" title={perPackTitle(rank.score)}
            >{perPack(rank.score)}</span
          >
        {/if}
        <span
          class="flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden
                 rounded-[var(--radius-sm)] bg-bg-deep"
        >
          <ItemImage
            src={arcaneImage(top.name, $itemDb)}
            alt={top.name}
            cls="max-h-5 max-w-5"
            eager
          />
        </span>
        <span class="min-w-0 truncate {TONE.quiet}" title={top.name}>{top.name}</span>
        {#if goal === "arcanes" && top.held !== null}
          <span class="shrink-0 {TONE.quiet}" title={$tr("nextUp.arcaneCopiesTitle")}
            >{$tr("nextUp.arcaneCopies", { held: String(top.held), max: String(top.max) })}</span
          >
        {:else if goal === "platinum" && top.platinum !== null}
          <span class="shrink-0 {TONE.quiet}">{plat(top.platinum)}</span>
        {/if}
      </span>
    {/if}
  </button>
{/snippet}

{#snippet packTile(goal: PackGoal, ranks: PackRank[] | null)}
  <div
    class="flex min-w-0 flex-col gap-1 rounded-[var(--radius-md)] border border-border p-2"
    data-vosfor-pack={HEADING[goal]}
  >
    <span class="{TILE_MICRO} {TONE.plain}">{$tr(HEADING[goal])}</span>
    {#if ranks && ranks.length > 0}
      <div class="flex flex-col">
        {#each ranks as rank (rank.collection)}
          {@render packLine(goal, rank)}
        {/each}
      </div>
    {:else}
      <span class="text-xs {TONE.plain}">{$tr("nextUp.vosforNoPick")}</span>
    {/if}
  </div>
{/snippet}

{#snippet dissolveTile(row: DissolveRow)}
  <ItemTile name={row.name} imageUrl={arcaneImage(row.name, $itemDb)} stretch>
    <span class={META}>
      <span class="text-text-primary"
        >{$tr("nextUp.vosforSpare", { count: row.spare.toLocaleString() })}</span
      >
      {#if row.platinum !== null}
        <span class={TONE.plain} aria-hidden="true">·</span>
        {@render price(row.name, row.platinum)}
      {/if}
    </span>
    <span class="{META} {TONE.good}"
      >{$tr("nextUp.vosforEach", { amount: row.yield.toLocaleString() })}</span
    >
  </ItemTile>
{/snippet}

<ModalShell ariaLabel={title} {onClose}>
  <div class="detail-panel w-[1180px] max-w-[95vw] p-4" data-vosfor-details>
    <div class="mb-3 flex items-start justify-between gap-2">
      <span class="flex min-w-0 items-center gap-2 pl-2">
        <h3 class="m-0 truncate font-display text-lg text-text-primary">{title}</h3>
        <span class="shrink-0"><WikiButton wikiUrl={VOSFOR_WIKI} fallbackName="Vosfor" /></span>
      </span>
      <button
        class="btn-secondary btn-sm !px-2"
        aria-label={$tr("common.close")}
        title={$tr("common.close")}
        onclick={onClose}>&times;</button
      >
    </div>

    {#if facts.length > 0}
      <div class="mb-3 flex flex-wrap gap-1.5">
        {#each facts as fact, index (index)}
          <span class="{CHIP} font-semibold {CHIP_TONE.plain}" title={fact.title}>{fact.value}</span
          >
        {/each}
      </div>
    {/if}

    <div class="flex gap-4">
      <div class="flex min-w-0 flex-1 flex-col gap-3">
        <div class="grid grid-cols-2 gap-2">
          {@render packTile("arcanes", summary.forArcanes)}
          {@render packTile("platinum", summary.forPlatinum)}
        </div>

        <div class="flex flex-col gap-1.5" data-vosfor-dissolve>
          <div class="flex items-center justify-between gap-2">
            <span class={LABEL}>{$tr("nextUp.vosforDissolve")}</span>
            <label
              class="flex cursor-pointer select-none items-center gap-1 whitespace-nowrap text-xs
                     text-text-secondary"
              title={$tr("nextUp.vosforKeepMaxTitle")}
            >
              <input
                type="checkbox"
                data-vosfor-keep-max
                checked={keepMax}
                onchange={(event) =>
                  setSuggestionOption("vosforKeepMax", event.currentTarget.checked)}
              />
              {$tr("nextUp.vosforKeepMax")}
            </label>
          </div>
          {#if dissolveRows.length > 0}
            <div class={TILE_GRID}>
              {#each dissolveShown as row (row.name)}
                {@render dissolveTile(row)}
              {/each}
            </div>
            {#if dissolveHidden > 0}
              <button
                class={MORE}
                aria-expanded={allDissolve}
                onclick={() => (allDissolve = !allDissolve)}
                >{allDissolve
                  ? $tr("nextUp.vosforRowsFewer")
                  : $tr("nextUp.vosforRowsMore", { count: String(dissolveHidden) })}</button
              >
            {/if}
          {:else}
            <p class="m-0 text-xs {TONE.plain}">{$tr("nextUp.vosforDissolveEmpty")}</p>
          {/if}
        </div>
      </div>

      <span
        class="relative flex w-48 shrink-0 items-start justify-center overflow-hidden
               rounded-[var(--radius-md)] bg-bg-deep p-2"
      >
        <ItemImage src={art} alt={title} cls="max-h-72 max-w-full" eager />
      </span>
    </div>
  </div>
</ModalShell>

<!-- A sibling, not a child, so the outer dialog's keydown and focus trap never
     see the inner one's events. -->
{#if openRank}
  <VosforPackModal
    rank={openRank.rank}
    headline={openRank.goal === "platinum"
      ? { text: perPack(openRank.rank.score), title: perPackTitle(openRank.rank.score) }
      : null}
    onClose={() => (openPack = null)}
  />
{/if}
