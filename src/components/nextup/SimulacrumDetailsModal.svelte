<script lang="ts">
  import { tr } from "../../lib/i18n.js";
  import type { SimulacrumCard, SimulacrumGap, SimulacrumStop } from "../../lib/suggest/simulacrum.js";
  import { nodeWhere, stopLabel, stopProgress } from "../../lib/suggest/simulacrumView.js";
  import { CHIP_TONE, TONE } from "./chips.js";
  import SimulacrumGapTile from "./SimulacrumGapTile.svelte";
  import ModalShell from "../ModalShell.svelte";
  import WikiButton from "../WikiButton.svelte";

  interface Props {
    card: SimulacrumCard;
    title: string;
    onClose: () => void;
  }

  const { card, title, onClose }: Props = $props();

  const WIKI = "https://wiki.warframe.com/w/Simulacrum";
  const CHIP = "rounded-[var(--radius-sm)] border border-border px-1.5 py-0.5 text-[0.6875rem]";
  const GRID = "grid min-w-0 grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-2";

  const facts = $derived([
    $tr("nextUp.simUnlocks", { count: String(card.unlocks) }),
    $tr("nextUp.simScanCount", { count: String(card.scans) }),
  ]);

  const nodeText = (node: SimulacrumStop["node"]): string =>
    `${nodeWhere(node)} · ${node.missionType}`;

  const alphabetical = (gaps: readonly SimulacrumGap[]): SimulacrumGap[] =>
    [...gaps].sort((a, b) => a.name.localeCompare(b.name));

  function progressText(stop: SimulacrumStop): string {
    const { enemies, scans } = stopProgress(stop);
    const enemyText = $tr("nextUp.simEnemyCount", { count: String(enemies) });
    return `${enemyText} · ${$tr("nextUp.simScanCount", { count: String(scans) })}`;
  }
</script>

<ModalShell ariaLabel={title} {onClose}>
  <div class="detail-panel w-[960px] max-w-[95vw] p-4" data-simulacrum-details={card.key}>
    <div class="mb-3 flex items-start justify-between gap-2">
      <span class="flex min-w-0 flex-wrap items-center gap-2 pl-2">
        <h3 class="m-0 truncate font-display text-lg text-text-primary">{title}</h3>
        {#each facts as fact (fact)}
          <span class="shrink-0 {CHIP} font-semibold tabular-nums {CHIP_TONE.plain}">{fact}</span>
        {/each}
        <span class="shrink-0"><WikiButton wikiUrl={WIKI} fallbackName="Simulacrum" /></span>
      </span>
      <button
        class="btn-secondary btn-sm !px-2"
        aria-label={$tr("common.close")}
        title={$tr("common.close")}
        onclick={onClose}>&times;</button
      >
    </div>

    <div class="flex flex-col gap-3">
      {#each card.stops as stop, index (stop.node.key)}
        {@const [where, what] = stopLabel(card, stop)}
        <div class="flex min-w-0 items-start gap-2" data-simulacrum-stop={index + 1}>
          <div class="flex w-52 shrink-0 flex-col gap-1 pl-2">
            <span class="flex min-w-0 items-baseline gap-1 text-sm">
              <span class="shrink-0 font-display font-semibold text-accent">{index + 1}</span>
              <span class="min-w-0 truncate text-text-primary" title="{where} · {what}"
                >{where} · <span class={TONE.quiet}>{what}</span></span
              >
            </span>
            <span class="pl-3 text-xs tabular-nums {TONE.quiet}" data-simulacrum-stop-progress
              >{progressText(stop)}</span
            >
            {#if stop.alternatives.length > 0}
              <span
                class="flex flex-wrap gap-1 pl-3"
                title={$tr("nextUp.simAlternativesTitle")}
                data-simulacrum-alternatives
              >
                {#each stop.alternatives as node (node.key)}
                  <span class="{CHIP} leading-none {CHIP_TONE.plain}">{nodeText(node)}</span>
                {/each}
              </span>
            {/if}
          </div>
          <div class="min-w-0 flex-1 {GRID}">
            {#each alphabetical([...stop.gaps, ...stop.regulars]) as gap (gap.type)}
              <SimulacrumGapTile {gap} />
            {/each}
          </div>
        </div>
      {/each}

      {#if card.gaps.length > 0}
        <div class="flex min-w-0 flex-col gap-2">
          {#if card.kind === "steelPath"}
            <span class="pl-2 text-sm {TONE.quiet}">{$tr("nextUp.simAnySteelPath")}</span>
          {/if}
          <div class={GRID}>
            {#each alphabetical(card.gaps) as gap (gap.type)}
              <SimulacrumGapTile {gap} />
            {/each}
          </div>
        </div>
      {/if}
    </div>
  </div>
</ModalShell>
