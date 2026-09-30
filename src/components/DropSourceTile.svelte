<script lang="ts">
  import { dropRarityColour, formatDropChance } from "../lib/dropDisplay.js";
  import {
    dropSourceDetail,
    dropSourceHeader,
    liveDropSource,
    stageText,
    type DropSource,
    type DropStage,
  } from "../lib/dropSources.js";
  import { liveEnemySpawn } from "../lib/enemySpawns.js";
  import { tr } from "../lib/i18n.js";
  import { worldData } from "../stores/world.js";
  import { TILE_MICRO, TONE, cardClock, timeLeftText } from "./nextup/chips.js";
  import TimeLeft from "./nextup/TimeLeft.svelte";

  interface Props {
    source: DropSource;
    /** Makes the header a link, for a place that has a panel of its own. */
    onOpen?: (() => void) | undefined;
    active?: boolean;
  }

  const { source, onOpen, active = false }: Props = $props();

  const HEAD =
    "min-w-0 flex-1 truncate font-display text-xs font-semibold uppercase tracking-[0.05em] " +
    "text-text-primary";
  const META = "flex min-w-0 items-baseline gap-x-3 gap-y-0.5 text-[0.6875rem] leading-tight";

  const header = $derived(dropSourceHeader(source, $tr));
  const detail = $derived(dropSourceDetail(source, $tr).join(" · "));
  const live = $derived(liveDropSource(source, $worldData));
  const onBoard = $derived(live !== null && timeLeftText(live.expiry, $cardClock) !== null);
  const spawnLive = $derived(liveEnemySpawn(source, $worldData));
  const spawnOut = $derived(
    spawnLive !== null && timeLeftText(spawnLive.expiry, $cardClock) !== null,
  );
  const more = $derived(source.spawn?.more ?? []);
  let showMore = $state(false);
  /** A single unlabelled chance sits at the end of a line rather than on its own. */
  const lone = $derived(
    source.stages.length === 1 && !source.stages[0].label ? source.stages[0] : null,
  );
</script>

{#snippet chance(stage: DropStage)}
  {#if stage.chance !== null}
    <span
      class="shrink-0 font-semibold tabular-nums"
      style="color:{dropRarityColour(stage.rarity ?? '')}"
      title={stage.rarity ?? ""}>{formatDropChance(stage.chance)}</span
    >
  {/if}
{/snippet}

<div
  class="flex min-w-0 flex-col gap-0.5 rounded-[var(--radius-md)] border px-2 py-1
         {active ? 'border-accent' : 'border-border'}"
  title={source.raw.join("\n")}
>
  <span class="flex min-w-0 items-center gap-2">
    {#if onOpen}
      <button
        type="button"
        class="{HEAD} cursor-pointer text-left hover:text-accent hover:underline"
        onclick={onOpen}>{header}</button
      >
    {:else}
      <span class={HEAD}>{header}</span>
    {/if}
    {#if onBoard && live}
      <span class="flex shrink-0 items-center gap-1" title={$tr("dropSources.nowTitle")}>
        <span class="{TILE_MICRO} {TONE.good}"
          >{live.rotation
            ? $tr("dropSources.nowRotation", { rotation: live.rotation })
            : $tr("dropSources.now")}</span
        >
        <TimeLeft expiry={live.expiry} nowMs={$cardClock} />
      </span>
    {/if}
    {#if spawnOut && spawnLive}
      <span class="flex shrink-0 items-center gap-1" title={$tr("dropSources.phaseNowTitle")}>
        <span class="{TILE_MICRO} {TONE.good}"
          >{$tr("dropSources.phaseNow", { phase: $tr("world.cycle.night") })}</span
        >
        <TimeLeft expiry={spawnLive.expiry} nowMs={$cardClock} />
      </span>
    {/if}
    {#if more.length > 0}
      <button
        type="button"
        class="shrink-0 cursor-pointer text-[0.6875rem] {TONE.quiet} hover:text-text-primary
               hover:underline"
        aria-expanded={showMore}
        onclick={() => (showMore = !showMore)}
        >{$tr("dropSources.morePlaces", { count: more.length })}</button
      >
    {/if}
    {#if lone && !detail}
      <span class="text-[0.6875rem]">{@render chance(lone)}</span>
    {/if}
  </span>

  {#if detail}
    <span class={META}>
      <span class="min-w-0 flex-1 truncate {TONE.quiet}">{detail}</span>
      {#if lone}{@render chance(lone)}{/if}
    </span>
  {/if}

  {#if showMore && more.length > 0}
    <span class="{META} {TONE.quiet}">{more.join(" · ")}</span>
  {/if}

  {#if !lone && source.stages.length > 0}
    <span class="{META} flex-wrap">
      {#each source.stages as stage, index (index)}
        <span class="flex items-baseline gap-1 whitespace-nowrap">
          {#if stage.label}<span class={TONE.quiet}>{stageText(stage.label, $tr)}</span>{/if}
          {@render chance(stage)}
        </span>
      {/each}
    </span>
  {/if}
</div>
