<script lang="ts">
  import { buildCraftingTree } from "../../../lib/craftingTree.js";
  import { tr, type MessageKey } from "../../../lib/i18n.js";
  import type {
    PlanBadgeTone,
    PlanFactKind,
    ResolvedPlan,
  } from "../../../lib/suggest/acquisition/plan/index.js";
  import { componentOwnership, itemDb } from "../../../stores/data.js";
  import CraftingTree from "../../CraftingTree.svelte";
  import ItemImage from "../../ItemImage.svelte";
  import TierBadge from "../TierBadge.svelte";
  import PlanGroup from "./PlanGroup.svelte";
  import { visibleGroups } from "./planResolution.js";

  interface Props {
    plan: ResolvedPlan;
    /** The pinned item, which keys what the player ticked and roots the tree. */
    uniqueName: string;
    art: string | null;
    onRefresh: () => void;
    onToggleDone: (rowId: string, done: boolean) => void;
    onTakeAlt: (rowId: string) => void;
  }

  const { plan, uniqueName, art, onRefresh, onToggleDone, onTakeAlt }: Props = $props();

  const BUTTON =
    "cursor-pointer rounded-[var(--radius-sm)] border border-border bg-bg-raised px-2 py-1 " +
    "text-xs text-text-secondary transition-[border-color,color] duration-150 " +
    "hover:border-accent hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40";

  const BADGE_TONE: Record<PlanBadgeTone, string> = {
    circuit: "text-accent",
    info: "text-info",
    warn: "text-warning",
  };

  /** What the app could not check live, named so an authored figure is never
   *  mistaken for a current one. */
  const FACT_LABEL: Record<PlanFactKind, MessageKey> = {
    fissure: "nextUp.planFactFissure",
    bounty: "nextUp.planFactBounty",
    varzia: "nextUp.planFactVarzia",
    standing: "nextUp.planFactStanding",
    foundry: "nextUp.planFactFoundry",
    relics: "nextUp.planFactRelics",
    overlay: "nextUp.planFactOverlay",
  };

  const EFFORT_STEPS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  const EFFORT_TRACK = "bg-[color:var(--effort-track)]";

  function effortFill(effort: number): string {
    if (effort <= 3) return "bg-[color:var(--effort-light)]";
    if (effort <= 5) return "bg-[color:var(--effort-fair)]";
    if (effort <= 7) return "bg-[color:var(--effort-heavy)]";
    return "bg-[color:var(--effort-grim)]";
  }

  let showTree = $state(false);
  let showDone = $state(false);

  const entry = $derived($itemDb[uniqueName] ?? null);
  // A blueprint has no recipe of its own; the tree roots at what it builds.
  const treeRoot = $derived.by((): string | null => {
    if (entry?.recipe) return uniqueName;
    const product = entry?.buildsProduct;
    return product && $itemDb[product]?.recipe ? product : null;
  });
  const tree = $derived(
    showTree && treeRoot ? buildCraftingTree(treeRoot, $itemDb, $componentOwnership) : null,
  );

  const progressText = $derived(
    plan.progress.ready
      ? $tr("nextUp.planReady")
      : $tr("nextUp.planProgress", {
          have: plan.progress.have,
          need: plan.progress.need,
          unit: plan.progress.unit,
        }),
  );
  const effortLabel = $derived($tr("nextUp.planEffort", { effort: plan.effort }));
  const tradeable = $derived.by((): string | null => {
    if (plan.tradeable === false) return $tr("nextUp.planNotTradeable");
    return typeof plan.tradeable === "string" ? plan.tradeable : null;
  });
  /** The line under the name: what it costs, whether it trades, and the one or
   *  two shortcuts the badges name. Only the real-money cost is set apart. */
  const headNotes = $derived([
    ...plan.prices.map((price) => ({
      text: `${price.amount} ${price.label}`,
      tone: "",
      money: price.money,
    })),
    ...(tradeable ? [{ text: tradeable, tone: "", money: false }] : []),
    ...plan.badges.map((badge) => ({
      text: badge.text,
      tone: BADGE_TONE[badge.tone],
      money: false,
    })),
  ]);
  const groups = $derived(visibleGroups(plan, showDone));
  const unchecked = $derived(plan.unresolved.map((kind) => $tr(FACT_LABEL[kind])).join(", "));
</script>

