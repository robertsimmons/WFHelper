<script lang="ts">
  import { tr } from "../../lib/i18n.js";
  import { timeLeftText } from "./chips.js";

  interface Props {
    expiry: string | null | undefined;
    nowMs: number;
  }

  const { expiry, nowMs }: Props = $props();

  const text = $derived(timeLeftText(expiry, nowMs));
</script>

{#if text}
  <span
    class="inline-flex shrink-0 items-center rounded-[var(--radius-sm)] border border-border
           bg-bg-deep/85 px-1.5 py-0.5 text-[0.625rem] font-semibold leading-none tabular-nums
           text-text-muted"
    title={$tr("nextUp.detailsTimeLeft")}>{text}</span
  >
{/if}
