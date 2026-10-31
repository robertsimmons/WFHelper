<script lang="ts">
  import { formatNumber } from "../../../lib/format.js";
  import { tr } from "../../../lib/i18n.js";
  import PlanTips from "./PlanTips.svelte";
  import { planSteps, type PlanStepControls, type PlanStepState } from "./planSteps.js";
  import type { PlanLiveState, ResolvedPlan } from "../../../lib/suggest/acquisition/plan/index.js";

  interface Props {
    plan: ResolvedPlan;
    /** The card's own foundry read, for a plan that lists no materials. */
    buildable: boolean;
    /** The plan page's ticks, alternatives and maps; without them the steps only read. */
    controls?: PlanStepControls | undefined;
  }

  const { plan, buildable, controls }: Props = $props();

  const LIVE_TONE: Record<PlanLiveState, string> = {
    open: "text-success",
    blocked: "text-danger",
    waiting: "text-warning",
  };

  const TAG_TONE = {
    done: "text-success",
    warn: "text-warning",
    none: "text-text-muted",
  } as const;

  const SUMMARY = "cursor-pointer list-none text-accent [&::-webkit-details-marker]:hidden";
  const BOX = "relative top-[2px] h-[13px] w-[13px] shrink-0 rounded-[3px] border cursor-pointer";
  const MAP =
    "rounded-[3px] border border-border-subtle px-1.5 py-px text-[0.6875rem] " +
    "transition-[border-color,color] duration-150";

  const steps = $derived(planSteps(plan, { t: $tr, buildable }));

  function boxFill(done: boolean): string {
    return done ? "border-success bg-success" : "border-text-muted hover:border-accent";
  }

  function stateText(state: PlanStepState): string {
    switch (state.kind) {
      case "done":
        return $tr("nextUp.stepDone");
      case "ready":
        return $tr("nextUp.stepReady");
      case "live":
        return state.text;
      case "count": {
        const need = formatNumber(state.need);
        const count = state.have === null ? need : `${formatNumber(state.have)} / ${need}`;
        return state.label ? `${state.label} ${count}` : count;
      }
    }
  }

  function stateTone(state: PlanStepState): string {
    if (state.kind === "live") return LIVE_TONE[state.tone];
    if (state.kind === "count") {
      return state.have !== null && state.have >= state.need
        ? "text-success"
        : "text-text-secondary";
    }
    return "text-success";
  }
</script>