<div class="flex flex-col gap-0 pb-10">
  <div class="mb-[18px] mt-3 flex flex-wrap gap-[7px]">
    <button class={BUTTON} onclick={onRefresh}>{$tr("nextUp.planRefresh")}</button>
    <button
      class={BUTTON}
      disabled={treeRoot === null}
      aria-pressed={showTree}
      onclick={() => (showTree = !showTree)}
      >{$tr(showTree ? "nextUp.planHideTree" : "nextUp.planShowTree")}</button
    >
    <button class={BUTTON} aria-pressed={showDone} onclick={() => (showDone = !showDone)}
      >{$tr(showDone ? "nextUp.planHideDone" : "nextUp.planShowDone")}</button
    >
  </div>

  <div class="mb-1.5 flex items-start gap-3.5">
    <span
      class="flex h-[88px] w-[190px] shrink-0 items-center justify-center overflow-hidden
             rounded-[7px] bg-bg-deep"
    >
      <ItemImage src={art} alt={plan.name} cls="max-h-[88px] max-w-[190px]" eager />
    </span>
    <div class="min-w-0">
      <div class="flex items-baseline gap-2">
        <span class="text-[1.3125rem] font-semibold leading-[1.15]">{plan.name}</span>
        <TierBadge tier={plan.tier} size="md" chip />
      </div>

      <div class="mt-[5px] flex flex-wrap items-center gap-[7px] text-xs text-text-secondary">
        {#each headNotes as note, index (index)}
          {#if index > 0}
            <span class="opacity-40" aria-hidden="true">·</span>
          {/if}
          {#if note.money}
            <span
              class="rounded-[var(--radius-sm)] border border-warning/60 px-1.5 py-px text-warning"
              >{note.text}</span
            >
          {:else}
            <span class={note.tone}>{note.text}</span>
          {/if}
        {/each}
      </div>

      <div class="mt-[7px] flex items-center gap-2.5">
        <span class="flex w-[104px] gap-[2px]" role="img" aria-label={effortLabel}>
          {#each EFFORT_STEPS as step (step)}
            <span
              class="h-1 flex-1 rounded-[1px] {step <= plan.effort
                ? effortFill(plan.effort)
                : EFFORT_TRACK}"
            ></span>
          {/each}
        </span>
        <span class="text-xs {plan.progress.ready ? 'text-success' : 'text-text-secondary'}"
          >{progressText}</span
        >
        {#if plan.steps.total > 0}
          <span class="text-xs text-text-muted"
            >{$tr("nextUp.planStep", {
              step: Math.min(plan.steps.done + 1, plan.steps.total),
              total: plan.steps.total,
            })}</span
          >
        {/if}
      </div>
    </div>
  </div>

  {#if showTree && tree}
    <div class="mb-3 h-[420px] overflow-hidden rounded-[var(--radius-md)] border border-border">
      <CraftingTree {tree} />
    </div>
  {/if}

  {#each groups as group (group.id)}
    <PlanGroup {group} {showDone} {onToggleDone} {onTakeAlt} />
  {/each}

  {#if plan.ledger.length > 0}
    <div class="mt-4 border-t border-border-subtle pt-3">
      <h3 class="m-0 mb-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-text-secondary">
        {$tr("nextUp.planCurrency")}
      </h3>
      <ul class="m-0 list-none p-0 text-xs">
        {#each plan.ledger as line, index (index)}
          <li class="flex items-baseline gap-[9px] py-px">
            <span class="min-w-[13rem] text-text-primary">{line.currency}</span>
            {#if line.earned !== null}
              <span class="tabular-nums text-text-muted"
                >{$tr("nextUp.planBanked", { amount: line.earned.toLocaleString("en-US") })}</span
              >
            {/if}
            <span class="tabular-nums text-text-muted"
              >{$tr("nextUp.planToSpend", { amount: line.spent.toLocaleString("en-US") })}</span
            >
            <span class="tabular-nums text-accent"
              >{$tr("nextUp.planOutstanding", {
                amount: line.outstanding.toLocaleString("en-US"),
              })}</span
            >
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if plan.unresolved.length > 0}
    <p class="mt-3 text-xs text-text-muted">
      {$tr("nextUp.planUnchecked", { facts: unchecked })}
    </p>
  {/if}

  {#if !plan.authored}
    <p class="mt-1.5 text-xs text-text-muted">{$tr("nextUp.planDerived")}</p>
  {/if}
</div>
