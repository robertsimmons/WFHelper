<script lang="ts">
  import type { Snippet } from "svelte";

  import { tr } from "../../../lib/i18n.js";
  import { send } from "../../../lib/ipc.js";
  import PlanCount from "./PlanCount.svelte";
  import PlanTips from "./PlanTips.svelte";
  import { toggleShopPick } from "../../../stores/shopPicks.js";
  import ShopPicker from "./ShopPicker.svelte";
  import type { PlanLine, PlanStepControls } from "./planSteps.js";
  import type { ResolvedShop } from "../../../lib/suggest/acquisition/shops/picker.js";

  interface Props {
    entry: PlanLine;
    shop: ResolvedShop | null;
    controls?: PlanStepControls | undefined;
    onOpenMap: (map: string) => void;
    /** What a Build line's drawer adds: the foundry's totals. */
    totals?: Snippet | undefined;
    /** What the surface adds about the item, in the first step's drawer. */
    lead?: Snippet | undefined;
  }

  const { entry, shop, controls, onOpenMap, totals, lead }: Props = $props();

  const HEAD = "mt-2 text-[0.6875rem] font-semibold uppercase tracking-[0.06em] text-text-muted";
  const LINK = "cursor-pointer text-info hover:text-accent";
  const SUMMARY = "cursor-pointer list-none text-text-secondary [&::-webkit-details-marker]:hidden";
  const BOX = "relative top-[2px] inline-block h-3 w-3 shrink-0 rounded-[3px] border";

  const drawer = $derived(entry.drawer);
</script>

{#snippet wiki(href: string)}
  <button type="button" class={LINK} onclick={() => send("open-external", href)}
    >{$tr("common.wiki")}</button
  >
{/snippet}

{#snippet mapButton(map: { key: string; ready: boolean } | null)}
  {#if map?.ready}
    {@const key = map.key}
    <button type="button" class={LINK} data-plan-map={key} onclick={() => onOpenMap(key)}
      >{$tr("nextUp.planMap")}</button
    >
  {/if}
{/snippet}

<div
  class="mb-1 ml-[34px] mt-1 flex flex-col rounded-r-[var(--radius-md)] border-l-[3px] border-accent bg-bg-surface px-3.5 py-2.5 text-xs"
  data-plan-drawer={entry.id}
>
  {#if entry.kind === "basics"}
    {#each entry.chips as chip (chip.id)}
      <div class="flex flex-wrap items-baseline gap-x-2" data-plan-chip={chip.id}>
        <span class={chip.done ? "text-text-muted line-through" : "text-text-primary"}
          >{chip.title}</span
        >
        {#if chip.count && !chip.done}<PlanCount count={chip.count} />{/if}
        {#if chip.drawer.where}<span class="text-text-muted">{chip.drawer.where}</span>{/if}
        {#each chip.drawer.rates as rate (rate)}<span class="text-text-muted">{rate}</span>{/each}
        {@render mapButton(chip.drawer.map)}
        {@render wiki(chip.drawer.wiki)}
      </div>
    {/each}
  {:else}
    {#if drawer.where || drawer.rates.length > 0}
      <div class="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        {#if drawer.where}<b class="text-text-primary">{drawer.where}</b>{/if}
        {#each drawer.rates as rate (rate)}
          <span class="rounded-[var(--radius-sm)] bg-bg-raised px-1.5 text-text-secondary"
            >{rate}</span
          >
        {/each}
        {@render mapButton(drawer.map)}
      </div>
    {/if}
    {#if drawer.parts.length > 0}
      <ul class="m-0 mt-1 flex list-none flex-col gap-0.5 p-0" data-plan-parts>
        {#each drawer.parts as part (part.id)}
          <li class="flex items-baseline gap-2" data-plan-part={part.id}>
            {#if controls}
              <button
                type="button"
                class="{BOX} cursor-pointer {part.done
                  ? 'border-success bg-success'
                  : 'border-text-muted hover:border-accent'}"
                aria-pressed={part.done}
                aria-label={$tr("nextUp.planMarkDone", { label: part.label })}
                onclick={() => controls.onToggleDone([part.id], !part.done)}
              ></button>
            {:else}
              <span class="{BOX} {part.done ? 'border-success bg-success' : 'border-text-muted'}"
              ></span>
            {/if}
            <span class={part.done ? "text-text-muted line-through" : "text-text-primary"}
              >{part.label}</span
            >
            {#if part.count && !part.done}<PlanCount count={part.count} />{/if}
            {#if part.cost}<span class="text-text-secondary">{part.cost}</span>{/if}
            {#if part.note}<span class="text-text-muted">{part.note}</span>{/if}
          </li>
        {/each}
      </ul>
    {/if}
    {#if drawer.lead && lead}
      {@render lead()}
    {/if}
    {#if drawer.notes.length > 0}
      <span class={HEAD}>{$tr("nextUp.drawerNotes")}</span>
      <ul class="m-0 pl-[18px] text-text-secondary">
        {#each drawer.notes as note, index (index)}<li>{note}</li>{/each}
      </ul>
    {/if}
    {#if drawer.other.length > 0}
      <span class={HEAD}>{$tr("nextUp.drawerOther")}</span>
      <ul class="m-0 pl-[18px] text-text-secondary">
        {#each drawer.other as spot, index (index)}<li>{spot}</li>{/each}
      </ul>
    {/if}
    {#each drawer.alts as alt (alt.id)}
      <span class="text-text-secondary"
        >{alt.label}:
        {#if controls && alt.offer}
          <button
            type="button"
            class="cursor-pointer {alt.taken ? 'text-accent' : 'text-info'}"
            aria-pressed={alt.taken}
            data-alt-take={alt.id}
            onclick={() => controls.onTakeAlt(alt.id)}>{alt.text}</button
          >
        {:else}{alt.text}{/if}
      </span>
    {/each}
    {#each drawer.disclosures as disclosure (disclosure.title)}
      <details class="mt-1">
        <summary class={SUMMARY}>&rsaquo; {disclosure.title}</summary>
        <p class="m-0 ml-3 text-text-secondary">{disclosure.body}</p>
      </details>
    {/each}
    {#if drawer.tips.length > 0}
      <PlanTips tips={drawer.tips} split={false} />
    {/if}
    {#if entry.section === "build" && totals}
      <span class={HEAD}>{$tr("nextUp.buildTotals")}</span>
      {@render totals()}
    {/if}
    {#if entry.picker && shop}
      <ShopPicker {shop} onToggle={(unitId) => toggleShopPick(shop.key, unitId)} />
    {/if}
    <div class="mt-1.5">{@render wiki(drawer.wiki)}</div>
  {/if}
</div>
