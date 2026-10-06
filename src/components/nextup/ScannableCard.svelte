<script lang="ts">
  import { CARD_HEIGHT } from "../../lib/suggest/grid.js";
  import type { ScannableEntry } from "../../lib/suggest/scannables.js";
  import { simulacrum } from "../../stores/simulacrum.js";
  import { TONE } from "./chips.js";
  import ItemImage from "../ItemImage.svelte";
  import WikiButton from "../WikiButton.svelte";

  interface Props {
    entry: ScannableEntry;
  }

  const { entry }: Props = $props();

  const ART_HEIGHT = CARD_HEIGHT / 2 - 24;
  const LINE = "flex h-4 min-w-0 items-center gap-2 text-xs leading-4";

  const art = $derived($simulacrum.enemyImage(entry.image));
  const progress = $derived(
    entry.required === null ? String(entry.scanned) : `${entry.scanned}/${entry.required}`,
  );
</script>

<div
  class="flex w-full flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border
         bg-bg-raised"
  style="height: {CARD_HEIGHT}px"
  data-suggestion-card="scannable"
  data-scannable={entry.type}
>
  <div
    class="relative flex w-full shrink-0 items-center justify-center overflow-hidden border-b
           border-border bg-bg-deep p-1.5"
    style="height: {ART_HEIGHT}px"
  >
    <ItemImage src={art} alt={entry.name} cls="max-h-full max-w-full" eager />
  </div>

  <div class="flex min-h-0 flex-1 flex-col gap-1 p-2">
    <h3
      class="m-0 flex h-6 min-w-0 items-center font-display text-sm font-medium leading-5
             text-text-primary"
      title={entry.name}
    >
      <span class="truncate">{entry.name}</span>
    </h3>

    <div class={LINE}>
      <span class="shrink-0 tabular-nums {TONE.quiet}">{progress}</span>
      {#if entry.planet}
        <span class="min-w-0 truncate text-text-primary" title={entry.planet}>{entry.planet}</span>
      {/if}
    </div>

    {#if entry.wiki}
      <div class="mt-auto flex h-6 items-center">
        <span class="-ml-1 flex [&>button]:h-6 [&>button]:px-1">
          <WikiButton wikiUrl={entry.wiki} fallbackName={entry.name} />
        </span>
      </div>
    {/if}
  </div>
</div>
