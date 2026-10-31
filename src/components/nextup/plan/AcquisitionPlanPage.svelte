<script lang="ts">
  import { tr, type MessageKey } from "../../../lib/i18n.js";
  import type {
    PlanBadgeTone,
    PlanFactKind,
    ResolvedPlan,
  } from "../../../lib/suggest/acquisition/plan/index.js";
  import { byStrength, tipsFor } from "../../../lib/suggest/acquisition/tips/data.js";
  import { itemDb } from "../../../stores/data.js";
  import FarmMapModal from "../../maps/FarmMapModal.svelte";
  import ItemImage from "../../ItemImage.svelte";
  import AcquisitionBody from "../AcquisitionBody.svelte";
  import TierBadge from "../TierBadge.svelte";
  import WikiButton from "../../WikiButton.svelte";
  import { tickPlanRows, withRowOverrides, type RowOverrides } from "./planResolution.js";
  import { planSteps, stepProgress, type PlanStepControls } from "./planSteps.js";

  interface Props {
    /** Null for an item nobody has written a plan for, which reads as unknown. */
    plan: ResolvedPlan | null;
    name: string;
    tier: string | null;
    /** The pinned item, which keys what the player ticked and roots the tree. */
    uniqueName: string;
    art: string | null;
    /** The card's own foundry read, for a plan that lists no materials. */
    buildable: boolean;
    onRefresh: () => void;
    onToggleDone: (rowId: string, done: boolean) => void;
    onTakeAlt: (rowId: string) => void;
  }

  const {
    plan: resolved,
    name,
    tier,
    uniqueName,
    art,
    buildable,
    onRefresh,
    onToggleDone,
    onTakeAlt,
  }: Props = $props();

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

  // Page-local so closing the plan, or keying it to another pin, drops them.
  let overrides = $state<RowOverrides>({});
  let openMap = $state<string | null>(null);

  const plan = $derived(resolved ? withRowOverrides(resolved, overrides) : null);

  const controls: PlanStepControls = {
    onToggleDone: (rowIds, done) => {
      if (resolved) overrides = tickPlanRows(resolved, overrides, rowIds, done, onToggleDone);
    },
    onTakeAlt: (rowId) => onTakeAlt(rowId),
    onOpenMap: (map) => (openMap = map),
  };

  const entry = $derived($itemDb[uniqueName] ?? null);
  // A blueprint has no recipe of its own; the tree roots at what it builds.
  const treeRoot = $derived.by((): string | null => {
    if (entry?.recipe) return uniqueName;
    const product = entry?.buildsProduct;
    return product && $itemDb[product]?.recipe ? product : null;
  });
  const tips = $derived(byStrength(tipsFor(name)));

  const progressText = $derived.by((): string => {
    if (!plan) return "";
    if (plan.progress.ready) return $tr("nextUp.planReady");
    return $tr("nextUp.planProgress", {
      have: plan.progress.have,
      need: plan.progress.need,
      unit: plan.progress.unit,
    });
  });
  // The pinned card counts the same steps, so the two always name the same one.
  const current = $derived(plan ? stepProgress(planSteps(plan, { t: $tr, buildable })) : null);
  // Once the quest has paid out, the route left is what the header rates.
  const rating = $derived(plan ? (plan.afterQuest ?? plan) : null);
  const effortLabel = $derived(rating ? $tr("nextUp.planEffort", { effort: rating.effort }) : "");
  const tradeable = $derived.by((): string | null => {
    if (plan?.tradeable === false) return $tr("nextUp.planNotTradeable");
    return typeof plan?.tradeable === "string" ? plan.tradeable : null;
  });
  /** The line under the name: what it costs, whether it trades, and the one or
   *  two shortcuts the badges name. Only the real-money cost is set apart. */
  const headNotes = $derived([
    ...(plan?.prices ?? []).map((price) => ({
      text: `${price.amount} ${price.label}`,
      tone: "",
      money: price.money,
    })),
    ...(tradeable ? [{ text: tradeable, tone: "", money: false }] : []),
    ...(rating?.badges ?? []).map((badge) => ({
      text: badge.text,
      tone: BADGE_TONE[badge.tone],
      money: false,
    })),
  ]);
  // A lone route still open is the header's own rating said twice.
  const routes = $derived.by(() => {
    const all = plan?.routes ?? [];
    return all.length > 1 || all.some((route) => route.ruledOut) ? all : [];
  });
  const unchecked = $derived(
    (plan?.unresolved ?? []).map((kind) => $tr(FACT_LABEL[kind])).join(", "),
  );
