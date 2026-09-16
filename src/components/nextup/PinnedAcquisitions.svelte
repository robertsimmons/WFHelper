<script lang="ts">
  import { tick } from "svelte";
  import { flip } from "svelte/animate";

  import { SOFT_ACQUISITION_PINS } from "../../stores/acquisitionPins.js";
  import { itemDb } from "../../stores/data.js";
  import { tr } from "../../lib/i18n.js";
  import { FLIGHT_MS, liftCard, pinnedNode, suggestionNode } from "./cardFlight.js";
  import { nextStep, type PinnedEntry } from "./pinnedAcquisitions.js";
  import { rewardArt } from "./rewardArt.js";
  import ItemImage from "../ItemImage.svelte";

  interface Props {
    entries: PinnedEntry[];
    onOpen: (entry: PinnedEntry) => void;
    onUnpin: (entry: PinnedEntry) => void;
  }

  const { entries, onOpen, onUnpin }: Props = $props();

  const over = $derived(entries.length > SOFT_ACQUISITION_PINS);

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

{#if entries.length > 0}
  <div class="flex flex-col gap-1">
    <div class="flex flex-wrap gap-2">
      {#each entries as entry (entry.uniqueName)}
        <div
          class="relative"
          data-acquisition-pin={entry.uniqueName}
          animate:flip={{ duration: FLIGHT_MS }}
        >
          <button
            class="flex w-64 cursor-pointer items-center gap-2 rounded-[var(--radius-md)] border
                   border-border bg-bg-surface py-1.5 pl-2 pr-6 text-left
                   transition-[border-color] duration-150 hover:border-accent"
            onclick={() => onOpen(entry)}
          >
            <span
              class="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden
                     rounded-[var(--radius-sm)] bg-bg-deep"
            >
              <ItemImage src={art(entry)} alt={name(entry)} cls="max-h-10 max-w-10" eager />
            </span>
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="min-w-0 truncate text-sm font-semibold text-text-primary"
                >{name(entry)}</span
              >
              {#if entry.steps && entry.steps.total > 0}
                <span class="text-[0.6875rem] leading-tight text-text-secondary"
                  >{$tr("nextUp.pinnedStepCount", {
                    step: nextStep(entry.steps),
                    total: entry.steps.total,
                  })}</span
                >
              {/if}
            </span>
          </button>
          <button
            class="absolute right-1 top-1 flex h-4 w-4 cursor-pointer items-center justify-center
                   rounded text-xs leading-none text-text-muted transition-colors duration-150
                   hover:text-text-primary"
            title={$tr("nextUp.unpinAcquisition")}
            aria-label={$tr("nextUp.unpinAcquisition")}
            onclick={() => unpin(entry)}>×</button
          >
        </div>
      {/each}
    </div>
    {#if over}
      <p class="m-0 text-[0.6875rem] leading-tight text-text-muted">
        {$tr("nextUp.acquisitionPinsOverCap", { count: entries.length })}
      </p>
    {/if}
  </div>
{/if}
