<script lang="ts">
  import type { Snippet } from "svelte";

  import { formatBuildTime } from "../../lib/format.js";
  import { buildTotals } from "../../lib/suggest/acquisition/parts.js";
  import { tr } from "../../lib/i18n.js";
  import { itemLabel } from "../../lib/itemLabel.js";
  import { componentOwnership, itemDb } from "../../stores/data.js";
  import PlanSteps from "./plan/PlanSteps.svelte";
  import PlanTips from "./plan/PlanTips.svelte";
  import type { PlanStepControls } from "./plan/planSteps.js";
  import type { ItemTip, ResolvedPlan } from "../../lib/suggest/acquisition/plan/index.js";

  interface Props {
    plan: ResolvedPlan | null;
    /** The recipe the build totals read; null when there is nothing to walk. */
    root: string | null;
    /** Every tip for the item, read only when there is no plan to anchor them. */
    tips: readonly ItemTip[];
    /** Present on the plan page only. */
    controls?: PlanStepControls | undefined;
    /** What stands in for the steps when nobody planned the item. */
    unplanned?: Snippet | undefined;
    /** What a surface adds after the steps and before the tips. */
    extra?: Snippet | undefined;
    /** What a surface adds about the item, drawn in the first step's drawer. */
    lead?: Snippet | undefined;
  }

  const { plan, root, tips, controls, unplanned, extra, lead }: Props = $props();

  const LABEL = "text-xs font-semibold uppercase tracking-[0.08em] text-text-muted";
  const SUMMARY = `${LABEL} cursor-pointer list-none [&::-webkit-details-marker]:hidden`;
  const ROW = "flex items-baseline justify-between gap-3.5 py-px";

  // The foundry's own trees, sized to the builds the plan still owes.
  const build = $derived(
    buildTotals(
      plan?.builds.length ? plan.builds : root ? [root] : [],
      root,
      plan?.copies ?? 1,
      $itemDb,
      $componentOwnership,
    ),
  );

  const loose = $derived(plan ? plan.tips : tips.filter((tip) => tip.kind !== "sentiment"));
  const sentiment = $derived(
    plan ? plan.sentiment : tips.filter((tip) => tip.kind === "sentiment"),
  );
</script>

{#snippet totals()}
  {#if build}
    <ul class="m-0 list-none p-0" data-build-totals>
      <li class={ROW}>
        <span class="text-text-secondary">{$tr("common.credits")}</span>
        <span class="tabular-nums text-text-primary">{build.credits.toLocaleString("en-US")}</span>
      </li>
      <li class={ROW}>
        <span class="text-text-secondary">{$tr("nextUp.buildMinTime")}</span>
        <span class="tabular-nums text-text-primary">{formatBuildTime(build.minTime)}</span>
      </li>
      <li class={ROW}>
        <span class="text-text-secondary">{$tr("nextUp.buildMaxTime")}</span>
        <span class="tabular-nums text-text-primary">{formatBuildTime(build.maxTime)}</span>
      </li>
      {#if build.usedFor.length > 0}
        <li class={ROW} data-build-used-for>
          <span class="shrink-0 text-text-secondary">{$tr("nextUp.buildUsedFor")}</span>
          <span class="flex flex-wrap justify-end gap-x-[9px] text-text-primary">
            {#each build.usedFor as usage (usage.uniqueName)}
              <span>{itemLabel(usage)}</span>
            {/each}
          </span>
        </li>
      {/if}
    </ul>
  {/if}
{/snippet}

<div class="flex flex-col gap-3" data-acquisition-body>
  {#if plan}
    <PlanSteps {plan} {controls} {lead} totals={build ? totals : undefined} />
  {:else}
    {@render unplanned?.()}
    {@render lead?.()}
  {/if}

  {@render extra?.()}

  {#if loose.length > 0}
    <details data-details-tips>
      <summary class={SUMMARY}
        ><span class="mr-[7px] font-bold text-accent" aria-hidden="true">&rsaquo;</span>{$tr(
          "nextUp.planTips",
        )}</summary
      >
      <PlanTips tips={loose} split={false} />
    </details>
  {/if}

  {#if sentiment.length > 0}
    <details data-plan-sentiment>
      <summary class={SUMMARY}
        ><span class="mr-[7px] font-bold text-accent" aria-hidden="true">&rsaquo;</span>{$tr(
          "nextUp.planSentiment",
        )}</summary
      >
      <PlanTips tips={sentiment} split={false} />
    </details>
  {/if}
</div>
