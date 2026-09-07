<script lang="ts">
  import { tr } from "../../lib/i18n.js";
  import { bannerAside, bannerFor } from "../../lib/suggest/bannerArt.js";
  import { gradeClass } from "../../lib/suggest/circuit.js";
  import { resolveDropArt } from "../../lib/suggest/dropPools.js";
  import { CARD_HEIGHT } from "../../lib/suggest/grid.js";
  import { itemDb } from "../../stores/data.js";
  import { nightwaveArt } from "../../stores/suggestionPrefs.js";
  import SuggestionDetailsModal from "./SuggestionDetailsModal.svelte";
  import ItemImage from "../ItemImage.svelte";
  import type {
    ChoiceState,
    Suggestion,
    SuggestionDetails,
    WhySegment,
  } from "../../types/suggest.js";

  interface Props {
    suggestion: Suggestion;
    onComplete: (count: number) => void;
    onDismiss: () => void;
  }

  const { suggestion, onComplete, onDismiss }: Props = $props();

  /** Long enough to read the card as done before the feed drops it. */
  const DONE_DWELL_MS = 700;

  const ART_HEIGHT = CARD_HEIGHT / 2;

  const ICON_BTN =
    "flex h-6 w-6 cursor-pointer items-center justify-center rounded border border-border " +
    "bg-bg-base text-text-muted transition-[border-color,color,background-color] duration-150 " +
    "hover:border-border-strong hover:text-text-primary";

  const STRIP: Record<ChoiceState, string> = {
    wanted: "border-success bg-success/10",
    subsume: "border-warning bg-warning/10",
    done: "border-border opacity-40",
  };

  const TONE: Record<NonNullable<WhySegment["tone"]>, string> = {
    good: "text-success",
    bad: "text-danger",
  };

  function missionSegments(missions: SuggestionDetails["missions"]): WhySegment[] {
    return (missions ?? []).map((mission) =>
      mission.opinion === "bad" ? { text: mission.name, tone: "bad" } : { text: mission.name },
    );
  }

  const choices = $derived(suggestion.choices ?? []);
  const art = $derived(
    suggestion.reward && choices.length === 0
      ? resolveDropArt($itemDb, suggestion.reward.name, suggestion.reward.uniqueName)
      : null,
  );
  const banner = $derived(
    choices.length === 0 ? bannerFor(suggestion.id, suggestion.category, $nightwaveArt) : null,
  );
  const backdrop = $derived(banner?.fit === "cover" ? banner : null);
  // Stands in only where nothing else pictures the task.
  const standIn = $derived(!art && banner?.fit === "contain" ? banner : null);
  // The name comes back into the line when no art carries it, and rather than
  // leave the line blank.
  const why = $derived(
    art && suggestion.why ? suggestion.why : (suggestion.whyWithReward ?? suggestion.why),
  );
  // Segments spell out the plain line, so they only stand where that line does.
  // A task the provider left plain falls back to its mission list, which reads
  // the same way and carries the same warning.
  const segments = $derived(
    suggestion.whySegments?.length
      ? why === suggestion.why
        ? suggestion.whySegments
        : []
      : missionSegments(suggestion.details?.missions),
  );

  const complete = $derived(suggestion.complete);
  const progress = $derived(suggestion.progress);
  const progressPercent = $derived(
    progress && progress.required > 0
      ? Math.min(100, Math.round((progress.current / progress.required) * 100))
      : 0,
  );

  let done = $state(false);
  let detailsOpen = $state(false);

  function markDone(target: number): void {
    if (done) return;
    done = true;
    setTimeout(() => onComplete(target), DONE_DWELL_MS);
  }

  function openDetails(): void {
    detailsOpen = true;
  }

  function onCardKey(event: KeyboardEvent): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openDetails();
  }

  // The controls sit inside the card's own click target.
  function clickDone(event: MouseEvent, target: number): void {
    event.stopPropagation();
    markDone(target);
  }

  function clickAddRun(event: MouseEvent, next: number): void {
    event.stopPropagation();
    onComplete(next);
  }

  function clickDismiss(event: MouseEvent): void {
    event.stopPropagation();
    onDismiss();
  }
</script>

<!-- Every card is the same box: a fixed art band over rows of fixed height, so
     no control ever moves and no card ever stretches its neighbours. -->
<div
  class="flex w-full cursor-pointer flex-col overflow-hidden rounded-[var(--radius-lg)] border
         bg-bg-raised transition-colors duration-200 focus-visible:outline
         focus-visible:outline-2 focus-visible:outline-accent {done
    ? 'border-success/60 opacity-70'
    : 'border-border hover:border-border-strong hover:bg-bg-hover'}"
  style="height: {CARD_HEIGHT}px"
  data-suggestion-card={suggestion.category}
  role="button"
  tabindex="0"
  aria-label={$tr("common.openDetailsFor", { name: suggestion.title })}
  onclick={openDetails}
  onkeydown={onCardKey}
