<script lang="ts">
  import { tr } from "../../lib/i18n.js";
  import { tierClass } from "../../lib/suggest/circuit.js";
  import { tierLetter } from "./chips.js";

  interface Props {
    tier: string | null | undefined;
    size?: "xs" | "sm" | "md";
    /** A backdrop, for a badge that has to read over artwork. */
    chip?: boolean;
  }

  const { tier, size = "xs", chip = false }: Props = $props();

  const SIZE = { xs: "text-xs", sm: "text-sm", md: "text-base" };

  // Tailwind's own leading for each size, so an inline letter shares its line
  // box, and therefore its baseline, with the name beside it. A chip is a box
  // of its own and stays tight instead.
  const LEADING = { xs: "leading-4", sm: "leading-5", md: "leading-6" };

  const letter = $derived(tierLetter(tier));
  const box = $derived(
    chip
      ? "leading-none rounded-[var(--radius-sm)] border border-border bg-bg-deep/85 px-1 py-0.5"
      : `${LEADING[size]} w-[2ch]`,
  );
</script>

{#if letter}
  <span
    class="inline-flex shrink-0 items-center justify-center font-display font-semibold
           {SIZE[size]} {box} {tierClass(letter)}"
    title={$tr("nextUp.choiceGrade", { grade: letter })}>{letter}</span
  >
{/if}
