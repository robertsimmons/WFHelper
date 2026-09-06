<script lang="ts">
  import { parseIsoDate, timeTo } from "../../lib/format.js";
  import { tr } from "../../lib/i18n.js";
  import { send } from "../../lib/ipc.js";
  import { gradeClass } from "../../lib/suggest/circuit.js";
  import { resolveDropArt } from "../../lib/suggest/dropPools.js";
  import { overframeUrl } from "../../lib/suggest/overframe.js";
  import { ownedRewardFor, type OwnedReward } from "../../lib/suggest/ownedRewards.js";
  import { clockStore } from "../../lib/timers.js";
  import { componentOwnership, itemDb } from "../../stores/data.js";
  import ItemImage from "../ItemImage.svelte";
  import ModalShell from "../ModalShell.svelte";
  import WikiButton from "../WikiButton.svelte";
  import type { MessageKey } from "../../lib/i18n.js";
  import type {
    ChoiceState,
    MissionOpinion,
    RewardTier,
    Suggestion,
    SuggestionChoice,
    SuggestionOption,
  } from "../../types/suggest.js";

  interface Props {
    suggestion: Suggestion;
    onClose: () => void;
  }

  const { suggestion, onClose }: Props = $props();

  const clock = clockStore(1000);

  const STATE_LABEL: Record<ChoiceState, MessageKey> = {
    wanted: "nextUp.choiceTakeIt",
    subsume: "nextUp.choiceSubsumeOnly",
    done: "common.owned",
  };

  const STATE_COLOR: Record<ChoiceState, string> = {
    wanted: "text-success",
    subsume: "text-warning",
    done: "text-text-muted",
  };

  const FRAME_WORK: Record<ChoiceState, MessageKey> = {
    wanted: "nextUp.choiceNeedsFrame",
    subsume: "nextUp.choiceNeedsSubsume",
    done: "nextUp.choiceNeedsNothing",
  };

  /** The same tones the card gives a mission name in its why line. */
  const MISSION_TONE: Record<MissionOpinion, string> = {
    good: "text-success",
    bad: "text-danger",
  };

  const TIER_LABELS: Record<RewardTier, MessageKey> = {
    great: "nextUp.settingsTierGreat",
    good: "nextUp.settingsGood",
    ok: "nextUp.settingsTierOk",
    low: "nextUp.settingsLow",
  };

  const TIER_COLOR: Record<RewardTier, string> = {
    great: "text-success",
    good: "text-success",
    ok: "text-text-secondary",
    low: "text-text-muted",
  };

  const ROW = "grid grid-cols-[7rem_minmax(0,1fr)] items-baseline gap-3 py-1";
  const LABEL = "text-xs font-semibold uppercase tracking-[0.08em] text-text-muted";

  function optionArt(option: SuggestionOption) {
    return resolveDropArt($itemDb, option.name, option.uniqueName);
  }

  function ownedText(owned: OwnedReward): string {
    return owned.built === undefined
      ? $tr("nextUp.optionOwned", { count: String(owned.owned) })
      : $tr("nextUp.optionOwnedBuilt", {
          count: String(owned.owned),
          built: String(owned.built),
        });
  }

  function work(choice: SuggestionChoice): MessageKey {
    if (choice.kind === "frame") return FRAME_WORK[choice.state];
    return choice.state === "done" ? "nextUp.choiceAdapterOwned" : "nextUp.choiceAdapterWanted";
  }

  const choices = $derived(suggestion.choices ?? []);
  const art = $derived(
    suggestion.reward
      ? resolveDropArt($itemDb, suggestion.reward.name, suggestion.reward.uniqueName)
      : null,
  );
  const why = $derived(suggestion.whyWithReward ?? suggestion.why);
  const rewardOwned = $derived(ownedRewardFor(suggestion.reward, $itemDb, $componentOwnership));
  const details = $derived(suggestion.details);
  const pool = $derived(details?.pool ?? []);
  const missions = $derived(details?.missions ?? []);
  const options = $derived(details?.options ?? []);
  const expiryDate = $derived(parseIsoDate(details?.expiry ?? null));
  const progress = $derived(suggestion.progress);
  const hasExtra = $derived(
    Boolean(
      art ||
      suggestion.reward ||
      pool.length > 0 ||
      missions.length > 0 ||
      options.length > 0 ||
      expiryDate ||
      progress,
    ),
  );

  function openOverframe(href: string): void {
    send("open-external", href);
  }
