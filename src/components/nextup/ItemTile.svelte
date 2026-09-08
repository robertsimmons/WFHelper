<script lang="ts">
  import { tr } from "../../lib/i18n.js";
  import { compactCount, type OwnedReward } from "../../lib/suggest/ownedRewards.js";
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
    /** Nothing here is still owed. Dims gear, which is earned once; a resource
     *  is always worth more, so it keeps full contrast however much is in hand. */
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
    have = undefined,
    size = "sm",
    stretch = false,
    actions,
    children,
  }: Props = $props();

  // The same ramp tierClass gives the letter, so a border never disagrees with
  // the tier printed next to it.
  const TIER_BORDER: Record<string, string> = {
    S: "border-[color:var(--relic-requiem)]",
    A: "border-success",
    B: "border-warning",
    C: "border-danger",
    F: "border-danger",
  };

  const ART = { sm: "h-10 w-10", md: "h-18 w-18" };
  const IMG = { sm: "max-h-10 max-w-10", md: "max-h-18 max-w-18" };
  const NAME = { sm: "text-sm", md: "font-display text-base" };
  const COUNT = "flex shrink-0 items-center gap-1 font-display font-semibold tabular-nums";
  const ICON = "h-3 w-3 shrink-0";

  const border = $derived(TIER_BORDER[tier?.charAt(0).toUpperCase() ?? ""] ?? "border-border");
  // The wiki always reports one decimal place, so a whole number reads as one.
  const bonusText = $derived(
    bonus === null || bonus === undefined
      ? null
      : typeof bonus === "number"
        ? $tr("nextUp.tileBonusExact", { bonus: bonus.toFixed(1) })
        : $tr("nextUp.tileBonus", { min: String(bonus.min), max: String(bonus.max) }),
  );
  const dim = $derived(Boolean(have) && owned?.stacks !== true);
  // Green is "you have some", so none in hand reads muted instead.
  const ownedTone = $derived(owned && owned.owned > 0 ? "text-success" : "text-text-muted");
  const hasMeta = $derived(Boolean(owned || element || bonusText || actions));
</script>

<div
  class="flex min-w-0 items-center gap-2 rounded-[var(--radius-md)] border px-2 py-1
         {border} {stretch ? 'w-full' : ''} {dim ? 'opacity-45' : ''}"
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
    <!-- The name owns its line: nothing shares the row to truncate it. -->
    <span class="flex min-w-0 items-center gap-1.5">
      <span class="min-w-0 flex-1 truncate text-text-primary {NAME[size]}">{name}</span>
      <!-- Held whether or not the item is rated, so a column of tiles lines its
           letters up rather than hanging each one off the end of a name. -->
      <span class="flex w-[2ch] shrink-0 justify-center">
        <TierBadge {tier} {size} />
      </span>
    </span>

    {#if hasMeta}
      <span
        class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.6875rem]
               leading-tight"
      >
        {#if owned}
          <span
            class="{COUNT} {ownedTone}"
            title={$tr("nextUp.tileInInventory", { count: String(owned.owned) })}
          >
            <svg
              class={ICON}
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M2.5 5.5h11v8h-11z" />
              <path d="M2.5 5.5 8 2.5l5.5 3" />
            </svg>
            <span>x{compactCount(owned.owned)}</span>
            {#if required !== null && required !== undefined}
              <span
                class="text-text-muted"
                title={$tr("nextUp.tileNeeded", { required: String(required) })}>/{required}</span
              >
            {/if}
          </span>
          {#if owned.pending}
            <span
              class="{COUNT} text-warning"
              title={$tr("nextUp.tileInFoundry", { count: String(owned.pending) })}
            >
              <svg
                class={ICON}
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linecap="round"
                aria-hidden="true"
              >
                <circle cx="8" cy="8" r="5.5" />
                <path d="M8 4.5V8l2.5 1.5" />
              </svg>
              <span>x{compactCount(owned.pending)}</span>
            </span>
          {/if}
          {#if owned.built}
            <span
              class="{COUNT} text-text-secondary"
              title={$tr("nextUp.tileBuilt", { count: String(owned.built) })}
            >
              <svg
                class={ICON}
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.4"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M9 2.5 13.5 7l-2 2L7 4.5z" />
                <path d="M7.5 6.5 3 11v2h2l4.5-4.5" />
              </svg>
              <span>x{compactCount(owned.built)}</span>
            </span>
          {/if}
        {/if}
        {#if element}
          <span class="text-text-secondary" title={$tr("nextUp.tileElementTitle")}>{element}</span>
        {/if}
        {#if bonusText}
          <span class="tabular-nums text-text-secondary" title={$tr("nextUp.tileBonusTitle")}
            >{bonusText}</span
          >
        {/if}
        {#if actions}{@render actions()}{/if}
      </span>
    {/if}

    {#if children}{@render children()}{/if}
  </span>
</div>
