<script lang="ts">
  import { tr } from "../../lib/i18n.js";
  import {
    partArt,
    relicArt,
    type RelicPart,
    type RelicPayout,
    type VarziaRelic,
  } from "../../lib/suggest/relicPacks.js";
  import { itemDb } from "../../stores/data.js";
  import { CHIP_TONE, TONE, type TileStatus } from "./chips.js";
  import ItemTile from "./ItemTile.svelte";
  import ModalShell from "../ModalShell.svelte";
  import WikiButton from "../WikiButton.svelte";

  interface Props {
    title: string;
    /** Header facts, already formatted. */
    facts: { text: string; title: string; dim?: boolean }[];
    rows: readonly (RelicPayout | VarziaRelic)[];
    /** Every drop, the ones not needed dimmed; otherwise only the needed ones. */
    allParts?: boolean;
    wikiUrl: string;
    onClose: () => void;
  }

  const { title, facts, rows, allParts = false, wikiUrl, onClose }: Props = $props();

  const CHIP = "rounded-[var(--radius-sm)] border border-border px-1.5 py-0.5 text-[0.6875rem]";

  /** Needed goes unsaid where only needed parts are listed. */
  function partStatus(part: RelicPart): TileStatus | null {
    if (part.status === "owned" || part.status === "mastered") {
      return { kind: part.status, count: part.ownedCount };
    }
    return allParts && part.status === "needed" ? { kind: "needed" } : null;
  }

  function ayaCost(row: RelicPayout | VarziaRelic): string[] | null {
    if (!("aya" in row) || row.aya === null) return null;
    return [$tr("nextUp.relicPackAya", { count: String(row.aya) })];
  }

  function partsOf(row: RelicPayout): RelicPart[] {
    return allParts ? row.parts : row.parts.filter((part) => part.status === "needed");
  }
</script>

<ModalShell ariaLabel={title} {onClose}>
  <div class="detail-panel w-[960px] max-w-[95vw] p-4" data-relic-payout-details>
    <div class="mb-3 flex items-start justify-between gap-2">
      <span class="flex min-w-0 flex-wrap items-center gap-2 pl-2">
        <h3 class="m-0 truncate font-display text-lg text-text-primary">{title}</h3>
        {#each facts as fact, index (index)}
          <span
            class="shrink-0 {CHIP} font-semibold tabular-nums {CHIP_TONE.plain}
                   {fact.dim ? 'opacity-45' : ''}"
            title={fact.title}>{fact.text}</span
          >
        {/each}
        <span class="shrink-0"><WikiButton {wikiUrl} fallbackName={title} /></span>
      </span>
      <button
        class="btn-secondary btn-sm !px-2"
        aria-label={$tr("common.close")}
        title={$tr("common.close")}
        onclick={onClose}>&times;</button
      >
    </div>

    {#if rows.length > 0}
      <div class="flex flex-col gap-2">
        {#each rows as row (row.key)}
          <div class="flex min-w-0 items-start gap-2" data-relic-payout-row={row.name}>
            <span class="w-52 shrink-0">
              <ItemTile
                name={row.name}
                imageUrl={relicArt(row)}
                owned={{ owned: row.held }}
                cost={ayaCost(row)}
                stretch
              />
            </span>
            <div class="grid min-w-0 flex-1 grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-2">
              {#each partsOf(row) as part (part.name)}
                <ItemTile
                  name={part.name}
                  imageUrl={partArt($itemDb, part)}
                  rarity={part.rarity}
                  status={partStatus(part)}
                  stretch
                />
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <p class="m-0 text-xs {TONE.plain}">{$tr("nextUp.relicPackNoPick")}</p>
    {/if}
  </div>
</ModalShell>
