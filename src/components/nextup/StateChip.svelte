<script lang="ts">
  import { tr } from "../../lib/i18n.js";
  import { STATE_CHIP, winChip, type ChipState } from "./chips.js";
  import type { ChoiceStatus } from "../../types/suggest.js";

  type Props = { state: ChipState; status?: never } | { status: ChoiceStatus; state?: never };

  const { state, status }: Props = $props();

  const chip = $derived(status ? winChip(status) : STATE_CHIP[state as ChipState]);
</script>

{#if chip}
  <span
    class="inline-flex shrink-0 items-center rounded-[var(--radius-sm)] border px-1.5 py-0.5
           font-display text-[0.625rem] font-semibold uppercase leading-none tracking-[0.08em]
           {chip.tone}">{$tr(chip.label)}</span
  >
{/if}
