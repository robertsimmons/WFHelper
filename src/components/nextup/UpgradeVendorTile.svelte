<script lang="ts">
  import { tr } from "../../lib/i18n.js";
  import {
    upgradeVendorCost,
    upgradeVendorCredits,
    upgradeVendorDetail,
    upgradeVendorHeader,
  } from "../../lib/suggest/upgrades.js";
  import type { UpgradeVendorSource } from "../../types/inventory.js";
  import { TONE } from "./chips.js";

  interface Props {
    vendor: UpgradeVendorSource;
  }

  const { vendor }: Props = $props();

  const HEAD =
    "min-w-0 flex-1 truncate font-display text-xs font-semibold uppercase tracking-[0.05em] " +
    "text-text-primary";
  const META = "flex min-w-0 items-baseline gap-x-3 gap-y-0.5 text-[0.6875rem] leading-tight";

  const header = $derived(upgradeVendorHeader(vendor, $tr));
  const detail = $derived(upgradeVendorDetail(vendor, $tr).join(" · "));
  const cost = $derived(
    [upgradeVendorCost(vendor, $tr), upgradeVendorCredits(vendor, $tr)].filter(Boolean).join(" + "),
  );
</script>

<div
  class="flex min-w-0 flex-col gap-0.5 rounded-[var(--radius-md)] border border-border px-2 py-1"
  title={(vendor.covers ?? []).join("\n")}
>
  <span class="flex min-w-0 items-center gap-2">
    <span class={HEAD}>{header}</span>
    {#if cost && !detail}
      <span class="shrink-0 text-[0.6875rem] font-semibold tabular-nums">{cost}</span>
    {/if}
  </span>
  {#if detail}
    <span class={META}>
      <span class="min-w-0 flex-1 truncate {TONE.quiet}">{detail}</span>
      {#if cost}<span class="shrink-0 font-semibold tabular-nums">{cost}</span>{/if}
    </span>
  {/if}
</div>
