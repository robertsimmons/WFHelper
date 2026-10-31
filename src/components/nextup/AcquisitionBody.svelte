<script lang="ts">
  import type { Snippet } from "svelte";

  import { buildCraftingTree, computeCraftingSummary } from "../../lib/craftingTree.js";
  import { formatBuildTime } from "../../lib/format.js";
  import { tr } from "../../lib/i18n.js";
  import { itemLabel } from "../../lib/itemLabel.js";
  import { componentOwnership, itemDb } from "../../stores/data.js";
  import AcquisitionTree from "./AcquisitionTree.svelte";
  import PlanSteps from "./plan/PlanSteps.svelte";
  import PlanTips from "./plan/PlanTips.svelte";
  import type { PlanStepControls } from "./plan/planSteps.js";
  import type { ItemTip, ResolvedPlan } from "../../lib/suggest/acquisition/plan/index.js";

  interface Props {
    plan: ResolvedPlan | null;
    /** The recipe the parts hang off; null when there is nothing to walk. */
    root: string | null;
    buildable: boolean;
    /** Every tip for the item, read only when there is no plan to anchor them. */
    tips: readonly ItemTip[];
    /** Present on the plan page only. */
    controls?: PlanStepControls | undefined;
    /** What stands in for the steps when nobody planned the item. */
    unplanned?: Snippet | undefined;
    /** What a surface adds after the parts and before the tips. */
    extra?: Snippet | undefined;
  }

  const { plan, root, buildable, tips, controls, unplanned, extra }: Props = $props();

  const LABEL = "text-xs font-semibold uppercase tracking-[0.08em] text-text-muted";
  const SUMMARY = `${LABEL} cursor-pointer list-none [&::-webkit-details-marker]:hidden`;

  // The foundry's own tree, so the totals match the crafting tree screen's.
  const build = $derived.by(() => {
    const tree = root ? buildCraftingTree(root, $itemDb, $componentOwnership) : null;
    return tree ? { summary: computeCraftingSummary(tree), usedFor: tree.usedFor } : null;
  });

  const loose = $derived(plan ? plan.tips : tips.filter((tip) => tip.kind !== "sentiment"));
  const sentiment = $derived(
    plan ? plan.sentiment : tips.filter((tip) => tip.kind === "sentiment"),
  );
</script>

<div class="flex flex-col gap-3" data-acquisition-body>
  {#if plan}
    <PlanSteps {plan} {buildable} {controls} />
  {:else}
    {@render unplanned?.()}
  {/if}

  {#if root}
    <AcquisitionTree {root} {plan} />
  {/if}

  {#if build}
    <details class="text-xs" data-build-totals>
      <summary class={SUMMARY}
        ><span class="mr-[7px] font-bold text-accent" aria-hidden="true">&rsaquo;</span>{$tr(
          "nextUp.buildTotals",
        )}</summary
      >
      <ul class="m-0 ml-[15px] mt-[5px] list-none p-0">
        <li class="flex items-baseline justify-between gap-3.5 py-px">
          <span class="text-text-secondary">{$tr("common.credits")}</span>
          <span class="tabular-nums text-text-primary"
            >{build.summary.totalCredits.toLocaleString("en-US")}</span
          >
        </li>
        <li class="flex items-baseline justify-between gap-3.5 py-px">
          <span class="text-text-secondary">{$tr("nextUp.buildMinTime")}</span>
          <span class="tabular-nums text-text-primary"
            >{formatBuildTime(build.summary.minBuildTime)}</span
          >
        </li>
        <li class="flex items-baseline justify-between gap-3.5 py-px">
          <span class="text-text-secondary">{$tr("nextUp.buildMaxTime")}</span>
          <span class="tabular-nums text-text-primary"
            >{formatBuildTime(build.summary.maxBuildTime)}</span
          >
        </li>
        {#if build.usedFor.length > 0}
          <li class="flex items-baseline justify-between gap-3.5 py-px" data-build-used-for>
            <span class="shrink-0 text-text-secondary">{$tr("nextUp.buildUsedFor")}</span>
            <span class="flex flex-wrap justify-end gap-x-[9px] text-text-primary">
              {#each build.usedFor as usage (usage.uniqueName)}
                <span>{itemLabel(usage)}</span>
              {/each}
            </span>
          </li>
        {/if}
      </ul>
    </details>
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
