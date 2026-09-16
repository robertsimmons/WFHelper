<script lang="ts">
  import { tr } from "../../../lib/i18n.js";
  import PlanRow from "./PlanRow.svelte";
  import { visibleRows } from "./planResolution.js";
  import type {
    PlanLiveState,
    ResolvedGroup,
  } from "../../../lib/suggest/acquisition/plan/index.js";

  interface Props {
    group: ResolvedGroup;
    /** Done rows vanish unless the player asked to see what is already behind them. */
    showDone: boolean;
    onToggleDone: (rowId: string, done: boolean) => void;
    onTakeAlt: (rowId: string) => void;
  }

  const { group, showDone, onToggleDone, onTakeAlt }: Props = $props();

  const LIVE_TONE: Record<PlanLiveState, string> = {
    open: "text-success",
    blocked: "text-danger",
    waiting: "text-warning",
  };

  const skipped = $derived(group.skip !== null);
  const rows = $derived(visibleRows(group, showDone));
  /** A skipped group with nothing left to show still has to read as settled, so
   *  it keeps its place and its reason on one dimmed line. */
  const settled = $derived(skipped && rows.length === 0);
  const hasSubLine = $derived(
    group.live !== null ||
      group.facts.length > 0 ||
      group.mode !== null ||
      group.earns !== null ||
      group.spends.length > 0 ||
      group.map !== null,
  );
</script>

{#if settled}
  <div
    class="flex items-baseline justify-between gap-3.5 border-t border-border-subtle px-0 py-1
           opacity-[0.42] first:border-t-0"
  >
    <div class="truncate text-xs font-semibold uppercase leading-[1.2] tracking-[0.1em]">
      {group.place}
      {#if group.sub}
        <span class="ml-[9px] font-normal normal-case tracking-[0.02em] text-accent"
          >{group.sub}</span
        >
      {/if}
      {#if group.activity}
        <span class="ml-[9px] font-normal normal-case tracking-[0.02em] text-text-secondary"
          >{group.activity}</span
        >
      {/if}
    </div>
    {#if group.skip}
      <div class="whitespace-nowrap text-xs italic text-text-secondary">{group.skip.reason}</div>
    {/if}
  </div>
{:else}
  <div
    class="border-t border-border-subtle px-0 pb-1 pt-[13px] first:border-t-0
         {skipped ? 'opacity-[0.42]' : ''}"
  >
    <div class="flex items-baseline justify-between gap-3.5">
      <div class="text-xs font-semibold uppercase leading-[1.2] tracking-[0.1em]">
        {group.place}
        {#if group.sub}
          <span class="ml-[9px] font-normal normal-case tracking-[0.02em] text-accent"
            >{group.sub}</span
          >
        {/if}
        {#if group.activity}
          <span class="ml-[9px] font-normal normal-case tracking-[0.02em] text-text-secondary"
            >{group.activity}</span
          >
        {/if}
      </div>
      {#if group.skip}
        <div class="whitespace-nowrap text-xs italic text-text-secondary">{group.skip.reason}</div>
      {:else if group.meta}
        <div class="whitespace-nowrap text-xs text-text-secondary">{group.meta}</div>
      {/if}
    </div>

    {#if hasSubLine}
      <div class="mt-[3px] flex flex-wrap gap-[9px] text-xs text-accent">
        {#if group.live}
          <span class={LIVE_TONE[group.live.state]}>{group.live.text}</span>
        {/if}
        {#each group.facts as fact, index (index)}
          <span class="text-text-muted">{fact.text}</span>
        {/each}
        {#if group.mode}
          <span class="text-text-muted">{group.mode}</span>
        {/if}
        {#if group.earns}
          <span class="text-text-muted"
            >{$tr("nextUp.planBanks", {
              amount: group.earns.amount,
              currency: group.earns.currency,
            })}</span
          >
        {/if}
        {#each group.spends as spend, index (index)}
          <span class="text-text-muted"
            >{$tr("nextUp.planSpends", { amount: spend.amount, currency: spend.currency })}</span
          >
        {/each}
        {#if group.map}
          <button
            class="cursor-not-allowed rounded-[3px] border border-border-subtle px-1.5 py-px
                 text-[0.6875rem] text-text-muted"
            disabled={!group.mapReady}
            title={$tr("nextUp.planMapMissing", { map: group.map })}>{$tr("nextUp.planMap")}</button
          >
        {/if}
      </div>
    {/if}

    {#if rows.length > 0}
      <ul class="m-0 mt-2 list-none p-0">
        {#each rows as row (row.id)}
          <PlanRow {row} {skipped} {onToggleDone} {onTakeAlt} />
        {/each}
      </ul>
    {/if}

    {#if group.conditions.length > 0 || group.bonuses.length > 0}
      <ul class="m-0 mt-[7px] list-none p-0 text-xs">
        {#each group.conditions as condition (condition)}
          <li class="py-px text-text-secondary">
            <span class="mr-[7px] font-bold text-warning" aria-hidden="true">!</span>{condition}
          </li>
        {/each}
        {#each group.bonuses as bonus (bonus)}
          <li class="py-px text-text-secondary">
            <span class="mr-[7px] font-bold text-success" aria-hidden="true">+</span>{bonus}
          </li>
        {/each}
      </ul>
    {/if}

    {#each group.disclosures as disclosure (disclosure.title)}
      <details class="mt-1.5 text-xs">
        <summary class="cursor-pointer list-none text-accent [&::-webkit-details-marker]:hidden"
          ><span class="mr-[7px] font-bold" aria-hidden="true">&rsaquo;</span
          >{disclosure.title}</summary
        >
        <p class="mb-0 ml-[15px] mt-[5px] max-w-[74ch] text-text-secondary">{disclosure.body}</p>
      </details>
    {/each}
  </div>
{/if}
