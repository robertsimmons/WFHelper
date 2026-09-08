<script lang="ts">
  import { tr } from "../../lib/i18n.js";
  import { tierLetter, tierTextClass } from "./chips.js";

  interface Props {
    tier: string | null | undefined;
    size?: "xs" | "sm" | "md";
    /** A backdrop, for a badge that has to read over artwork. */
    chip?: boolean;
  }

  const { tier, size = "xs", chip = false }: Props = $props();

  const SIZE = { xs: "text-sm", sm: "text-base", md: "text-lg" };

  // Tailwind's own leading for each size, so an inline letter shares its line
  // box, and therefore its baseline, with the name beside it. A chip is a box
  // of its own and stays tight instead.
  const LEADING = { xs: "leading-5", sm: "leading-6", md: "leading-7" };

  const letter = $derived(tierLetter(tier));
  const box = $derived(
    chip
      ? "leading-none rounded-[var(--radius-sm)] border border-border bg-bg-deep/85 px-1 py-0.5"
      : `${LEADING[size]} w-[2ch]`,
  );
</script>

{#if letter}
  <span
    class="inline-flex shrink-0 items-center justify-center font-display font-bold
           {SIZE[size]} {box} {tierTextClass(letter)}"
    title={$tr("nextUp.tileTier", { tier: letter })}>{letter}</span
  >
{/if}