>
  <div
    class="relative flex w-full shrink-0 overflow-hidden border-b border-border bg-bg-deep"
    style="height: {ART_HEIGHT}px"
  >
    {#if backdrop}
      <img
        class="absolute inset-0 h-full w-full object-cover"
        style="object-position: {backdrop.position}"
        src={backdrop.url}
        alt=""
        aria-hidden="true"
      />
    {/if}
    {#each choices as choice (choice.name)}
      <div
        class="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden
               border-b-[3px] p-1 {STRIP[choice.state]}"
        title={choice.name}
      >
        {#if choice.grade}
          <span
            class="absolute right-1 top-0.5 z-[1] font-display text-[0.625rem] font-semibold
                   leading-none {gradeClass(choice.grade)}">{choice.grade}</span
          >
        {/if}
        <ItemImage src={choice.imageUrl} alt={choice.name} cls="max-h-full max-w-full" />
        <span
          class="choice-name absolute inset-x-0 bottom-0.5 truncate px-0.5 text-center
                 text-[0.625rem] font-semibold leading-tight text-text-primary"
        >
          {choice.name}
        </span>
      </div>
    {/each}
    {#if choices.length === 0 && art}
      <div class="relative flex w-full items-center p-1.5 {bannerAside(backdrop)}" title={art.name}>
        {#if suggestion.grade}
          <span
            class="absolute right-1 top-0.5 z-[1] font-display text-[0.625rem] font-semibold
                   leading-none {gradeClass(suggestion.grade)}">{suggestion.grade}</span
          >
        {/if}
        <ItemImage src={art.imageUrl} alt={art.name} cls="max-h-full max-w-full" />
      </div>
    {:else if standIn}
      <div class="relative flex w-full items-center justify-center p-1.5">
        <img src={standIn.url} alt="" class="max-h-full max-w-full object-contain" />
      </div>
    {/if}
  </div>

  <div class="flex min-h-0 flex-1 flex-col gap-1.5 p-2">
    <div class="grid h-6 grid-cols-[minmax(0,1fr)_1.5rem_1.5rem] items-center gap-x-3">
      <h3
        class="m-0 truncate font-display text-sm font-medium leading-5 text-text-primary"
        title={suggestion.title}
      >
        {suggestion.title}
      </h3>
      <span class="h-6 w-6">
        {#if complete}
          <button
            class="flex h-6 w-6 cursor-pointer items-center justify-center rounded border
                   transition-colors duration-150 {done
              ? 'border-success bg-success text-bg-base'
              : 'border-accent bg-accent text-bg-base hover:brightness-110'}"
            disabled={done}
            title={done ? $tr("nextUp.doneMarked") : $tr("nextUp.done")}
            aria-label={done ? $tr("nextUp.doneMarked") : $tr("nextUp.done")}
            onclick={(event) => clickDone(event, complete.target)}
          >
            <svg viewBox="0 0 16 16" class="h-3.5 w-3.5" aria-hidden="true">
              <path
                d="M3.2 8.4 6.3 11.6 12.8 4.6"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
        {/if}
      </span>
      <button
        class={ICON_BTN}
        title={$tr("common.dismiss")}
        aria-label={$tr("common.dismiss")}
        onclick={clickDismiss}
      >
        <svg viewBox="0 0 16 16" class="h-3 w-3" aria-hidden="true">
          <path
            d="M4 4 12 12M12 4 4 12"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          />
        </svg>
      </button>
    </div>

    <p class="m-0 h-4 truncate text-xs leading-4 text-text-secondary" title={why}>
      {#if segments.length > 0}{#each segments as segment, index (index)}<span
            class={segment.tone ? TONE[segment.tone] : ""}
            >{index > 0 ? ", " : ""}{segment.text}</span
          >{/each}{:else}{why}{/if}
    </p>

    <div class="mt-auto grid h-6 grid-cols-[minmax(0,1fr)_2.25rem_1.5rem] items-center gap-x-2">
      {#if progress}
        <div class="h-1.5 overflow-hidden rounded-full bg-bg-deep">
          <div class="h-full rounded-full bg-accent" style="width: {progressPercent}%"></div>
        </div>
        <span class="text-right text-[0.625rem] leading-none text-text-muted"
          >{progress.current}/{progress.required}</span
        >
      {/if}
      <span class="col-start-3 h-6 w-6">
        {#if progress && complete && !done}
          <button
            class="{ICON_BTN} font-display text-[0.6875rem] font-semibold leading-none"
            title={$tr("nextUp.addRunTitle")}
            aria-label={$tr("nextUp.addRunTitle")}
            onclick={(event) => clickAddRun(event, progress.current + 1)}
            >{$tr("nextUp.addRun")}</button
          >
        {/if}
      </span>
    </div>
  </div>
</div>

{#if detailsOpen}
  <SuggestionDetailsModal {suggestion} onClose={() => (detailsOpen = false)} />
{/if}

<style>
  /* Stroke under the fill keeps the name readable over any artwork. */
  .choice-name {
    -webkit-text-stroke: 2px var(--bg-deep);
    paint-order: stroke fill;
  }
</style>
