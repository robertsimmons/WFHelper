<script lang="ts">
  import { tr } from "../../../lib/i18n.js";
  import { send } from "../../../lib/ipc.js";
  import type { ItemTip } from "../../../lib/suggest/acquisition/plan/index.js";

  interface Props {
    /** Strongest first. */
    tips: readonly ItemTip[];
    /** Off draws every tip in the list, for a surface that is already collapsed. */
    split?: boolean;
    /** A block of its own: titled while a tip shows, a lone disclosure otherwise. */
    heading?: string | undefined;
  }

  const { tips, split = true, heading }: Props = $props();

  /** Past this a step reads as a wall of advice; the rest wait one click down. */
  const INLINE = 2;

  const strong = (tip: ItemTip): boolean =>
    tip.consensus === "unanimous" || tip.consensus === "common";

  const inline = $derived(split ? tips.filter(strong).slice(0, INLINE) : [...tips]);
  const more = $derived(split ? tips.filter((tip) => !inline.includes(tip)) : []);
</script>

{#snippet line(tip: ItemTip)}
  <li class="py-px text-text-secondary" data-tip={tip.id}>
    <span
      class="mr-[7px] font-bold {tip.kind === 'gotcha' ? 'text-warning' : 'text-text-muted'}"
      aria-hidden="true">&bull;</span
    >{tip.text}
    {#if tip.dispute}
      <details class="ml-[15px]" data-tip-disputed>
        <summary
          class="w-fit cursor-pointer list-none text-warning [&::-webkit-details-marker]:hidden"
          ><span class="mr-[7px] font-bold" aria-hidden="true">&rsaquo;</span>{$tr(
            "nextUp.planTipDisputed",
          )}</summary
        >
        <p class="mb-0 ml-[15px] mt-[3px] max-w-[74ch]">
          {tip.dispute.claim}
          <button
            class="ml-1 cursor-pointer text-accent hover:underline"
            onclick={() => send("open-external", tip.dispute?.wiki ?? "")}
            >{$tr("common.wiki")}</button
          >
        </p>
      </details>
    {/if}
  </li>
{/snippet}

{#if tips.length > 0}
  {#if heading && inline.length > 0}
    <div class="text-xs font-semibold uppercase leading-[1.2] tracking-[0.1em]">{heading}</div>
  {/if}
  {#if inline.length > 0}
    <ul class="m-0 mt-[7px] list-none p-0 text-xs">
      {#each inline as tip (tip.id)}
        {@render line(tip)}
      {/each}
    </ul>
  {/if}
  {#if more.length > 0}
    <!-- "more" only reads right under tips already showing. -->
    <details class="text-xs {inline.length > 0 || !heading ? 'mt-1.5' : ''}">
      <summary class="cursor-pointer list-none text-accent [&::-webkit-details-marker]:hidden"
        ><span class="mr-[7px] font-bold" aria-hidden="true">&rsaquo;</span>{$tr(
          inline.length > 0 ? "nextUp.planMoreTips" : "nextUp.planTipsCount",
          { count: more.length },
        )}</summary
      >
      <ul class="m-0 ml-[15px] mt-[5px] list-none p-0">
        {#each more as tip (tip.id)}
          {@render line(tip)}
        {/each}
      </ul>
    </details>
  {/if}
{/if}
