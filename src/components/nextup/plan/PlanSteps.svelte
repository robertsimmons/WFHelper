<script lang="ts">
  import type { Snippet } from "svelte";

  import { tr, type MessageKey } from "../../../lib/i18n.js";
  import FarmMapModal from "../../maps/FarmMapModal.svelte";
  import StepDrawer from "./StepDrawer.svelte";
  import StepLine from "./StepLine.svelte";
  import StepTitle from "./StepTitle.svelte";
  import {
    planSteps,
    type PlanLine,
    type PlanSectionKey,
    type PlanStepControls,
  } from "./planSteps.js";
  import type { ResolvedPlan } from "../../../lib/suggest/acquisition/plan/index.js";

  interface Props {
    plan: ResolvedPlan;
    /** The plan page's ticks and alternatives; maps and shop picks work everywhere. */
    controls?: PlanStepControls | undefined;
    /** The foundry's totals, drawn in a Build line's drawer. */
    totals?: Snippet | undefined;
    /** What the surface adds about the item, drawn in the first step's drawer. */
    lead?: Snippet | undefined;
  }

  const { plan, controls, totals, lead }: Props = $props();

  const SECTION: Record<PlanSectionKey, MessageKey> = {
    get: "nextUp.sectionGet",
    farm: "nextUp.sectionFarm",
    build: "nextUp.sectionBuild",
  };
  const BOX = "relative top-[3px] inline-block h-4 w-4 rounded-[3px] border border-text-muted";

  const model = $derived(planSteps(plan, { t: $tr }));

  let openId = $state<string | null>(null);
  let showDone = $state(false);
  let openMap = $state<string | null>(null);

  const onOpenMap = (map: string): void => {
    openMap = map;
  };

  const toggle = (id: string): void => {
    openId = openId === id ? null : id;
  };
</script>

{#snippet line(entry: PlanLine)}
  <StepLine
    {entry}
    {controls}
    {onOpenMap}
    open={openId === entry.id}
    onToggle={() => toggle(entry.id)}
  />
  {#if openId === entry.id}
    <StepDrawer {entry} shop={model.shop} {controls} {onOpenMap} {totals} {lead} />
  {/if}
{/snippet}

<div class="flex flex-col gap-4 text-sm" data-plan-steps>
  {#each model.sections as section, index (section.key)}
    <section class="flex flex-col" data-plan-section={section.key}>
      <h4 class="m-0 mb-1.5 flex items-baseline gap-2.5 text-sm font-semibold text-text-primary">
        <span class="text-accent">{index + 1}</span>{$tr(SECTION[section.key])}
      </h4>
      {#each section.entries as entry (entry.id)}
        {#if entry.kind === "trip"}
          {@const selected = entry.lines.find((tripLine) => tripLine.id === openId)}
          <div
            class="grid grid-cols-[24px_minmax(0,1fr)] items-baseline gap-2.5 rounded-[var(--radius-md)] px-2 py-1
                   {entry.next ? 'bg-accent/5 shadow-[inset_3px_0_0_var(--color-accent)]' : ''}"
            data-plan-trip={entry.place}
            data-plan-next={entry.next || undefined}
          >
            <span class={BOX}></span>
            <span class="flex flex-wrap items-baseline gap-x-1 gap-y-1">
              {#if entry.next}<span
                  class="mr-1.5 text-[0.6875rem] uppercase tracking-[0.08em] text-accent"
                  >{$tr("nextUp.lineNext")}</span
                >{/if}
              <span class="mr-2 text-text-primary">{entry.place}</span>
              {#each entry.lines as tripLine (tripLine.id)}
                <span
                  class="cursor-pointer rounded-[var(--radius-sm)] bg-bg-raised px-2 text-text-secondary hover:bg-bg-surface
                         {tripLine.id === openId || tripLine.next
                    ? 'outline outline-1 outline-accent'
                    : ''}
                         {tripLine.next ? 'text-text-primary' : ''}
                         {tripLine.blocked ? 'opacity-50' : ''}"
                  role="button"
                  tabindex="0"
                  aria-expanded={tripLine.id === openId}
                  data-plan-trip-chip={tripLine.kind}
                  onclick={() => toggle(tripLine.id)}
                  onkeydown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      toggle(tripLine.id);
                    }
                  }}><StepTitle entry={tripLine} {onOpenMap} /></span
                >
              {/each}
            </span>
          </div>
          {#if selected}
            <StepDrawer entry={selected} shop={model.shop} {controls} {onOpenMap} {totals} {lead} />
          {/if}
        {:else}
          {@render line(entry)}
        {/if}
      {/each}
    </section>
  {:else}
    <span class="text-text-muted" data-plan-all-done>{$tr("nextUp.planAllDone")}</span>
  {/each}

  {#if model.done.length > 0}
    <div class="flex flex-col" data-plan-done>
      <button
        type="button"
        class="w-fit cursor-pointer rounded-[var(--radius-md)] px-2 py-0.5 text-text-muted hover:bg-bg-raised"
        aria-expanded={showDone}
        onclick={() => (showDone = !showDone)}
        >{showDone ? "▾" : "▸"} {$tr("nextUp.linesDone", { count: model.done.length })}</button
      >
      {#if showDone}
        {#each model.done as entry (entry.id)}
          {@render line(entry)}
        {/each}
      {/if}
    </div>
  {/if}
</div>

{#if openMap}
  <FarmMapModal {plan} mapKey={openMap} onClose={() => (openMap = null)} />
{/if}