<div class="flex flex-col gap-1.5" data-plan-steps>
  <span class="text-xs font-semibold uppercase tracking-[0.1em] text-text-secondary"
    >{$tr("nextUp.steps")}</span
  >
  <ol class="m-0 flex list-none flex-col gap-2 p-0">
    {#each steps as step, index (step.id)}
      {@const ticks = controls && step.skip === null ? controls : null}
      <li
        class="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-1.5 {step.done ? 'opacity-[0.42]' : ''}"
        data-step={step.id}
        data-step-done={step.done}
      >
        <span class="text-[0.8125rem] tabular-nums text-text-muted">{index + 1}</span>
        <div class="min-w-0">
          <div class="flex items-baseline justify-between gap-3.5">
            <span class="flex min-w-0 items-baseline gap-[9px]">
              {#if ticks && step.folded?.rows.length === 1}
                {@const only = step.folded.rows[0]}
                <button
                  class="{BOX} {boxFill(only.done)}"
                  aria-pressed={only.done}
                  aria-label={$tr("nextUp.planMarkDone", { label: step.title })}
                  data-step-tick
                  onclick={() => ticks.onToggleDone([only.id], !only.done)}
                ></button>
              {/if}
              <span class="min-w-0 text-[0.8125rem] text-text-primary">{step.title}</span>
            </span>
            {#if step.state}
              <span class="whitespace-nowrap text-xs tabular-nums {stateTone(step.state)}"
                >{stateText(step.state)}</span
              >
            {/if}
          </div>

          {#if step.where || step.skip || step.tags.length > 0 || (controls && step.map)}
            <div class="mt-[3px] flex flex-wrap gap-[9px] text-xs text-text-muted">
              {#if step.where}
                <span class="text-text-secondary">{step.where}</span>
              {/if}
              {#if step.skip}
                <span class="italic text-text-secondary">{step.skip}</span>
              {/if}
              {#each step.tags as tag, tagIndex (tagIndex)}
                <span>{tag}</span>
              {/each}
              {#if controls && step.map}
                {@const map = step.map.key}
                {#if step.map.ready}
                  <button
                    class="{MAP} cursor-pointer text-text-secondary hover:border-accent hover:text-text-primary"
                    title={$tr("nextUp.planMapOpen", { map })}
                    data-plan-map={map}
                    onclick={() => controls.onOpenMap(map)}>{$tr("nextUp.planMap")}</button
                  >
                {:else}
                  <button
                    class="{MAP} cursor-not-allowed text-text-muted"
                    disabled
                    title={$tr("nextUp.planMapMissing", { map })}>{$tr("nextUp.planMap")}</button
                  >
                {/if}
              {/if}
            </div>
          {/if}

          <!-- The title already names these rows; only the page needs them one by one. -->
          {#if ticks && step.folded && step.folded.rows.length > 1}
            <ul class="m-0 mt-1 list-none p-0">
              {#each step.folded.rows as fold (fold.id)}
                <li class="flex items-baseline gap-[9px] py-px text-xs">
                  <button
                    class="{BOX} {boxFill(fold.done)}"
                    aria-pressed={fold.done}
                    aria-label={$tr("nextUp.planMarkDone", { label: fold.label })}
                    data-fold-tick
                    onclick={() => ticks.onToggleDone([fold.id], !fold.done)}
                  ></button>
                  <span
                    class="min-w-0 {fold.done
                      ? 'text-text-muted line-through'
                      : 'text-text-secondary'}">{fold.label}</span
                  >
                </li>
              {/each}
            </ul>
          {/if}

          {#if step.rows.length > 0}
            <ul class="m-0 mt-1 list-none p-0">
              {#each step.rows as row (row.key)}
                <li class="py-px text-xs">
                  <div class="flex items-baseline justify-between gap-3.5">
                    <span class="flex min-w-0 items-baseline gap-[9px]">
                      {#if ticks}
                        <button
                          class="{BOX} {boxFill(row.done)}"
                          aria-pressed={row.done}
                          aria-label={$tr("nextUp.planMarkDone", { label: row.label })}
                          data-row-tick
                          onclick={() => ticks.onToggleDone(row.ids, !row.done)}
                        ></button>
                      {/if}
                      <span
                        class="min-w-0 {row.done
                          ? 'text-text-muted line-through'
                          : 'text-text-secondary'}">{row.label}</span
                      >
                    </span>
                    <span class="flex items-baseline gap-[9px] whitespace-nowrap">
                      {#if row.value}
                        <span
                          class="tabular-nums {row.pick === 'spent'
                            ? 'text-warning'
                            : row.pick === 'reward'
                              ? 'text-text-secondary'
                              : 'text-accent'}">{row.value}</span
                        >
                      {/if}
                      {#if row.tags.length > 0}
                        <span class="text-text-muted">
                          {#each row.tags as tag, tagIndex (tag.text)}
                            {#if tagIndex > 0}<span aria-hidden="true"> · </span>{/if}<span
                              class={TAG_TONE[tag.tone ?? "none"]}
                              data-step-tag={tag.tone ?? "none"}>{tag.text}</span
                            >
                          {/each}
                        </span>
                      {/if}
                    </span>
                  </div>
                  {#each row.notes as note, noteIndex (noteIndex)}
                    <div class="text-text-muted {ticks ? 'pl-[22px]' : ''}">{note}</div>
                  {/each}
                </li>
              {/each}
            </ul>
          {/if}

          {#if step.alts.length > 0}
            <details class="mt-1 text-xs" data-step-alts>
              <summary class={SUMMARY}
                ><span class="mr-[7px] font-bold" aria-hidden="true">&rsaquo;</span>{$tr(
                  "nextUp.stepAlternates",
                )}</summary
              >
              <ul class="m-0 ml-[15px] mt-[5px] list-none p-0 text-text-secondary">
                {#each step.alts as alt (alt.id)}
                  <li class="py-px">
                    {alt.label}:
                    {#if controls && alt.offer}
                      <button
                        class="cursor-pointer rounded-[var(--radius-sm)] border px-1 text-xs
                               {alt.taken
                          ? 'border-accent text-accent'
                          : 'border-border text-text-secondary hover:border-border-strong hover:text-text-primary'}"
                        aria-pressed={alt.taken}
                        data-alt-take={alt.id}
                        onclick={() => controls.onTakeAlt(alt.id)}>{alt.text}</button
                      >
                    {:else}
                      <span class={alt.taken ? "text-accent" : ""}>{alt.text}</span>
                    {/if}
                  </li>
                {/each}
              </ul>
            </details>
          {/if}

          {#each step.disclosures as disclosure (disclosure.title)}
            <details class="mt-1 text-xs">
              <summary class={SUMMARY}
                ><span class="mr-[7px] font-bold" aria-hidden="true">&rsaquo;</span
                >{disclosure.title}</summary
              >
              <p class="mb-0 ml-[15px] mt-[5px] text-text-secondary">{disclosure.body}</p>
            </details>
          {/each}

          {#if step.conditions.length > 0 || step.bonuses.length > 0 || step.tips.length > 0 || (step.folded?.notes.length ?? 0) > 0}
            <details class="mt-1 text-xs" data-step-notes>
              <summary class={SUMMARY}
                ><span class="mr-[7px] font-bold" aria-hidden="true">&rsaquo;</span>{$tr(
                  "nextUp.stepNotes",
                )}</summary
              >
              <div class="ml-[15px]">
                {#if step.folded && step.folded.notes.length > 0}
                  <ul class="m-0 mt-[5px] list-none p-0 text-text-secondary">
                    {#each step.folded.notes as note, noteIndex (noteIndex)}
                      <li class="py-px">{note}</li>
                    {/each}
                  </ul>
                {/if}
                {#if step.conditions.length > 0 || step.bonuses.length > 0}
                  <ul class="m-0 mt-[5px] list-none p-0">
                    {#each step.conditions as condition (condition)}
                      <li class="py-px text-text-secondary">
                        <span class="mr-[7px] font-bold text-warning" aria-hidden="true">!</span
                        >{condition}
                      </li>
                    {/each}
                    {#each step.bonuses as bonus (bonus)}
                      <li class="py-px text-text-secondary">
                        <span class="mr-[7px] font-bold text-success" aria-hidden="true">+</span
                        >{bonus}
                      </li>
                    {/each}
                  </ul>
                {/if}
                <PlanTips tips={step.tips} split={false} />
              </div>
            </details>
          {/if}
        </div>
      </li>
    {/each}
  </ol>

  {#if plan.ledger.length > 0}
    <details class="mt-1 text-xs" data-plan-ledger>
      <summary class={SUMMARY}
        ><span class="mr-[7px] font-bold" aria-hidden="true">&rsaquo;</span>{$tr(
          "nextUp.planCurrency",
        )}</summary
      >
      <ul class="m-0 ml-[15px] mt-[5px] list-none p-0">
        {#each plan.ledger as line, lineIndex (lineIndex)}
          <li class="flex items-baseline gap-[9px] py-px">
            <span class="min-w-0 flex-1 text-text-secondary">{line.currency}</span>
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
    </details>
  {/if}
</div>
