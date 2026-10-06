<script lang="ts">
  import { tr } from "../../lib/i18n.js";
  import type { SimulacrumGap } from "../../lib/suggest/simulacrum.js";
  import { isProbable } from "../../lib/suggest/simulacrumView.js";
  import { simulacrum } from "../../stores/simulacrum.js";
  import { CHIP_TONE, TILE_MICRO, TONE } from "./chips.js";
  import ItemTile from "./ItemTile.svelte";

  interface Props {
    gap: SimulacrumGap;
  }

  const { gap }: Props = $props();

  const BADGE = `rounded-[var(--radius-sm)] border px-1 py-0.5 ${TILE_MICRO}`;
</script>

<ItemTile name={gap.name} imageUrl={$simulacrum.enemyImage(gap.image)} stretch>
  {#snippet actions()}
    <span
      class="tabular-nums {TONE.quiet}"
      title={$tr("dailies.simarisScans", {
        scans: String(gap.scanned),
        required: String(gap.required),
      })}>{gap.scanned}/{gap.required}</span
    >
    {#if gap.eximus}
      <span class="{BADGE} {CHIP_TONE.warn}" title={$tr("nextUp.simEximus")}>EX</span>
    {/if}
    {#if isProbable(gap)}
      <span class={TONE.plain} title={$tr("nextUp.simProbable")}>?</span>
    {/if}
  {/snippet}
</ItemTile>
