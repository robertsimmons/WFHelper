<script lang="ts">
  import { tr } from "../../lib/i18n.js";
  import { timeLeftText, TONE } from "./chips.js";

  interface Props {
    expiry: string | null | undefined;
    nowMs: number;
    /** Hold the slot on a card with no window, so the row below it never shifts. */
    reserve?: boolean;
  }

  const { expiry, nowMs, reserve = false }: Props = $props();

  const text = $derived(timeLeftText(expiry, nowMs));
</script>

{#if text}
  <span
    class="inline-flex min-h-4 shrink-0 items-center rounded-[var(--radius-sm)] border
           border-border bg-bg-deep/85 px-1.5 py-0.5 text-[0.625rem] font-semibold leading-none
           tabular-nums {TONE.plain}"
    title={$tr("nextUp.detailsTimeLeft")}>{text}</span
  >
{:else if reserve}
  <!-- No window to report, and the box still has to hold its line. -->
  <span class="inline-flex min-h-4 min-w-8 shrink-0 py-0.5" aria-hidden="true"></span>
{/if}
