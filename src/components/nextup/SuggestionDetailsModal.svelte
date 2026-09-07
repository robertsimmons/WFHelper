<script lang="ts">
  import { formatNumber, parseIsoDate, timeTo } from "../../lib/format.js";
  import { tr } from "../../lib/i18n.js";
  import { send } from "../../lib/ipc.js";
  import { curatedWeapon } from "../../lib/suggest/acquisition/curatedWeapons.js";
  import { progenitors as frameProgenitors } from "../../lib/suggest/acquisition/progenitors.js";
  import { rankTiers } from "../../lib/suggest/acquisition/rankings.js";
  import { gradeClass } from "../../lib/suggest/circuit.js";
  import { resolveDropArt } from "../../lib/suggest/dropPools.js";
  import { overframeUrl } from "../../lib/suggest/overframe.js";
  import { pathKindLabel } from "../../lib/suggest/providers/acquisition.js";
  import { ownedRewardFor, ownsAny, type OwnedReward } from "../../lib/suggest/ownedRewards.js";
  import { rewardTier } from "../../lib/suggest/rewards.js";
  import { valenceDoc, valenceOffers } from "../../lib/suggest/valence.js";
  import { vendorOffers } from "../../lib/suggest/vendorOffers.js";
  import { clockStore } from "../../lib/timers.js";
  import { componentOwnership, foundryPending, itemDb } from "../../stores/data.js";
  import { overframeRankingsRevision } from "../../stores/overframeRankings.js";
  import { suggestionPreferences } from "../../stores/suggestionPrefs.js";
  import ItemTile from "./ItemTile.svelte";
  import ItemImage from "../ItemImage.svelte";
  import ModalShell from "../ModalShell.svelte";
  import WikiButton from "../WikiButton.svelte";
  import type { MessageKey } from "../../lib/i18n.js";
  import type {
    AcquisitionPath,
    NeedReason,
    NemesisBonusRange,
  } from "../../lib/suggest/acquisition/types.js";
  import type {
    ChoiceState,
    MissionOpinion,
    RewardTier,
    Suggestion,
    SuggestionChoice,
  } from "../../types/suggest.js";

  interface Props {
    suggestion: Suggestion;
    onClose: () => void;
  }

  const { suggestion, onClose }: Props = $props();

  const clock = clockStore(1000);
  // The vendor rotation only turns over between openings, so it is read once.
  const openedAtMs = Date.now();

  const STATE_LABEL: Record<ChoiceState, MessageKey> = {
    wanted: "nextUp.choiceTakeIt",
    subsume: "nextUp.choiceSubsumeOnly",
    done: "nextUp.done",
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

  const ROW = "grid grid-cols-[7rem_minmax(0,1fr)] items-baseline gap-3 py-1";
  const LABEL = "text-xs font-semibold uppercase tracking-[0.08em] text-text-muted";
  const CHIP = "rounded-[var(--radius-sm)] border border-border px-1.5 py-0.5 text-[0.6875rem]";

  const NEED_LABEL: Record<NeedReason, MessageKey> = {
    mastery: "nextUp.acqNeedMastery",
    subsume: "nextUp.acqNeedSubsume",
    incarnon: "nextUp.acqNeedIncarnon",
    prime: "nextUp.acqNeedPrime",
  };

  /** The whole point is easiest first; past this the list stops being a shortlist. */
  const ROUTE_LIMIT = 6;
  const LIST_LIMIT = 8;

  function costChips(path: AcquisitionPath): string[] {
    const chips: string[] = [];
    if (path.cost.credits !== null) {
      chips.push($tr("nextUp.acqCredits", { credits: formatNumber(path.cost.credits) }));
    }
    const plat = path.cost.plat;
    const set = plat?.set ?? null;
    const parts = plat?.partsTotal ?? null;
    if (set !== null) chips.push($tr("nextUp.acqPlatSet", { plat: String(Math.round(set)) }));
    // Buying the set and buying every part are two prices only when they differ.
    if (parts !== null && parts !== set) {
      chips.push($tr("nextUp.acqPlatParts", { plat: String(Math.round(parts)) }));
    }
    const relics = path.cost.relics;
    if (relics?.known) {
      chips.push(
        $tr(relics.held >= relics.needed ? "nextUp.acqRelicsReady" : "nextUp.acqRelicsShort", {
          held: String(relics.held),
          needed: String(relics.needed),
        }),
      );
    }
    return chips;
  }

  function work(choice: SuggestionChoice): MessageKey {
    if (choice.kind === "frame") return FRAME_WORK[choice.state];
    return choice.state === "done" ? "nextUp.choiceNeedsNothing" : "nextUp.choiceNeedsAdapter";
  }

  const FRAME_ELEMENT = new Map(
    frameProgenitors.flatMap((row) => row.warframes.map((frame) => [frame, row.element] as const)),
  );

  interface Tile {
    name: string;
    imageUrl: string | null;
    grade: string | null;
    tier: RewardTier | null;
    owned: OwnedReward | null;
    element: string | null;
    bonus: NemesisBonusRange | number | null;
    have: boolean;
  }

  interface TileFacts {
    tier?: RewardTier | null | undefined;
    element?: string | null | undefined;
    bonus?: number | null | undefined;
  }

  function itemTile(
    item: { name: string; uniqueName?: string | undefined },
    facts: TileFacts = {},
  ): Tile {
    const art = resolveDropArt($itemDb, item.name, item.uniqueName);
    const owned = ownedRewardFor(item, $itemDb, $componentOwnership, $foundryPending);
    return {
      name: art?.name ?? item.name,
      imageUrl: art?.imageUrl ?? null,
      grade: rankTiers(item.name),
      tier: facts.tier ?? rewardTier($suggestionPreferences, item.name),
      owned,
      element: facts.element ?? null,
      // The roll the vendor is actually holding beats the window it rolls in.
      bonus: facts.bonus ?? curatedWeapon(item.name).nemesis?.bonus ?? null,
      have: ownsAny(owned),
    };
  }

  const choices = $derived(suggestion.choices ?? []);
  const art = $derived(
    suggestion.reward
      ? resolveDropArt($itemDb, suggestion.reward.name, suggestion.reward.uniqueName)
      : null,
  );
  const why = $derived(suggestion.whyWithReward ?? suggestion.why);
  const details = $derived(suggestion.details);
  const pool = $derived(details?.pool ?? []);
  const missions = $derived(details?.missions ?? []);
  const options = $derived(details?.options ?? []);
  const taskId = $derived(suggestion.complete?.taskId ?? "");
  // Whatever the wiki caught the adversary vendor holding this rotation. Empty
  // until the doc lands, which reads as unknown rather than as no stock.
  const valenceRows = $derived(valenceOffers(valenceDoc(), taskId, openedAtMs));
  // The real stock wins wherever world state carries one; the curated table only
  // names vendors it cannot describe.
  const offers = $derived(pool.length > 0 ? [] : vendorOffers(taskId));
  const acq = $derived(details?.acquisition ?? null);
  const acqParts = $derived(
    acq?.parts.known ? [...(acq.parts.main ? [acq.parts.main] : []), ...acq.parts.components] : [],
  );
  const acqMaterials = $derived(
    (acq?.parts.materials ?? []).filter((row) => row.missing > 0).slice(0, LIST_LIMIT),
  );
  const acqPaths = $derived((acq?.paths ?? []).slice(0, ROUTE_LIMIT));
  const progenitors = $derived(acq?.nemesis?.progenitors ?? []);
  let pickedElement = $state("");
  const pickedProgenitor = $derived(
    progenitors.find((row) => row.element === pickedElement) ?? progenitors[0] ?? null,
  );
  const expiryDate = $derived(parseIsoDate(details?.expiry ?? null));
  const progress = $derived(suggestion.progress);

  // A refreshed Overframe table replaces the bundled one in place, so the tiers
  // only recompute when the revision is read here.
  const rewardTileModel = $derived.by(() => {
    void $overframeRankingsRevision;
    return suggestion.reward ? itemTile(suggestion.reward) : null;
  });
  const offerTiles = $derived.by(() => {
    void $overframeRankingsRevision;
    if (valenceRows.length === 0) return offers.map((offer) => itemTile(offer));
    const curatedOffers = vendorOffers(taskId);
    return valenceRows.map((row) => {
      const needle = row.name.toLowerCase();
      const known = curatedOffers.find((offer) => offer.name.toLowerCase() === needle);
      return itemTile(known ?? { name: row.name }, { element: row.element, bonus: row.bonus });
    });
  });
  const optionTiles = $derived.by(() => {
    void $overframeRankingsRevision;
    return options.map((group) => ({
      day: group.day,
      tiles: group.options.map((option) => itemTile(option, { tier: option.tier ?? null })),
    }));
  });
  const partTiles = $derived(
    acqParts.map((part) => ({
      key: part.uniqueName,
      main: part.role === "main",
      label: part.displayName ?? part.name,
      imageUrl: resolveDropArt($itemDb, part.name, part.uniqueName)?.imageUrl ?? null,
      owned: { owned: part.owned },
      required: part.missing === 0 ? null : part.required,
      have: part.missing === 0,
    })),
  );
  const hasExtra = $derived(
    Boolean(
      art ||
      suggestion.reward ||
      pool.length > 0 ||
      offerTiles.length > 0 ||
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
      <div class="flex flex-col gap-2">
        {#each choices as choice (choice.name)}
          <ItemTile
            name={choice.name}
            imageUrl={choice.imageUrl}
            grade={choice.grade}
            element={choice.kind === "frame" ? (FRAME_ELEMENT.get(choice.name) ?? null) : null}
            have={choice.state === "done"}
            size="md"
            stretch
          >
            {#snippet actions()}
              <WikiButton fallbackName={choice.name} />
              {@render overframeLink(choice.name)}
              <span
                class="ml-auto shrink-0 pl-2 text-xs font-semibold uppercase tracking-[0.08em]
                       {STATE_COLOR[choice.state]}">{$tr(STATE_LABEL[choice.state])}</span
              >
            {/snippet}
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
          </ItemTile>
        {/each}
      </div>
    {:else}
      <div class="flex gap-4">
        {#if art}
          <span
            class="flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden
                   rounded-[var(--radius-md)] bg-bg-deep"
          >
            <ItemImage src={art.imageUrl} alt={art.name} cls="max-h-28 max-w-28" />
          </span>
        {/if}
        <div class="flex min-w-0 flex-1 flex-col">
          <p class="m-0 text-sm leading-relaxed text-text-secondary">{why}</p>

          {#if rewardTileModel}
            <div class={ROW}>
              <span class={LABEL}>{$tr("nextUp.detailsReward")}</span>
              <span class="flex min-w-0">
                <ItemTile
                  name={rewardTileModel.name}
                  showArt={false}
                  grade={rewardTileModel.grade}
                  tier={rewardTileModel.tier}
                  owned={rewardTileModel.owned}
                  bonus={rewardTileModel.bonus}
                />
              </span>
            </div>
          {/if}

          {#if pool.length > 0 && valenceRows.length === 0}
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

    {#if offerTiles.length > 0}
      <div class="mt-3 flex flex-col gap-2 border-t border-border pt-3">
        <span class={LABEL}>{$tr("nextUp.detailsOffers")}</span>
        <div class="flex flex-wrap gap-2">
          {#each offerTiles as tile, index (index)}
            <ItemTile
              name={tile.name}
              imageUrl={tile.imageUrl}
              grade={tile.grade}
              tier={tile.tier}
              owned={tile.owned}
              element={tile.element}
              bonus={tile.bonus}
              have={tile.have}
            />
          {/each}
        </div>
      </div>
    {/if}

    {#if options.length > 0}
      <div class="mt-3 flex flex-col gap-3 border-t border-border pt-3">
        <span class={LABEL}>{$tr("nextUp.detailsOptions")}</span>
        {#each optionTiles as group (group.day)}
          <div class="flex flex-col gap-1">
            <span class="text-sm text-text-secondary"
              >{$tr("dailies.calendarDay", { day: String(group.day) })}</span
            >
            <div class="flex flex-wrap gap-2">
              {#each group.tiles as tile, index (index)}
                <ItemTile
                  name={tile.name}
                  imageUrl={tile.imageUrl}
                  grade={tile.grade}
                  tier={tile.tier}
                  owned={tile.owned}
                  element={tile.element}
                  bonus={tile.bonus}
                  have={tile.have}
                />
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {/if}

    {#if acq}
      <div class="mt-3 flex flex-col gap-3 border-t border-border pt-3">
        <div class="flex flex-col">
          <div class={ROW}>
            <span class={LABEL}>{$tr("nextUp.acqNeeds")}</span>
            <span class="flex flex-wrap gap-1.5">
              {#each acq.needs as need (need)}
                <span class="{CHIP} text-text-primary">{$tr(NEED_LABEL[need])}</span>
              {/each}
            </span>
          </div>

          {#if acq.rank}
            <div class={ROW}>
              <span class={LABEL}>{$tr("nextUp.acqRank")}</span>
              <span class="font-display text-base font-semibold leading-none {gradeClass(acq.rank)}"
                >{acq.rank}</span
              >
            </div>
          {/if}

          {#if acq.difficulty}
            <div class={ROW}>
              <span class={LABEL}>{$tr("nextUp.acqDifficulty")}</span>
              <span class="text-sm capitalize text-text-primary">{acq.difficulty}</span>
            </div>
          {/if}

          {#if acq.parts.known}
            <div class={ROW}>
              <span class={LABEL}>{$tr("common.foundry")}</span>
              <span class="flex flex-wrap items-baseline gap-2 text-sm text-text-primary">
                <span class="tabular-nums"
                  >{$tr("nextUp.acqFoundryCredits", {
                    credits: formatNumber(acq.parts.credits),
                  })}</span
                >
                <span class="text-xs {acq.parts.buildable ? 'text-success' : 'text-text-muted'}"
                  >{$tr(
                    acq.parts.buildable ? "nextUp.acqFoundryReady" : "nextUp.acqFoundryWaiting",
                  )}</span
                >
              </span>
            </div>
          {/if}

          {#if acq.nemesis}
            <div class={ROW}>
              <span class={LABEL}>{$tr("nextUp.acqNemesis")}</span>
              <span class="flex flex-wrap items-baseline gap-x-2 text-sm text-text-primary">
                <span class="capitalize">{acq.nemesis.family}</span>
                {#if acq.nemesis.bonus}
                  <span class="text-xs text-text-secondary"
                    >{$tr("nextUp.acqNemesisBonus", {
                      min: String(acq.nemesis.bonus.min),
                      max: String(acq.nemesis.bonus.max),
                    })}</span
                  >
                {/if}
                {#if acq.nemesis.elements.length > 0}
                  <span class="text-xs text-text-secondary"
                    >{$tr("nextUp.acqNemesisElements", {
                      elements: acq.nemesis.elements.join(", "),
                    })}</span
                  >
                {/if}
              </span>
            </div>
          {/if}
        </div>

        {#if pickedProgenitor}
          <div class="flex flex-col gap-1">
            <span class={LABEL}>{$tr("nextUp.acqProgenitors")}</span>
            <span class="flex flex-wrap gap-1.5">
              {#each progenitors as row (row.element)}
                <button
                  class="{CHIP} cursor-pointer transition-colors duration-150 {row.element ===
                  pickedProgenitor.element
                    ? 'border-accent bg-accent text-bg-base'
                    : 'text-text-secondary hover:text-text-primary'}"
                  aria-pressed={row.element === pickedProgenitor.element}
                  onclick={() => (pickedElement = row.element)}>{row.element}</button
                >
              {/each}
            </span>
            <p class="m-0 text-sm leading-snug text-text-secondary">
              {pickedProgenitor.warframes.join(", ")}
            </p>
            <span class="text-xs tabular-nums text-text-muted"
              >{$tr("nextUp.acqProgenitorCount", {
                count: String(pickedProgenitor.warframes.length),
              })}</span
            >
          </div>
        {/if}

        {#if partTiles.length > 0}
          <div class="flex flex-col gap-1">
            <span class={LABEL}>{$tr("nextUp.acqParts")}</span>
            <div class="flex flex-col gap-1.5">
              {#each partTiles as tile (tile.key)}
                <ItemTile
                  name={tile.label}
                  imageUrl={tile.imageUrl}
                  owned={tile.owned}
                  required={tile.required}
                  have={tile.have}
                  stretch
                >
                  {#snippet actions()}
                    {#if tile.main}
                      <span
                        class="shrink-0 text-[0.625rem] font-semibold uppercase tracking-[0.08em]
                               text-accent">{$tr("nextUp.acqPartMain")}</span
                      >
                    {/if}
                  {/snippet}
                </ItemTile>
              {/each}
            </div>
          </div>
        {/if}

        {#if acqMaterials.length > 0}
          <div class="flex flex-col gap-1">
            <span class={LABEL}>{$tr("nextUp.acqMaterials")}</span>
            <span class="flex flex-wrap gap-1.5">
              {#each acqMaterials as row (row.uniqueName)}
                <span class="{CHIP} text-text-secondary"
                  >{row.displayName ?? row.name}
                  <span class="tabular-nums text-text-muted"
                    >{$tr("nextUp.acqPartCount", { count: String(row.missing) })}</span
                  ></span
                >
              {/each}
            </span>
          </div>
        {/if}

        <div class="flex flex-col gap-2">
          <span class={LABEL}>{$tr("nextUp.acqRoutes")}</span>
          {#if acqPaths.length === 0}
            <p class="m-0 text-sm text-text-muted">{$tr("nextUp.acqNoRoutes")}</p>
          {/if}
          {#each acqPaths as path (path.id)}
            <div class="flex flex-col gap-1.5 rounded-[var(--radius-md)] border border-border p-2">
              <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span class="flex min-w-0 items-baseline gap-2">
                  <strong class="font-display text-sm text-text-primary"
                    >{$tr(pathKindLabel(path.kind))}</strong
                  >
                  {#if !path.complete && path.covers.length > 0}
                    <span class="truncate text-xs text-text-muted"
                      >{$tr("nextUp.acqRouteCovers", { parts: path.covers.join(", ") })}</span
                    >
                  {/if}
                </span>
                <span class="flex flex-wrap gap-1.5">
                  {#each costChips(path) as chip (chip)}
                    <span class="{CHIP} tabular-nums text-text-secondary">{chip}</span>
                  {/each}
                </span>
              </div>

              {#if path.steps.length === 1}
                <p class="m-0 text-sm leading-snug text-text-secondary">{path.steps[0].where}</p>
              {:else}
                <ol
                  class="m-0 flex list-decimal flex-col gap-1 pl-5 text-sm leading-snug
                         text-text-secondary"
                >
                  {#each path.steps as step, index (index)}
                    <li>{step.where}</li>
                  {/each}
                </ol>
              {/if}

              {#if path.cost.relics?.known}
                {#if path.cost.relics.rows.length === 0}
                  <p class="m-0 text-xs text-text-muted">{$tr("nextUp.acqRelicsNone")}</p>
                {:else}
                  <span class="flex flex-wrap gap-1.5">
                    {#each path.cost.relics.rows.slice(0, LIST_LIMIT) as row (row.relic + row.part)}
                      <span class="{CHIP} text-text-secondary"
                        >{$tr("nextUp.acqRelicRow", { relic: row.relic, part: row.part })}
                        <span
                          class="tabular-nums {row.held > 0 ? 'text-success' : 'text-text-muted'}"
                          >({$tr("nextUp.acqRelicHeld", { held: String(row.held) })})</span
                        ></span
                      >
                    {/each}
                  </span>
                {/if}
              {/if}

              {#if path.cost.plat && path.cost.plat.parts.length > 1}
                <span class="flex flex-wrap gap-1.5">
                  {#each path.cost.plat.parts as row (row.name)}
                    <span class="{CHIP} text-text-secondary"
                      >{row.name}
                      <span class="tabular-nums text-text-muted"
                        >({row.plat === null
                          ? $tr("nextUp.acqPlatUnpriced")
                          : $tr("nextUp.acqPlatEach", {
                              plat: String(Math.round(row.plat)),
                            })})</span
                      ></span
                    >
                  {/each}
                </span>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</ModalShell>
