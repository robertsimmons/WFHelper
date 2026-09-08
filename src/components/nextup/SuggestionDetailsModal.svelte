<script lang="ts">
  import { SvelteMap } from "svelte/reactivity";

  import { formatNumber } from "../../lib/format.js";
  import { tr } from "../../lib/i18n.js";
  import { send } from "../../lib/ipc.js";
  import { progenitors as frameProgenitors } from "../../lib/suggest/acquisition/progenitors.js";
  import { itemTiers } from "../../lib/suggest/acquisition/tiers.js";
  import { resolveDropArt } from "../../lib/suggest/dropPools.js";
  import { overframeUrl } from "../../lib/suggest/overframe.js";
  import { pathKindLabel } from "../../lib/suggest/providers/acquisition.js";
  import { ownedRewardFor, ownsAny, type OwnedReward } from "../../lib/suggest/ownedRewards.js";
  import { nightwaveRowFor } from "../../lib/suggest/providers/nightwave.js";
  import { liveVendorOffers } from "../../lib/suggest/providers/vendors.js";
  import { VALENCE_CAP, valenceRowsFor } from "../../lib/suggest/valence.js";
  import { componentOwnership, foundryPending, itemDb } from "../../stores/data.js";
  import { overframeRankingsRevision } from "../../stores/overframeRankings.js";
  import { worldData } from "../../stores/world.js";
  import { cardClock, timeLeftText, valencePercent } from "./chips.js";
  import ItemTile from "./ItemTile.svelte";
  import StateChip from "./StateChip.svelte";
  import TimeLeft from "./TimeLeft.svelte";
  import ItemImage from "../ItemImage.svelte";
  import ModalShell from "../ModalShell.svelte";
  import WikiButton from "../WikiButton.svelte";
  import type { MessageKey } from "../../lib/i18n.js";
  import type {
    AcquisitionPath,
    NeedReason,
    NemesisBonusRange,
  } from "../../lib/suggest/acquisition/types.js";
  import type { NightwaveOfferRow } from "../../lib/suggest/providers/nightwave.js";
  import type {
    ChoiceState,
    MissionOpinion,
    RewardWorth,
    Suggestion,
    SuggestionCategory,
    SuggestionChoice,
    SuggestionOption,
  } from "../../types/suggest.js";

  interface Props {
    suggestion: Suggestion;
    onClose: () => void;
  }

  const { suggestion, onClose }: Props = $props();

  const FRAME_WORK: Record<ChoiceState, MessageKey> = {
    wanted: "nextUp.choiceNeedsFrame",
    subsume: "nextUp.choiceNeedsSubsume",
    done: "nextUp.choiceNeedsNothing",
  };

  /** The same tones the card gives a mission name in its why line. */
  const MISSION_TONE: Record<MissionOpinion, string> = {
    good: "border-success/60 bg-success/10 text-success",
    bad: "border-danger/60 bg-danger/10 text-danger",
  };

  /** What a bare `3/5` counts, which is a different thing in every section. A
   *  category with no honest word for it draws no row. */
  const PROGRESS_LABEL: Partial<Record<SuggestionCategory, MessageKey>> = {
    daily: "nextUp.detailsRuns",
    weekly: "nextUp.detailsRuns",
    nightwave: "nextUp.detailsRuns",
    relics: "nextUp.detailsRuns",
    acquisition: "nextUp.acqParts",
  };

  /** The Cred shop files its cards under `vendor` alongside the stalls, so the
   *  row it parked is what tells the two apart. Nothing it sells is a run: a
   *  purchase counts parts of a set, and a staple's shortfall is already the
   *  first thing the why line says. */
  const CRED_PROGRESS: Record<NightwaveOfferRow["kind"], MessageKey | null> = {
    stock: null,
    parts: "nextUp.acqParts",
  };

  const ROW = "grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3 py-1";
  const LABEL = "text-xs font-semibold uppercase tracking-[0.08em] text-text-muted";
  const CHIP = "rounded-[var(--radius-sm)] border border-border px-1.5 py-0.5 text-[0.6875rem]";
  /** Equal cells, so a tier letter lands in the same place on every row. */
  const TILE_GRID = "grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2";
  const COUNT = "font-display text-xs font-semibold tabular-nums text-text-secondary";
  /** Sits inside a tile, so it reads a size down from the row labels. */
  const MICRO = "text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-text-muted";

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
    tier: string | null;
    owned: OwnedReward | null;
    element: string | null;
    bonus: NemesisBonusRange | number | null;
    have: boolean;
  }

  /** A vendor offer as one row: the weapon, the roll, and what buying it makes. */
  interface ValenceTile {
    tile: Tile;
    /** Null where the player owns none, and then nothing is drawn for it. */
    owned: number | null;
    result: number;
    capped: boolean;
  }

  /** One thing a stall is holding, at the price its manifest puts on it. */
  interface PoolTile {
    tile: Tile;
    cost: string[];
  }

  interface TileFacts {
    tier?: string | null | undefined;
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
      tier: facts.tier ?? itemTiers(item.name),
      owned,
      element: facts.element ?? null,
      // Only the roll this copy carries; the window the family rolls in is not
      // something the reader is told.
      bonus: facts.bonus ?? null,
      have: ownsAny(owned),
    };
  }

  /** An unrated name sorts behind every rated one rather than ahead of "low". */
  const WORTH_RANK: Record<RewardWorth, number> = { great: 0, good: 1, ok: 2, low: 3 };
  const UNRATED_RANK = 4;

  /** A day's pick, best first: the better worth, then the thinner stack. */
  function pickScore(option: SuggestionOption, tile: Tile): number[] {
    const held = (tile.owned?.owned ?? 0) + (tile.owned?.built ?? 0) + (tile.owned?.pending ?? 0);
    return [option.worth ? WORTH_RANK[option.worth] : UNRATED_RANK, held];
  }

  function compareScores(a: readonly number[], b: readonly number[]): number {
    for (const [index, value] of a.entries()) {
      const other = b[index] ?? 0;
      if (value !== other) return value - other;
    }
    return 0;
  }

  /** Two picks that compare equal are a coin flip, so nothing is highlighted. */
  function suggestedIndex(options: readonly SuggestionOption[], tiles: readonly Tile[]): number {
    if (tiles.length < 2) return -1;
    const ranked = tiles
      .map((tile, index) => ({
        index,
        score: pickScore(options[index] ?? { name: tile.name }, tile),
      }))
      .sort((a, b) => compareScores(a.score, b.score));
    const [first, second] = ranked;
    if (!first || !second) return -1;
    return compareScores(first.score, second.score) === 0 ? -1 : first.index;
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
  // A stall's pool is what it is holding, not what drops off anything.
  const poolLabel = $derived<MessageKey>(
    suggestion.category === "vendor" ? "nextUp.detailsStock" : "nextUp.detailsPool",
  );
  const missions = $derived(details?.missions ?? []);
  const options = $derived(details?.options ?? []);
  const taskId = $derived(suggestion.complete?.taskId ?? "");
  // The rows the provider resolved against the player's own weapons, most
  // advancing first. Empty means the wiki table named none of them, which is
  // unknown rather than no stock.
  const valenceRows = $derived(valenceRowsFor(suggestion.id));
  // The real stock wins wherever world state carries one; the curated table only
  // names vendors it cannot describe.
  const offers = $derived(
    pool.length > 0 || valenceRows.length > 0 ? [] : liveVendorOffers(taskId, $cardClock),
  );
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
  const timeLeft = $derived(timeLeftText(details?.expiry, $cardClock));
  const progress = $derived(suggestion.progress);
  const credRow = $derived(nightwaveRowFor(suggestion.id));
  const progressLabel = $derived(
    credRow ? CRED_PROGRESS[credRow.kind] : (PROGRESS_LABEL[suggestion.category] ?? null),
  );

  // A refreshed Overframe table replaces the bundled one in place, so the tiers
  // only recompute when the revision is read here.
  const rewardTileModel = $derived.by(() => {
    void $overframeRankingsRevision;
    // The provider's own letter wins: it carries the player's override, which
    // the shipped table does not.
    return suggestion.reward
      ? itemTile(suggestion.reward, { tier: suggestion.tier ?? acq?.tier ?? null })
      : null;
  });
  /** What a live manifest charges for each thing on it, by item name. */
  const vendorPrices = $derived.by(() => {
    const out = new SvelteMap<string, { ducats: number; credits: number }>();
    for (const trader of [$worldData?.voidTrader, $worldData?.vaultTrader]) {
      for (const entry of trader?.inventory ?? []) {
        const name = entry.item?.trim();
        if (!name) continue;
        out.set(name.toLowerCase(), { ducats: entry.ducats ?? 0, credits: entry.credits ?? 0 });
      }
    }
    return out;
  });

  function priceChips(name: string): string[] {
    const price = vendorPrices.get(name.trim().toLowerCase());
    if (!price) return [];
    const chips: string[] = [];
    if (price.ducats > 0) {
      chips.push($tr("world.baro.ducatsShort", { count: formatNumber(price.ducats) }));
    }
    if (price.credits > 0) {
      chips.push($tr("world.baro.creditsShort", { amount: formatNumber(price.credits) }));
    }
    return chips;
  }

  const poolTiles = $derived.by((): PoolTile[] => {
    void $overframeRankingsRevision;
    return pool.map((name) => ({ tile: itemTile({ name }), cost: priceChips(name) }));
  });
  const offerTiles = $derived.by(() => {
    void $overframeRankingsRevision;
    return offers.map((offer) => itemTile(offer));
  });
  const valenceTiles = $derived.by(() => {
    void $overframeRankingsRevision;
    return valenceRows.map((row) => {
      const tile = itemTile(
        { name: row.name, uniqueName: row.uniqueName },
        { tier: row.tier, element: row.element, bonus: row.bonus },
      );
      return {
        // Nothing on the table lifts a finished weapon, so it reads as owned.
        tile: { ...tile, name: row.displayName ?? tile.name, have: row.verdict === "done" },
        owned: row.owned,
        result: row.result,
        capped: row.result >= VALENCE_CAP,
      };
    });
  });
  const optionTiles = $derived.by(() => {
    void $overframeRankingsRevision;
    return options.map((group) => {
      // The label loses the "Calendar " prefix; every lookup still joins on the
      // full name.
      const tiles = group.options.map((option) => {
        const tile = itemTile(option);
        return { ...tile, name: option.displayName ?? tile.name };
      });
      return { day: group.day, tiles, pick: suggestedIndex(group.options, tiles) };
    });
  });
  const progenitorTiles = $derived.by(() => {
    void $overframeRankingsRevision;
    return (pickedProgenitor?.warframes ?? []).map((frame) => itemTile({ name: frame }));
  });
  const partTiles = $derived.by(() => {
    void $overframeRankingsRevision;
    return acqParts.map((part) => ({
      key: part.uniqueName,
      main: part.role === "main",
      label: part.displayName ?? part.name,
      tier: itemTiers(part.name),
      imageUrl: resolveDropArt($itemDb, part.name, part.uniqueName)?.imageUrl ?? null,
      owned: { owned: part.owned },
      required: part.missing === 0 ? null : part.required,
      have: part.missing === 0,
    }));
  });
  // The count the parts list adds up to.
  const partsHeld = $derived(acqParts.filter((part) => part.missing === 0).length);
  const materialTiles = $derived.by(() => {
    void $overframeRankingsRevision;
    return acqMaterials.map((row) => ({
      key: row.uniqueName,
      label: row.displayName ?? row.name,
      tier: itemTiers(row.name),
      imageUrl: resolveDropArt($itemDb, row.name, row.uniqueName)?.imageUrl ?? null,
      owned: { owned: row.owned },
      required: row.required,
    }));
  });
  /** A stall holding one thing the reward already names has nothing to add. */
  const extraOffers = $derived(
    offerTiles.length > 1 ||
      (offerTiles.length === 1 && offerTiles[0]?.name !== rewardTileModel?.name),
  );
  const hasExtra = $derived(
    Boolean(
      art ||
      suggestion.reward ||
      pool.length > 0 ||
      extraOffers ||
      valenceTiles.length > 0 ||
      missions.length > 0 ||
      options.length > 0 ||
      timeLeft ||
      (progress && progressLabel),
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

<!-- Every named item draws the same way: art, name, its tier, and whether it is
     already yours. -->
{#snippet itemRow(tile: Tile)}
  <ItemTile
    name={tile.name}
    imageUrl={tile.imageUrl}
    tier={tile.tier}
    owned={tile.owned}
    element={tile.element}
    bonus={tile.bonus}
    have={tile.have}
    stretch
  ></ItemTile>
{/snippet}

<!-- Stall stock reads as the item plus what the manifest charges for it. -->
{#snippet poolRow(row: PoolTile)}
  <ItemTile
    name={row.tile.name}
    imageUrl={row.tile.imageUrl}
    tier={row.tile.tier}
    owned={row.tile.owned}
    element={row.tile.element}
    bonus={row.tile.bonus}
    have={row.tile.have}
    stretch
  >
    {#if row.cost.length > 0}
      <span
        class="flex flex-wrap items-center gap-x-2 text-[0.6875rem] leading-tight tabular-nums
               text-text-secondary"
      >
        {#each row.cost as chip (chip)}
          <span>{chip}</span>
        {/each}
      </span>
    {/if}
  </ItemTile>
{/snippet}

<!-- The offered roll, what the player holds, and what a purchase makes of it. -->
{#snippet valenceOfferRow(row: ValenceTile)}
  <ItemTile
    name={row.tile.name}
    imageUrl={row.tile.imageUrl}
    tier={row.tile.tier}
    owned={row.tile.owned}
    element={row.tile.element}
    bonus={row.tile.bonus}
    have={row.tile.have}
    stretch
  >
    <span
      class="flex flex-wrap items-center gap-x-3 text-[0.6875rem] leading-tight tabular-nums"
      title={row.owned === null
        ? $tr("nextUp.valenceFromNone", { result: valencePercent(row.result) })
        : $tr("nextUp.valenceFused", {
            owned: valencePercent(row.owned),
            result: valencePercent(row.result),
          })}
    >
      <!-- A weapon the player owns none of has no percentage to draw. -->
      {#if row.owned !== null}
        <span class="flex items-center gap-1">
          <span class={MICRO}>{$tr("nextUp.valenceYours")}</span>
          <span class="text-text-primary"
            >{$tr("nextUp.tileBonusExact", { bonus: valencePercent(row.owned) })}</span
          >
        </span>
      {/if}
      <span class="flex items-center gap-1">
        <span class={MICRO}>{$tr("nextUp.valenceAfter")}</span>
        <span class={row.capped ? "font-semibold text-success" : "text-text-secondary"}
          >{$tr("nextUp.tileBonusExact", { bonus: valencePercent(row.result) })}</span
        >
      </span>
    </span>
  </ItemTile>
{/snippet}

<!-- What the activity pays and asks for, whether or not the week offers a pick. -->
{#snippet factRows()}
  {#if poolTiles.length > 0 && valenceRows.length === 0}
    <div class={ROW}>
      <span class={LABEL}>{$tr(poolLabel)}</span>
      <div class={TILE_GRID}>
        {#each poolTiles as row, index (index)}
          {@render poolRow(row)}
        {/each}
      </div>
    </div>
  {/if}

  {#if missions.length > 0}
    <div class={ROW}>
      <span class={LABEL}>{$tr("nextUp.detailsMissions")}</span>
      <span class="flex flex-wrap gap-1.5">
        {#each missions as mission (mission.name)}
          <span
            class="{CHIP} {mission.opinion ? MISSION_TONE[mission.opinion] : 'text-text-primary'}"
            >{mission.name}{#if mission.opinion}<span
                class="pl-1 font-semibold uppercase tracking-[0.08em]"
                >{$tr(
                  mission.opinion === "good"
                    ? "nextUp.detailsMissionGood"
                    : "nextUp.detailsMissionBad",
                )}</span
              >{/if}</span
          >
        {/each}
      </span>
    </div>
  {/if}

  <!-- Acquisition counts parts, and the parts list carries that total. -->
  {#if progress && progressLabel && !acq}
    <div class={ROW}>
      <span class={LABEL}>{$tr(progressLabel)}</span>
      <span
        class={COUNT}
        title={$tr("nextUp.detailsProgressValue", {
          current: String(progress.current),
          target: String(progress.required),
        })}>{progress.current}/{progress.required}</span
      >
    </div>
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
        <!-- Urgency reads as a pill, in the one place every view keeps it. -->
        <TimeLeft expiry={details?.expiry} nowMs={$cardClock} />
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
            tier={choice.tier}
            element={choice.kind === "frame" ? (FRAME_ELEMENT.get(choice.name) ?? null) : null}
            have={choice.state === "done"}
            size="md"
            stretch
          >
            {#snippet actions()}
              <WikiButton fallbackName={choice.name} />
              {@render overframeLink(choice.name)}
              <!-- The one spot state reads from; the tooltip spells the chip out. -->
              <span class="ml-auto shrink-0 pl-2" title={$tr(work(choice))}>
                <StateChip state={choice.state} />
              </span>
            {/snippet}
            {#if choice.upgradePath || choice.sources?.length || choice.effort}
              <span class="flex flex-wrap gap-1.5">
                {#if choice.upgradePath}
                  <span class="{CHIP} text-text-secondary"
                    >{$tr("nextUp.choiceUpgradePath", { path: choice.upgradePath })}</span
                  >
                {/if}
                {#each choice.sources ?? [] as source (source.where)}
                  <span class="{CHIP} text-text-secondary"
                    >{$tr("nextUp.choiceSource", { where: source.where, kind: source.kind })}</span
                  >
                {/each}
                {#if choice.effort}
                  <span class="{CHIP} text-text-secondary"
                    >{$tr("nextUp.choiceDifficulty", { value: choice.effort })}</span
                  >
                {/if}
              </span>
            {/if}
          </ItemTile>
        {/each}
        {@render factRows()}
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
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          {#if rewardTileModel}
            <ItemTile
              name={rewardTileModel.name}
              showArt={false}
              tier={rewardTileModel.tier}
              owned={rewardTileModel.owned}
              bonus={rewardTileModel.bonus}
              size="md"
              stretch
            >
              {#snippet actions()}
                {#if credRow}
                  <span class="{COUNT} shrink-0"
                    >{$tr(
                      credRow.kind === "parts"
                        ? "nextUp.whyNightwaveCredEach"
                        : "nextUp.whyNightwaveCred",
                      { cred: String(credRow.cred) },
                    )}</span
                  >
                {/if}
              {/snippet}
            </ItemTile>
          {/if}

          <!-- The acquisition breakdown below restates every word of this line. -->
          {#if !acq}
            <p class="m-0 text-sm leading-relaxed text-text-secondary">{why}</p>
          {/if}

          {@render factRows()}

          {#if !hasExtra}
            <p class="mt-2 text-sm text-text-muted">{$tr("nextUp.detailsNothingMore")}</p>
          {/if}
        </div>
      </div>
    {/if}

    {#if valenceTiles.length > 0}
      <div class="mt-3 flex flex-col gap-2 border-t border-border pt-3">
        <span class="flex items-center gap-2">
          <span class={LABEL}>{$tr("nextUp.detailsOffers")}</span>
          <span class={COUNT}>{valenceTiles.length}</span>
        </span>
        <div class="flex flex-col gap-1.5">
          {#each valenceTiles as row, index (index)}
            {@render valenceOfferRow(row)}
          {/each}
        </div>
      </div>
    {:else if extraOffers}
      <div class="mt-3 border-t border-border pt-3">
        <div class={TILE_GRID}>
          {#each offerTiles as tile, index (index)}
            {@render itemRow(tile)}
          {/each}
        </div>
      </div>
    {/if}

    {#if options.length > 0}
      <div class="mt-3 flex flex-col gap-3 border-t border-border pt-3">
        {#each optionTiles as group (group.day)}
          <div class={TILE_GRID}>
            <!-- The pick worth taking carries a green ring; a tie rings nothing. -->
            {#each group.tiles as tile, index (index)}
              <div
                class="rounded-[var(--radius-md)] {index === group.pick
                  ? 'ring-2 ring-success'
                  : ''}"
              >
                {@render itemRow(tile)}
              </div>
            {/each}
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

          {#if acq.difficulty}
            <div class={ROW}>
              <span class={LABEL}>{$tr("nextUp.acqDifficulty")}</span>
              <span class="text-sm capitalize text-text-primary">{acq.difficulty}</span>
            </div>
          {/if}

          {#if acq.parts.known}
            <div class={ROW}>
              <span class={LABEL}>{$tr("common.foundry")}</span>
              <span class="flex flex-wrap items-center gap-2 text-sm text-text-primary">
                <span class="tabular-nums"
                  >{$tr("nextUp.acqFoundryCredits", {
                    credits: formatNumber(acq.parts.credits),
                  })}</span
                >
                <span
                  class="{CHIP} font-semibold uppercase tracking-[0.08em] {acq.parts.buildable
                    ? 'border-success/60 bg-success/10 text-success'
                    : 'text-text-muted'}"
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
              <!-- No bonus window: a range the reader cannot act on. -->
              <span class="flex flex-wrap items-center gap-x-2 text-sm text-text-primary">
                <span class="capitalize">{acq.nemesis.family}</span>
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
            <span class="flex items-center gap-2">
              <span class={LABEL}>{$tr("nextUp.acqProgenitors")}</span>
              <span class={COUNT}
                >{$tr("nextUp.acqProgenitorCount", {
                  count: String(pickedProgenitor.warframes.length),
                })}</span
              >
            </span>
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
            <div class={TILE_GRID}>
              {#each progenitorTiles as tile, index (index)}
                {@render itemRow(tile)}
              {/each}
            </div>
          </div>
        {/if}

        {#if partTiles.length > 0}
          <div class="flex flex-col gap-1">
            <span class="flex items-center gap-2">
              <span class={LABEL}>{$tr("nextUp.acqParts")}</span>
              <span
                class={COUNT}
                title={$tr("nextUp.detailsProgressValue", {
                  current: String(partsHeld),
                  target: String(partTiles.length),
                })}>{partsHeld}/{partTiles.length}</span
              >
            </span>
            <div class="flex flex-col gap-1.5">
              {#each partTiles as tile (tile.key)}
                <ItemTile
                  name={tile.label}
                  imageUrl={tile.imageUrl}
                  tier={tile.tier}
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

        {#if materialTiles.length > 0}
          <div class="flex flex-col gap-1">
            <span class="flex items-center gap-2">
              <span class={LABEL}>{$tr("nextUp.acqMaterials")}</span>
              <span class={COUNT}>{materialTiles.length}</span>
            </span>
            <div class={TILE_GRID}>
              {#each materialTiles as tile (tile.key)}
                <ItemTile
                  name={tile.label}
                  imageUrl={tile.imageUrl}
                  tier={tile.tier}
                  owned={tile.owned}
                  required={tile.required}
                  stretch
                />
              {/each}
            </div>
          </div>
        {/if}

        <div class="flex flex-col gap-2">
          <span class={LABEL}>{$tr("nextUp.acqRoutes")}</span>
          {#if acqPaths.length === 0}
            <p class="m-0 text-sm text-text-muted">{$tr("nextUp.acqNoRoutes")}</p>
          {/if}
          {#each acqPaths as path (path.id)}
            <div class="flex flex-col gap-1.5 rounded-[var(--radius-md)] border border-border p-2">
              <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span class="flex min-w-0 flex-wrap items-center gap-2">
                  <strong class="font-display text-sm text-text-primary"
                    >{$tr(pathKindLabel(path.kind))}</strong
                  >
                  {#if !path.complete && path.covers.length > 0}
                    <span class={LABEL}>{$tr("nextUp.acqCovers")}</span>
                    {#each path.covers as part (part)}
                      <span class="{CHIP} text-text-secondary">{part}</span>
                    {/each}
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
                  <div class={TILE_GRID}>
                    {#each path.cost.relics.rows.slice(0, LIST_LIMIT) as row (row.relic + row.part)}
                      <ItemTile
                        name={row.relic}
                        showArt={false}
                        tier={itemTiers(row.relic)}
                        owned={{ owned: row.held }}
                        stretch
                      >
                        <span class="truncate text-[0.6875rem] text-text-secondary">{row.part}</span
                        >
                      </ItemTile>
                    {/each}
                  </div>
                {/if}
              {/if}

              {#if path.cost.plat && path.cost.plat.parts.length > 1}
                <div class={TILE_GRID}>
                  {#each path.cost.plat.parts as row (row.name)}
                    <ItemTile name={row.name} showArt={false} tier={itemTiers(row.name)} stretch>
                      {#snippet actions()}
                        <span class="{COUNT} ml-auto shrink-0 pl-2"
                          >{row.plat === null
                            ? $tr("nextUp.acqPlatUnpriced")
                            : $tr("nextUp.acqPlatEach", {
                                plat: String(Math.round(row.plat)),
                              })}</span
                        >
                      {/snippet}
                    </ItemTile>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</ModalShell>
