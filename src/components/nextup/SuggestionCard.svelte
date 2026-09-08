<script lang="ts">
  import { tr } from "../../lib/i18n.js";
  import { itemTiers } from "../../lib/suggest/acquisition/tiers.js";
  import { bannerAside, bannerFor } from "../../lib/suggest/bannerArt.js";
  import { CARD_HEIGHT } from "../../lib/suggest/grid.js";
  import { valenceRowsFor } from "../../lib/suggest/valence.js";
  import { itemDb } from "../../stores/data.js";
  import { overframeRankingsRevision } from "../../stores/overframeRankings.js";
  import { nightwaveArt } from "../../stores/suggestionPrefs.js";
  import {
    CHIP_TONE,
    TONE,
    cardClock,
    choicesState,
    valencePercent,
    valenceTone,
  } from "./chips.js";
  import { ART_CYCLE_MS, artCycle, rewardArt, type RewardArt } from "./rewardArt.js";
  import StateChip from "./StateChip.svelte";
  import SuggestionDetailsModal from "./SuggestionDetailsModal.svelte";
  import TierBadge from "./TierBadge.svelte";
  import TimeLeft from "./TimeLeft.svelte";
  import ItemImage from "../ItemImage.svelte";
  import type { ValenceVerdict } from "../../lib/suggest/valence.js";
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
    wanted: CHIP_TONE.good,
    subsume: CHIP_TONE.warn,
    done: "border-border opacity-40",
  };

  const SEGMENT_TONE: Record<NonNullable<WhySegment["tone"]>, string> = {
    good: TONE.good,
    bad: TONE.bad,
  };

  /** The valence offer as fields, with the item's own tier joined on. */
  interface ValenceRow {
    name: string;
    tier: string | null;
    element: string;
    bonus: number;
    owned: number | null;
    result: number;
    verdict: ValenceVerdict;
  }

  /** What the face draws in the one line under the title. */
  interface CardLine {
    segments: WhySegment[];
    text: string;
  }

  /** A mission the player rates reads as its colour, never as a word. */
  function missionSegments(missions: SuggestionDetails["missions"]): WhySegment[] {
    return (missions ?? []).map((mission) =>
      mission.opinion ? { text: mission.name, tone: mission.opinion } : { text: mission.name },
    );
  }

  const choices = $derived(suggestion.choices ?? []);
  const details = $derived(suggestion.details);
  // A reward that could be one of several kinds never claims to be one of them:
  // a known colour draws its two grades at once, an unknown one steps through
  // the family.
  const reward = $derived.by(
    (): RewardArt =>
      choices.length > 0
        ? { mode: "single", pieces: [] }
        : rewardArt($itemDb, suggestion.reward, details?.pool ?? []),
  );
  const artPieces = $derived(reward.pieces);
  const art = $derived(artPieces[0] ?? null);
  // The frame every rotating card is on, off the one shared interval. Each card
  // starts at its own point in its family, so a row of them never shows the
  // same colour at the same moment.
  const phase = $derived(
    [...suggestion.id].reduce((sum, character) => sum + character.charCodeAt(0), 0),
  );
  const frame = $derived(
    reward.mode === "cycle" ? (Math.floor($artCycle / ART_CYCLE_MS) + phase) % artPieces.length : 0,
  );
  // The frame before it stays lit underneath while the new one rises over it, so
  // the box cross-fades between two pictures and is never empty. Fading one out
  // as the other came in left every rotating card dim for the whole transition.
  const under = $derived((frame - 1 + artPieces.length) % artPieces.length);
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
      : missionSegments(details?.missions),
  );

  // A refreshed Overframe table replaces the bundled one in place, so the tiers
  // only recompute when the revision is read here.
  const choiceTiers = $derived.by(() => {
    void $overframeRankingsRevision;
    return choices.map((choice) => choice.tier ?? itemTiers(choice.name));
  });
  const rewardTier = $derived.by(() => {
    void $overframeRankingsRevision;
    if (suggestion.tier) return suggestion.tier;
    return suggestion.reward ? itemTiers(suggestion.reward.name) : null;
  });

  // Empty for every card that is not an adversary vendor, so the field row is
  // scoped by the offer itself rather than by the category. The rows are already
  // ordered by gain, so the head of them is the offer worth buying.
  const valence = $derived.by((): ValenceRow | null => {
    void $cardClock;
    const offer = valenceRowsFor(suggestion.id)[0];
    if (!offer) return null;
    return {
      name: offer.displayName ?? offer.name,
      tier: offer.tier,
      element: offer.element,
      bonus: offer.bonus,
      owned: offer.owned,
      result: offer.result,
      verdict: offer.verdict,
    };
  });

  // The provider already decided which offers put the cap in reach, so the
  // percentage tones off its verdict rather than off a second copy of the
  // threshold. Reading the fused result instead coloured a weapon the player
  // already holds over the threshold and left an unowned one plain.
  const bonusTone = $derived(valence ? valenceTone(valence.verdict) : "");
  const valenceTitle = $derived.by((): string => {
    if (!valence) return $tr("nextUp.tileBonusTitle");
    const result = valencePercent(valence.result);
    return valence.owned === null
      ? $tr("nextUp.valenceFromNone", { result })
      : $tr("nextUp.valenceFused", { owned: valencePercent(valence.owned), result });
  });

  // Only a choice card's states differ from one another; everything in
  // Acquisition is by definition still needed, so a chip there says nothing.
  const cardState = $derived(
    choices.length > 0 ? choicesState(choices.map((choice) => choice.state)) : null,
  );

  // Tasks whose pool is the same every week. There is nothing to say about them
  // that the art, the bar and the pool list in the details do not already say.
  const CONSTANT_REWARD = new Set(["netracells", "deepArchimedea", "temporalArchimedea"]);
  const taskKey = $derived(suggestion.id.replace(/^[^:]+:/, ""));

  /** What the bar and its count already read as, in the provider's own wording,
   *  so the line never says the progress twice. */
  const barSays = $derived.by((): string[] => {
    const bar = suggestion.progress;
    if (!bar) return [];
    const remaining = String(Math.max(0, bar.required - bar.current));
    const target = String(bar.required);
    return [
      $tr("nextUp.whyRemaining", { remaining, target }),
      $tr("nextUp.whyAcqParts", { missing: remaining, total: target }),
      $tr("nextUp.whyAcqPartsOne", { missing: remaining, total: target }),
      $tr("nextUp.whyNightwaveStock", { held: String(bar.current), level: target }),
    ];
  });

  const spare = (text: string): boolean => barSays.includes(text.trim());

  // The chip and the field row say what the sentence spelled out, so the
  // sentence goes: a choice card's line only ever named a pick its own strips
  // draw, and an acquisition line leads with the state before its route.
  const line = $derived.by((): CardLine => {
    if (valence || choices.length > 0 || CONSTANT_REWARD.has(taskKey)) {
      return { segments: [], text: "" };
    }
    const supplied = suggestion.whySegments ?? [];
    if (details?.acquisition && supplied.length > 0) {
      return { segments: supplied.slice(1).filter((part) => !spare(part.text)), text: "" };
    }
    if (segments.length > 0)
      return { segments: segments.filter((part) => !spare(part.text)), text: "" };
    return {
      segments: [],
      text: why
        .split(" - ")
        .filter((part) => !spare(part))
        .join(" - "),
    };
  });
  const hasLine = $derived(line.segments.length > 0 || line.text.length > 0);

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
    {#each choices as choice, index (choice.name)}
      <div
        class="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden
               border-b-[3px] p-1 {STRIP[choice.state]}"
        title={choice.name}
      >
        <span class="over-art absolute right-0.5 top-0.5 z-[1]">
          <TierBadge tier={choiceTiers[index]} />
        </span>
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
      <div
        class="relative flex h-full w-full items-center p-1.5 {bannerAside(backdrop)}"
        title={artPieces.map((piece) => piece.name).join(" / ")}
      >
        <!-- A plate under the art, because a thin icon or a missing-art
             placeholder disappears into a banner. -->
        <span
          class="relative flex h-full items-center justify-center {backdrop
            ? 'w-[46%] rounded-[var(--radius-md)] bg-bg-deep/70'
            : 'w-full'}"
        >
          {#if reward.mode === "cycle"}
            <!-- Every frame is stacked in the one fixed box and only its opacity
                 changes, so the family steps past without anything moving. -->
            {#each artPieces as piece, index (index)}
              <!-- The frame's own box owns the fade, so a missing-art
                   placeholder never fights it for the opacity. -->
              <span
                class="absolute inset-0 flex items-center justify-center transition-opacity
                       duration-500 {index === frame
                  ? 'z-[2] opacity-100'
                  : index === under
                    ? 'z-[1] opacity-100'
                    : 'opacity-0'}"
              >
                <ItemImage src={piece.imageUrl} alt={piece.name} cls="max-h-full max-w-full" />
              </span>
            {/each}
          {:else}
            <!-- Stair-stepped: the drop is one of these grades and no single
                 piece of art is the truth. -->
            {#each artPieces as piece, index (index)}
              <ItemImage
                src={piece.imageUrl}
                alt={piece.name}
                cls={artPieces.length > 1
                  ? index === 0
                    ? "max-h-[72%] max-w-[48%] -translate-y-[14%]"
                    : "max-h-[72%] max-w-[48%] -ml-3 translate-y-[14%]"
                  : "max-h-full max-w-full"}
              />
            {/each}
          {/if}
        </span>
      </div>
    {:else if standIn}
      <div class="relative flex w-full items-center justify-center p-1.5">
        <img src={standIn.url} alt="" class="max-h-full max-w-full object-contain" />
      </div>
    {/if}
    <!-- The band's own corner, so the letter lands in one place whether art
         resolved or not. The field row rates the weapon it names instead. -->
    {#if choices.length === 0 && !valence}
      <span class="absolute right-1 top-1 z-[2]">
        <TierBadge tier={rewardTier} size="md" chip />
      </span>
    {/if}
  </div>

  <div class="flex min-h-0 flex-1 flex-col gap-1.5 p-2">
    <div class="grid h-6 grid-cols-[minmax(0,1fr)_1.5rem_1.5rem] items-center gap-x-3">
      <div class="flex min-w-0 items-center gap-2">
        <h3
          class="m-0 min-w-0 flex-1 truncate font-display text-sm font-medium leading-5
                 text-text-primary"
          title={suggestion.title}
        >
          {suggestion.title}
        </h3>
        <TimeLeft expiry={details?.expiry} nowMs={$cardClock} reserve />
      </div>
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

    <!-- One fixed row for what the card is about: the state as a chip, then
         either the offer's own fields or the line the provider wrote. -->
    <div class="flex h-4 min-w-0 items-center gap-1.5">
      {#if cardState}
        <StateChip state={cardState} />
      {/if}
      {#if valence}
        <span class="min-w-0 truncate text-xs leading-4 text-text-primary" title={valence.name}
          >{valence.name}</span
        >
        <TierBadge tier={valence.tier} />
        {#if valence.element}
          <span
            class="shrink-0 text-xs leading-4 text-text-secondary"
            title={$tr("nextUp.tileElementTitle")}>{valence.element}</span
          >
        {/if}
        <span class="shrink-0 text-xs leading-4 tabular-nums {bonusTone}" title={valenceTitle}
          >{$tr("nextUp.tileBonusExact", { bonus: valencePercent(valence.bonus) })}</span
        >
      {:else if hasLine}
        <p class="m-0 min-w-0 flex-1 truncate text-xs leading-4 text-text-secondary" title={why}>
          {#if line.segments.length > 0}{#each line.segments as segment, index (index)}<span
                class={segment.tone ? SEGMENT_TONE[segment.tone] : ""}
                >{index > 0 ? ", " : ""}{segment.text}</span
              >{/each}{:else}{line.text}{/if}
        </p>
      {/if}
    </div>

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
        {#if progress && complete}
          <!-- Marked done takes the button out of use, never off the card. -->
          <button
            class="{ICON_BTN} font-display text-[0.6875rem] font-semibold leading-none
                   disabled:cursor-default disabled:opacity-40"
            disabled={done}
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
  .choice-name,
  .over-art {
    -webkit-text-stroke: 2px var(--bg-deep);
    paint-order: stroke fill;
  }
</style>
