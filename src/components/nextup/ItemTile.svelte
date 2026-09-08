<script lang="ts">
  import { tr } from "../../lib/i18n.js";
  import { compactCount, type OwnedReward } from "../../lib/suggest/ownedRewards.js";
  import {
    CHIP_TONE,
    COUNT_LABEL,
    COUNT_TITLE,
    TONE,
    tierBorderClass,
    tileCounts,
    tileDims,
  } from "./chips.js";
  import TierBadge from "./TierBadge.svelte";
  import ItemImage from "../ItemImage.svelte";
  import type { NemesisBonusRange } from "../../lib/suggest/acquisition/types.js";
  import type { Snippet } from "svelte";

  interface Props {
    name: string;
    /** Null draws the empty frame; the box is held either way. */
    imageUrl?: string | null | undefined;
    showArt?: boolean;
    /** Tier letter, S down to F; colours the letter and the border. */
    tier?: string | null | undefined;
    owned?: OwnedReward | null | undefined;
    /** Copies a build asks for, where the count is a shortfall rather than a total. */
    required?: number | null | undefined;
    element?: string | null | undefined;
    /** The roll this copy carries, or the window it rolls in. */
    bonus?: NemesisBonusRange | number | null | undefined;
    /** The roll the player's own copy carries, drawn beside their count. */
    ownedBonus?: number | null | undefined;
    /** What the stall or the foundry charges, already formatted. */
    cost?: readonly string[] | null | undefined;
    /** A resource, which the player always wants more of. Read off `owned` when
     *  that carries it; only a definite false ever dims. */
    stacks?: boolean | null | undefined;
    /** Nothing here is still owed. Dims gear, which is earned once. */
    have?: boolean | undefined;
    size?: "sm" | "md";
    stretch?: boolean;
    /** Buttons and labels; they sit under the name, never beside it. */
    actions?: Snippet;
    children?: Snippet;
  }

  const {
    name,
    imageUrl = undefined,
    showArt = true,
    tier = null,
    owned = null,
    required = null,
    element = null,
    bonus = null,
    ownedBonus = null,
    cost = null,
    stacks = null,
    have = undefined,
    size = "sm",
    stretch = false,
    actions,
    children,
  }: Props = $props();

  const ART = { sm: "h-10 w-10", md: "h-18 w-18" };
  const IMG = { sm: "max-h-10 max-w-10", md: "max-h-18 max-w-18" };
  /** The slot the tier keeps on a tile with no art to pin it to. */
  const SLOT = { sm: "w-7", md: "w-8" };
  const BADGE = { sm: "xs", md: "sm" } as const;
  const NAME = { sm: "text-sm", md: "font-display text-base" };
  const COUNT = "flex shrink-0 items-baseline gap-1 font-display font-semibold tabular-nums";
  const MICRO =
    "font-display text-[0.5625rem] font-semibold uppercase leading-none tracking-[0.08em]";
  const META =
    "flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.6875rem] leading-tight";

  const border = $derived(tierBorderClass(tier));
  // The wiki always reports one decimal place, so a whole number reads as one.
  const bonusText = $derived(
    bonus === null || bonus === undefined
      ? null
      : typeof bonus === "number"
        ? $tr("nextUp.tileBonusExact", { bonus: bonus.toFixed(1) })
        : $tr("nextUp.tileBonus", { min: String(bonus.min), max: String(bonus.max) }),
  );
  const ownedBonusText = $derived(
    ownedBonus === null || ownedBonus === undefined
      ? null
      : $tr("nextUp.tileBonusExact", { bonus: ownedBonus.toFixed(1) }),
  );
  const dim = $derived(tileDims(have, stacks, owned));
  const counts = $derived(tileCounts(owned));
  const costs = $derived(cost ?? []);
  const hasMeta = $derived(counts.length > 0 || Boolean(element || bonusText || actions));
</script>

<div
  class="flex min-w-0 items-center gap-2 rounded-[var(--radius-md)] border px-2 py-1
         {border} {stretch ? 'w-full' : ''} {dim ? 'opacity-45' : ''}"
  title={name}
>
  {#if showArt}
    <span
      class="relative flex shrink-0 items-center justify-center overflow-hidden
             rounded-[var(--radius-sm)] bg-bg-deep {ART[size]}"
    >
      <!-- A tile is on screen the moment the panel opens, so there is nothing
           to defer; deferring left half a drop table blank. -->
      <ItemImage src={imageUrl ?? null} alt={name} cls={IMG[size]} eager />
      <!-- Pinned where every card in the app pins a badge, so the name below
           never has to share its line with the letter. -->
      <span class="absolute left-0 top-0">
        <TierBadge {tier} size={BADGE[size]} chip />
      </span>
    </span>
  {:else}
    <span class="flex shrink-0 justify-center {SLOT[size]}">
      <TierBadge {tier} size={BADGE[size]} chip />
    </span>
  {/if}

  <span class="flex min-w-0 flex-1 flex-col gap-0.5">
    <!-- The name owns its line: nothing shares the row to truncate it. -->
    <span class="min-w-0 truncate text-text-primary {NAME[size]}">{name}</span>

    {#if hasMeta}
      <span class={META}>
        <!-- Labelled, because green and yellow cannot tell a built copy from
             one the foundry is still running. -->
        {#each counts as count (count.kind)}
          <span
            class="{COUNT} {count.tone}"
            title={$tr(COUNT_TITLE[count.kind], { count: String(count.value) })}
          >
            <span class={MICRO}>{$tr(COUNT_LABEL[count.kind])}</span>
            <span>x{compactCount(count.value)}</span>
            {#if count.kind === "inventory" && required !== null && required !== undefined}
              <span
                class={TONE.plain}
                title={$tr("nextUp.tileNeeded", { required: String(required) })}>/{required}</span
              >
            {/if}
            {#if count.kind === "inventory" && ownedBonusText}
              <span title={$tr("nextUp.tileOwnedBonusTitle")}>{ownedBonusText}</span>
            {/if}
          </span>
        {/each}
        {#if element}
          <span class={TONE.quiet} title={$tr("nextUp.tileElementTitle")}>{element}</span>
        {/if}
        {#if bonusText}
          <span class="tabular-nums {TONE.quiet}" title={$tr("nextUp.tileBonusTitle")}
            >{bonusText}</span
          >
        {/if}
        {#if actions}{@render actions()}{/if}
      </span>
    {/if}

    {#if costs.length > 0}
      <!-- Its own line, so a price never reads as one of the counts above it. -->
      <span class={META} title={$tr("nextUp.tileCostTitle")}>
        <span class="{MICRO} {TONE.plain}">{$tr("nextUp.tileCostLabel")}</span>
        {#each costs as chip (chip)}
          <span
            class="rounded-[var(--radius-sm)] border px-1 py-0.5 leading-none tabular-nums
                   {CHIP_TONE.plain}">{chip}</span
          >
        {/each}
      </span>
    {/if}

    {#if children}{@render children()}{/if}
  </span>
</div>
