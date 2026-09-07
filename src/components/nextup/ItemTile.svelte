<script lang="ts">
  import { tr } from "../../lib/i18n.js";
  import { gradeClass } from "../../lib/suggest/circuit.js";
  import { compactCount, type OwnedReward } from "../../lib/suggest/ownedRewards.js";
  import ItemImage from "../ItemImage.svelte";
  import type { MessageKey } from "../../lib/i18n.js";
  import type { NemesisBonusRange } from "../../lib/suggest/acquisition/types.js";
  import type { RewardTier } from "../../types/suggest.js";
  import type { Snippet } from "svelte";

  interface Props {
    name: string;
    /** Null draws the empty frame; the box is held either way. */
    imageUrl?: string | null | undefined;
    showArt?: boolean;
    /** Letter grade or Overframe tier; colours the letter and the border. */
    grade?: string | null | undefined;
    /** Curated tier, which colours the border only where no letter rates it. */
    tier?: RewardTier | null | undefined;
    owned?: OwnedReward | null | undefined;
    /** Copies a build asks for, where the count is a shortfall rather than a total. */
    required?: number | null | undefined;
    element?: string | null | undefined;
    /** The roll this copy carries, or the window it rolls in. */
    bonus?: NemesisBonusRange | number | null | undefined;
    /** Dims the tile: nothing here is still owed. */
    have?: boolean | undefined;
    size?: "sm" | "md";
    stretch?: boolean;
    /** Buttons and labels that sit beside the name. */
    actions?: Snippet;
    children?: Snippet;
  }

  const {
    name,
    imageUrl = undefined,
    showArt = true,
    grade = null,
    tier = null,
    owned = null,
    required = null,
    element = null,
    bonus = null,
    have = undefined,
    size = "sm",
    stretch = false,
    actions,
    children,
  }: Props = $props();

  // The same ramp gradeClass gives the letter, so a border never disagrees with
  // the grade printed next to it.
  const GRADE_BORDER: Record<string, string> = {
    S: "border-[color:var(--relic-requiem)]",
    A: "border-success",
    B: "border-warning",
    C: "border-danger",
    F: "border-danger",
  };

  const TIER_BORDER: Record<RewardTier, string> = {
    great: "border-success",
    good: "border-success/50",
    ok: "border-border",
    low: "border-border",
  };

  const TIER_LABEL: Record<RewardTier, MessageKey> = {
    great: "nextUp.settingsTierGreat",
    good: "nextUp.settingsGood",
    ok: "nextUp.settingsTierOk",
    low: "nextUp.settingsLow",
  };

  const TIER_TONE: Record<RewardTier, string> = {
    great: "text-success",
    good: "text-success",
    ok: "text-text-secondary",
    low: "text-text-muted",
  };

  const ART = { sm: "h-10 w-10", md: "h-18 w-18" };
  const IMG = { sm: "max-h-10 max-w-10", md: "max-h-18 max-w-18" };
  const NAME = { sm: "text-sm", md: "font-display text-base" };

  const border = $derived(
    GRADE_BORDER[grade?.charAt(0).toUpperCase() ?? ""] ??
      (tier ? TIER_BORDER[tier] : null) ??
      "border-border",
  );
  // The wiki always reports one decimal place, so a whole number reads as one.
  const bonusText = $derived(
    bonus === null || bonus === undefined
      ? null
      : typeof bonus === "number"
        ? $tr("nextUp.tileBonusExact", { bonus: bonus.toFixed(1) })
        : $tr("nextUp.tileBonus", { min: String(bonus.min), max: String(bonus.max) }),
  );
  const hasMeta = $derived(Boolean(tier || element || bonusText));
</script>

<div
  class="flex min-w-0 items-center gap-2 rounded-[var(--radius-md)] border px-2 py-1
         {border} {stretch ? 'w-full' : ''} {have ? 'opacity-45' : ''}"
  title={name}
>
  {#if showArt}
    <span
      class="flex shrink-0 items-center justify-center overflow-hidden
             rounded-[var(--radius-sm)] bg-bg-deep {ART[size]}"
    >
      <ItemImage src={imageUrl ?? null} alt={name} cls={IMG[size]} />
    </span>
  {/if}

  <span class="flex min-w-0 flex-1 flex-col gap-0.5">
    <span class="flex min-w-0 items-center gap-1.5">
      <span class="truncate text-text-primary {NAME[size]}">{name}</span>
      {#if grade}
        <span
          class="shrink-0 font-display font-semibold leading-none {NAME[size]} {gradeClass(grade)}"
          title={$tr("nextUp.choiceGrade", { grade })}>{grade}</span
        >
      {/if}
      {#if actions}{@render actions()}{/if}
    </span>

    {#if hasMeta}
      <span class="flex flex-wrap items-center gap-x-2 text-[0.6875rem] leading-tight">
        {#if tier}
          <span class="font-semibold uppercase tracking-[0.08em] {TIER_TONE[tier]}"
            >{$tr(TIER_LABEL[tier])}</span
          >
        {/if}
        {#if element}
          <span class="text-text-secondary" title={$tr("nextUp.tileElementTitle")}>{element}</span>
        {/if}
        {#if bonusText}
          <span class="tabular-nums text-text-secondary" title={$tr("nextUp.tileBonusTitle")}
            >{bonusText}</span
          >
        {/if}
      </span>
    {/if}

    {#if children}{@render children()}{/if}
  </span>

  {#if owned}
    <span
      class="ml-auto flex shrink-0 items-baseline gap-1 font-display text-xs font-semibold
             tabular-nums"
    >
      <span
        class="text-success"
        title={$tr("nextUp.tileInInventory", { count: String(owned.owned) })}
        >x{compactCount(owned.owned)}</span
      >
      {#if required !== null && required !== undefined}
        <span class="text-text-muted" title={$tr("nextUp.tileNeeded", { required: String(required) })}
          >/{required}</span
        >
      {/if}
      {#if owned.built !== undefined}
        <span class="text-warning" title={$tr("nextUp.tileInFoundry", { count: String(owned.built) })}
          >x{compactCount(owned.built)}</span
        >
      {/if}
    </span>
  {/if}
</div>
