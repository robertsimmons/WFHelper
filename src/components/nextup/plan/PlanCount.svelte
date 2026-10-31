<script lang="ts">
  import { formatNumber } from "../../../lib/format.js";
  import type { PlanCount } from "./planSteps.js";

  interface Props {
    count: PlanCount;
  }

  const { count }: Props = $props();

  // An unread balance has nothing to fill the bar with, so only the need shows.
  const fill = $derived(
    count.have === null
      ? null
      : count.need > 0
        ? Math.min(100, (count.have / count.need) * 100)
        : 100,
  );
</script>

<span class="inline-flex items-center gap-1.5 whitespace-nowrap align-middle" data-plan-count>
  {#if fill !== null}
    <span class="inline-block h-1.5 w-[72px] overflow-hidden rounded-sm bg-bg-raised">
      <i class="block h-full bg-success" style:width="{fill}%"></i>
    </span>
  {/if}
  <span class="tabular-nums text-text-primary"
    >{count.have === null ? "" : `${formatNumber(count.have)} / `}{formatNumber(count.need)}</span
  >
</span>
