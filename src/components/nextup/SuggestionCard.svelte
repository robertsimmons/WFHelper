<script lang="ts">
  import { fade } from "svelte/transition";

  import { timeTo } from "../../lib/format.js";
  import { tr } from "../../lib/i18n.js";
  import { clockStore } from "../../lib/timers.js";
  import WikiButton from "../WikiButton.svelte";
  import type { Suggestion } from "../../types/suggest.js";

  interface Props {
    suggestion: Suggestion;
    onComplete: (count: number) => void;
    onDismiss: () => void;
    onLink: () => void;
  }

  const { suggestion, onComplete, onDismiss, onLink }: Props = $props();

  /** Long enough to read the card as done before the feed drops it. */
  const DONE_DWELL_MS = 700;

  const clock = clockStore(1000);
  const expiry = $derived(suggestion.expiry ? new Date(suggestion.expiry) : null);
  const countdown = $derived(expiry ? timeTo(expiry, $clock) : "");
  const complete = $derived(suggestion.complete);
  const progress = $derived(suggestion.progress);
  const progressPercent = $derived(
    progress && progress.required > 0
      ? Math.min(100, Math.round((progress.current / progress.required) * 100))
      : 0,
  );

  let done = $state(false);

  function markDone(target: number): void {
    if (done) return;
    done = true;
    setTimeout(() => onComplete(target), DONE_DWELL_MS);
  }
</script>

<article
  out:fade={{ duration: 250 }}
  class="flex flex-col gap-2 rounded-[var(--radius-lg)] border bg-bg-soft p-3
         transition-colors duration-200 {done
    ? 'border-success/60 opacity-70'
    : 'border-border hover:border-border-strong'}"
>
  <header class="flex items-start justify-between gap-3">
    <h3 class="m-0 font-display text-base font-medium text-text-primary">{suggestion.title}</h3>
    {#if countdown}
      <span class="shrink-0 whitespace-nowrap text-xs text-text-muted">
        {$tr("nextUp.timeLeft", { time: countdown })}
      </span>
    {/if}
  </header>

  {#if suggestion.why}
    <p class="m-0 text-sm text-text-secondary">{suggestion.why}</p>
  {/if}

  {#if progress}
    <div class="flex items-center gap-2">
      <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-deep">
        <div class="h-full rounded-full bg-accent" style="width: {progressPercent}%"></div>
      </div>
      <span class="text-xs text-text-muted">{progress.current}/{progress.required}</span>
      {#if complete && !done}
        <button
          class="cursor-pointer rounded border border-border bg-bg-base px-2 py-0.5 text-xs
                 text-text-secondary transition-[border-color,color] duration-150
                 hover:border-border-strong hover:text-text-primary"
          onclick={() => onComplete(progress.current + 1)}>{$tr("nextUp.addRun")}</button
        >
      {/if}
    </div>
  {/if}

  <footer class="mt-1 flex items-center justify-between gap-3">
    {#if complete}
      <button
        class="cursor-pointer rounded px-3 py-1 text-sm font-semibold transition-colors
               duration-150 {done
          ? 'bg-success text-bg-base'
          : 'bg-accent text-bg-base hover:brightness-110'}"
        disabled={done}
        onclick={() => markDone(complete.target)}
      >
        {done ? $tr("nextUp.doneMarked") : $tr("nextUp.done")}
      </button>
    {:else}
      <span></span>
    {/if}
    <button
      class="cursor-pointer rounded border border-border bg-transparent px-2.5 py-1 text-sm
             text-text-muted transition-[border-color,color] duration-150
             hover:border-border-strong hover:text-text-secondary"
      onclick={onDismiss}>{$tr("nextUp.dismiss")}</button
    >
  </footer>

  {#if suggestion.link || suggestion.wiki}
    <div class="flex items-center gap-3 border-t border-border/60 pt-2">
      {#if suggestion.link}
        <button
          class="cursor-pointer border-0 bg-transparent p-0 text-xs text-text-muted underline
                 underline-offset-2 transition-colors duration-150 hover:text-text-secondary"
          onclick={onLink}>{$tr(suggestion.link.labelKey)}</button
        >
      {/if}
      {#if suggestion.wiki}
        <WikiButton fallbackName={suggestion.wiki} />
      {/if}
    </div>
  {/if}
</article>