</script>

<!-- One column as wide as the details modal's, so both read the same body. -->
<div class="flex max-w-[640px] flex-col gap-0 pb-10">
  <div class="mb-[18px] mt-3 flex flex-wrap gap-[7px]">
    {#if plan}
      <button class={BUTTON} onclick={onRefresh}>{$tr("nextUp.planRefresh")}</button>
    {/if}
  </div>

  <div class="mb-1.5 flex items-start gap-3.5">
    <span
      class="flex h-[88px] w-[190px] shrink-0 items-center justify-center overflow-hidden
             rounded-[7px] bg-bg-deep"
    >
      <ItemImage src={art} alt={name} cls="max-h-[88px] max-w-[190px]" eager />
    </span>
    <div class="min-w-0">
      <div class="flex items-baseline gap-2">
        <span class="text-[1.3125rem] font-semibold leading-[1.15]">{name}</span>
        <TierBadge {tier} size="md" chip />
        <span class="shrink-0 self-center"><WikiButton fallbackName={name} /></span>
      </div>

      {#if plan}
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
                class="h-1 flex-1 rounded-[1px] {step <= (rating?.effort ?? 0)
                  ? effortFill(rating?.effort ?? 0)
                  : EFFORT_TRACK}"
              ></span>
            {/each}
          </span>
          <span class="text-xs {plan.progress.ready ? 'text-success' : 'text-text-secondary'}"
            >{progressText}</span
          >
          {#if current && current.total > 0}
            <span class="text-xs text-text-muted"
              >{$tr("nextUp.planStep", { step: current.step, total: current.total })}</span
            >
          {/if}
        </div>
      {/if}
    </div>
  </div>

  {#if routes.length > 0}
    <ul
      class="m-0 mb-1 mt-2 grid list-none grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-[7px] p-0"
      data-plan-routes
    >
      {#each routes as route, index (index)}
        <li
          class="flex flex-col gap-[3px] rounded-[var(--radius-sm)] border px-2 py-1.5
                 {route.current ? 'border-success' : 'border-border-subtle'}
                 {route.ruledOut ? 'opacity-[0.42]' : ''}"
          data-route-current={route.current}
          data-route-ruled-out={route.ruledOut}
        >
          <span class="text-xs font-semibold leading-tight text-text-primary">{route.name}</span>
          <div class="flex items-center gap-2">
            <span
              class="flex w-[52px] gap-[2px]"
              role="img"
              aria-label={$tr("nextUp.planEffort", { effort: route.effort })}
            >
              {#each EFFORT_STEPS as step (step)}
                <span
                  class="h-[3px] flex-1 rounded-[1px] {step <= route.effort
                    ? effortFill(route.effort)
                    : EFFORT_TRACK}"
                ></span>
              {/each}
            </span>
            {#if route.ruledOut}
              <span class="text-[0.6875rem] italic leading-none text-text-secondary"
                >{$tr("nextUp.planRouteQuestDone")}</span
              >
            {/if}
          </div>
          <span class="text-[0.6875rem] leading-snug text-text-secondary">{route.cost}</span>
        </li>
      {/each}
    </ul>
  {/if}

  <div class="mt-3">
    <AcquisitionBody {plan} root={treeRoot} {buildable} {tips} {controls} {unplanned} />
  </div>

  {#if unchecked}
    <p class="mt-3 text-xs text-text-muted">
      {$tr("nextUp.planUnchecked", { facts: unchecked })}
    </p>
  {/if}

  {#if plan && openMap}
    <FarmMapModal {plan} mapKey={openMap} onClose={() => (openMap = null)} />
  {/if}
</div>

{#snippet unplanned()}
  <div class="empty-state" data-plan-none>
    <p>{$tr("nextUp.planNone")}</p>
  </div>
{/snippet}
