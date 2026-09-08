<script lang="ts">
  import { tr } from "../../lib/i18n.js";
  import { STATE_CHIP, type ChipState } from "./chips.js";

  interface Props {
    state: ChipState;
  }

  const { state }: Props = $props();

  const chip = $derived(STATE_CHIP[state]);
</script>

<span
  class="inline-flex shrink-0 items-center rounded-[var(--radius-sm)] border px-1.5 py-0.5
         font-display text-[0.625rem] font-semibold uppercase leading-none tracking-[0.08em]
         {chip.tone}">{$tr(chip.label)}</span
>