</script>

{#snippet overframeLink(name: string | null | undefined)}
  {@const href = overframeUrl(name)}
  {#if href}
    <button
      class="detail-wiki-btn"
      title={$tr("nextUp.overframeTitle")}
      onclick={() => openOverframe(href)}
    >
      <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
        <path
          d="M8 1.5 14 5v6L8 14.5 2 11V5l6-3.5zm0 1.73L3.5 5.86v4.28L8 12.77l4.5-2.63V5.86L8 3.23z"
        />
      </svg>
      <span>{$tr("nextUp.overframe")}</span>
    </button>
  {/if}
{/snippet}

<ModalShell ariaLabel={suggestion.title} {onClose}>
  <div class="detail-panel p-4">
    <div class="mb-3 flex items-start justify-between gap-2">
      <span class="flex min-w-0 items-center gap-2">
        <h3 class="m-0 truncate font-display text-lg text-text-primary">{suggestion.title}</h3>
        {#if suggestion.wiki}
          <span class="shrink-0"><WikiButton fallbackName={suggestion.wiki} /></span>
        {/if}
        <span class="shrink-0">{@render overframeLink(suggestion.wiki)}</span>
      </span>
      <button
        class="btn-secondary btn-sm !px-2"
        aria-label={$tr("common.close")}
        title={$tr("common.close")}
        onclick={onClose}>&times;</button
      >
    </div>

    {#if choices.length > 0}
      <div class="flex flex-col divide-y divide-border">
        {#each choices as choice (choice.name)}
          <div class="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-3 py-3">
            <span
              class="flex h-18 w-18 items-center justify-center overflow-hidden
                     rounded-[var(--radius-md)] bg-black/20"
            >
              <ItemImage src={choice.imageUrl} alt={choice.name} cls="max-h-18 max-w-18" />
            </span>
            <div class="flex min-w-0 flex-col gap-1">
              <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span class="flex min-w-0 items-center gap-1">
                  <strong class="truncate font-display text-base text-text-primary"
                    >{choice.name}</strong
                  >
                  {#if choice.grade}
                    <span
                      class="font-display text-base font-semibold leading-none {gradeClass(
                        choice.grade,
                      )}"
                      title={$tr("nextUp.choiceGrade", { grade: choice.grade })}
                      >{choice.grade}</span
                    >
                  {/if}
                  <WikiButton fallbackName={choice.name} />
                  {@render overframeLink(choice.name)}
                </span>
                <span
                  class="text-xs font-semibold uppercase tracking-[0.08em] {STATE_COLOR[
                    choice.state
                  ]}">{$tr(STATE_LABEL[choice.state])}</span
                >
              </div>
              {#if choice.upgradePath}
                <span class="text-sm text-text-secondary"
                  >{$tr("nextUp.choiceUpgradePath", { path: choice.upgradePath })}</span
                >
              {/if}
              {#each choice.sources ?? [] as source (source.where)}
                <span class="text-sm text-text-secondary">
                  {$tr("nextUp.choiceSource", { where: source.where, kind: source.kind })}
                </span>
              {/each}
              {#if choice.kind === "frame"}
                <span class="text-sm text-text-secondary">
                  {choice.difficulty
                    ? $tr("nextUp.choiceDifficulty", { value: choice.difficulty })
                    : $tr("nextUp.choiceDifficultyUnrated")}
                </span>
              {/if}
              <span class="text-sm text-text-muted">{$tr(work(choice))}</span>
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <div class="flex gap-4">
        {#if art}
          <span
            class="flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden
                   rounded-[var(--radius-md)] bg-black/20"
          >
            <ItemImage src={art.imageUrl} alt={art.name} cls="max-h-28 max-w-28" />
          </span>
        {/if}
        <div class="flex min-w-0 flex-1 flex-col">
          <p class="m-0 text-sm leading-relaxed text-text-secondary">{why}</p>

          {#if suggestion.reward}
            <div class={ROW}>
              <span class={LABEL}>{$tr("nextUp.detailsReward")}</span>
              <span class="flex flex-wrap items-baseline gap-2">
                <span class="text-sm text-text-primary">{suggestion.reward.name}</span>
                {#if rewardOwned}
                  <span class="text-xs tabular-nums text-text-muted">{ownedText(rewardOwned)}</span>
                {/if}
              </span>
            </div>
          {/if}

          {#if pool.length > 0}
            <div class={ROW}>
              <span class={LABEL}>{$tr("nextUp.detailsPool")}</span>
              <span class="text-sm text-text-primary">{pool.join(", ")}</span>
            </div>
          {/if}

          {#if missions.length > 0}
            <div class={ROW}>
              <span class={LABEL}>{$tr("nextUp.detailsMissions")}</span>
              <span class="flex flex-wrap gap-x-2 gap-y-1 text-sm text-text-primary">
                {#each missions as mission (mission.name)}
                  <span class={mission.opinion ? MISSION_TONE[mission.opinion] : ""}>
                    {mission.name}
                    {#if mission.opinion}
                      ({$tr(
                        mission.opinion === "good"
                          ? "nextUp.detailsMissionGood"
                          : "nextUp.detailsMissionBad",
                      )})
                    {/if}
                  </span>
                {/each}
              </span>
            </div>
          {/if}

          {#if progress}
            <div class={ROW}>
              <span class={LABEL}>{$tr("nextUp.detailsProgress")}</span>
              <span class="text-sm text-text-primary"
                >{$tr("nextUp.detailsProgressValue", {
                  current: String(progress.current),
                  target: String(progress.required),
                })}</span
              >
            </div>
          {/if}

          {#if expiryDate}
            <div class={ROW}>
              <span class={LABEL}>{$tr("nextUp.detailsTimeLeft")}</span>
              <span class="text-sm text-text-primary">{timeTo(expiryDate, $clock)}</span>
            </div>
          {/if}

          {#if !hasExtra}
            <p class="mt-2 text-sm text-text-muted">{$tr("nextUp.detailsNothingMore")}</p>
          {/if}
        </div>
      </div>
    {/if}

    {#if options.length > 0}
      <div class="mt-3 flex flex-col gap-3 border-t border-border pt-3">
        <span class={LABEL}>{$tr("nextUp.detailsOptions")}</span>
        {#each options as group (group.day)}
          <div class="flex flex-col gap-1">
            <span class="text-sm text-text-secondary"
              >{$tr("dailies.calendarDay", { day: String(group.day) })}</span
            >
            <div class="flex flex-wrap gap-2">
              {#each group.options as option (option.name)}
                {@const art = optionArt(option)}
                {@const owned = ownedRewardFor(option, $itemDb, $componentOwnership)}
                <div
                  class="flex min-w-0 items-center gap-2 rounded-[var(--radius-md)] border
                         border-border px-2 py-1"
                >
                  <span
                    class="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden
                           rounded-[var(--radius-sm)] bg-black/20"
                  >
                    {#if art}
                      <ItemImage src={art.imageUrl} alt={option.name} cls="max-h-10 max-w-10" />
                    {/if}
                  </span>
                  <span class="flex min-w-0 flex-col">
                    <span class="truncate text-sm text-text-primary">{option.name}</span>
                    {#if option.tier}
                      <span
                        class="text-xs font-semibold uppercase tracking-[0.08em] {TIER_COLOR[
                          option.tier
                        ]}">{$tr(TIER_LABELS[option.tier])}</span
                      >
                    {/if}
                    {#if owned}
                      <span class="text-xs tabular-nums text-text-muted">{ownedText(owned)}</span>
                    {/if}
                  </span>
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</ModalShell>
