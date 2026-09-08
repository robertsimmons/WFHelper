<script lang="ts">
  import { SvelteMap } from "svelte/reactivity";

  import { activeWindow, formatNumber } from "../../lib/format.js";
  import { tr } from "../../lib/i18n.js";
  import { send } from "../../lib/ipc.js";
  import { progenitors as frameProgenitors } from "../../lib/suggest/acquisition/progenitors.js";
  import { tierOrder } from "../../lib/suggest/acquisition/recommend.js";
  import { itemTiers } from "../../lib/suggest/acquisition/tiers.js";
  import { resolveDropArt } from "../../lib/suggest/dropPools.js";
  import { overframeUrl } from "../../lib/suggest/overframe.js";
  import { pathKindLabel } from "../../lib/suggest/providers/acquisition.js";
  import { ownedRewardFor, ownsAny, type OwnedReward } from "../../lib/suggest/ownedRewards.js";
  import { nightwaveRowFor } from "../../lib/suggest/providers/nightwave.js";
  import { liveVendorOffers } from "../../lib/suggest/providers/vendors.js";
  import { rewardWorth } from "../../lib/suggest/rewards.js";
  import { valenceRowsFor } from "../../lib/suggest/valence.js";
  import { codaBatch } from "../../lib/world/dailiesLive.js";
  import { componentOwnership, foundryPending, itemDb } from "../../stores/data.js";
  import { overframeRankingsRevision } from "../../stores/overframeRankings.js";
  import { suggestionPreferences } from "../../stores/suggestionPrefs.js";
  import { worldData } from "../../stores/world.js";
  import { CHIP_TONE, TONE, cardClock } from "./chips.js";
  import { plainName, rewardArt } from "./rewardArt.js";
  import ItemTile from "./ItemTile.svelte";
  import StateChip from "./StateChip.svelte";
  import TierBadge from "./TierBadge.svelte";
  import TimeLeft from "./TimeLeft.svelte";
  import ItemImage from "../ItemImage.svelte";
  import ModalShell from "../ModalShell.svelte";
  import WikiButton from "../WikiButton.svelte";
  import type { MessageKey } from "../../lib/i18n.js";
  import type { AcquisitionPath, NemesisBonusRange } from "../../lib/suggest/acquisition/types.js";
  import type {
    RewardWorth,
    Suggestion,
    SuggestionOption,
    SuggestionPoolRow,
    SuggestionReward,
  } from "../../types/suggest.js";

  interface Props {
    suggestion: Suggestion;
    onClose: () => void;
  }

  const { suggestion, onClose }: Props = $props();

  const ROW = "grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3 py-1";
  const LABEL = "text-xs font-semibold uppercase tracking-[0.08em] text-text-muted";
  const CHIP = "rounded-[var(--radius-sm)] border border-border px-1.5 py-0.5 text-[0.6875rem]";
  /** Equal cells, so a tier letter lands in the same place on every row. The
   *  track floor is what a full item name needs beside its art: below it the
   *  drop tables read as "Tauforged Amber Archon Sh...". */
  const TILE_GRID = "grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-2";
  /** The slot the header keeps for the tier, so the title starts where every
   *  tile name below it starts. */
  const TIER_SLOT = "flex w-8 shrink-0 justify-center";

  /** The whole point is easiest first; past this the list stops being a shortlist. */
  const ROUTE_LIMIT = 6;
  const LIST_LIMIT = 8;

  /** A rare drop needs its decimals; a common one does not. */
  function chanceText(chance: number): string {
    if (chance >= 10) return chance.toFixed(0);
    // A chance under a hundredth still has to read as a number, not as nothing.
    return chance.toFixed(2).replace(/\.?0+$/, "") || chance.toPrecision(1);
  }

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
    /** Only an adversary offer knows what the player's own copy rolled. */
    ownedBonus?: number | null;
    have: boolean;
  }

  /** One thing a pool pays, at the price its manifest puts on it and the chance
   *  its table gives it. */
  interface PoolTile {
    tile: Tile;
    cost: string[];
    chance: number | null;
    /** Where the player's ladder places the drop; null is unplaced. */
    worth: RewardWorth | null;
  }

  /** One value the header strip carries. Position and colour say what it is; the
   *  tooltip names it for anyone who has not learned the strip yet. */
  interface Fact {
    value: string;
    title: string;
    tone: string;
  }

  interface TileFacts {
    tier?: string | null | undefined;
    element?: string | null | undefined;
    bonus?: number | null | undefined;
  }

  function itemTile(
    item: { name: string; uniqueName?: string | undefined; imageUrl?: string | undefined },
    facts: TileFacts = {},
  ): Tile {
    const art = resolveDropArt($itemDb, item.name, item.uniqueName);
    const owned = ownedRewardFor(item, $itemDb, $componentOwnership, $foundryPending);
    return {
      name: plainName(art?.name ?? item.name),
      // The provider's own icon is the last resort behind every itemDb join:
      // prime components reach the relic tables under a path no manifest has.
      imageUrl: art?.imageUrl ?? item.imageUrl ?? null,
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

  function worthRank(worth: RewardWorth | null): number {
    return worth ? WORTH_RANK[worth] : UNRATED_RANK;
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
  const details = $derived(suggestion.details);
  const acq = $derived(details?.acquisition ?? null);
  const relic = $derived(details?.relic ?? null);
  // The family label names no member, so its members are what the reader picks
  // an art pair from and what the possibilities list draws.
  const rewardMembers = $derived<readonly SuggestionReward[]>(suggestion.reward?.oneOf ?? []);
  // Still, and only two: a modal is read rather than scanned, and the rows below
  // it list every possibility with what the player holds of each.
  const artPieces = $derived(
    rewardArt($itemDb, suggestion.reward, details?.pool ?? []).pieces.slice(0, 2),
  );
  // A stall's pool is what it is holding, not what drops off anything.
  const poolLabel = $derived<MessageKey>(
    suggestion.category === "vendor" ? "nextUp.detailsStock" : "nextUp.detailsPool",
  );
  const missions = $derived(details?.missions ?? []);
  const options = $derived(details?.options ?? []);
  const taskId = $derived(suggestion.complete?.taskId ?? "");
  /** The provider prefix off the id, which is how the art table keys tasks too. */
  const taskKey = $derived(suggestion.id.replace(/^[^:]+:/, ""));
  // A bare name is all a stall's stock line carries; a drop row also carries the
  // chance its table gives it.
  const pool = $derived<readonly SuggestionPoolRow[]>(
    (details?.pool ?? []).map((entry) => (typeof entry === "string" ? { name: entry } : entry)),
  );
  // The rows the provider resolved against the player's own weapons, most
  // advancing first. Empty means the wiki table named none of them, which is
  // unknown rather than no stock.
  const valenceRows = $derived(valenceRowsFor(suggestion.id));
  // The real stock wins wherever world state carries one; the curated table only
  // names vendors it cannot describe.
  const offers = $derived(
    pool.length > 0 || valenceRows.length > 0 ? [] : liveVendorOffers(taskId, $cardClock),
  );
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
  const credRow = $derived(nightwaveRowFor(suggestion.id));

  /** The header's letter: the tier of the thing the card is about. */
  const headerTier = $derived.by(() => {
    void $overframeRankingsRevision;
    if (suggestion.tier) return suggestion.tier;
    if (acq?.tier) return acq.tier;
    return suggestion.reward ? itemTiers(suggestion.reward.name) : null;
  });

  /** The reward as a tile: the header already carries its letter, so the tile
   *  holds the slot and leaves the column one letter. */
  const rewardTile = $derived.by(() => {
    void $overframeRankingsRevision;
    return suggestion.reward ? itemTile(suggestion.reward) : null;
  });

  /** What the stall charges for what the card is about: Nora's Creds, Darvo's
   *  discounted plat. Rendered through the tile, like every other price. */
  const rewardCost = $derived.by((): string[] => {
    if (credRow) {
      return [
        $tr(credRow.kind === "parts" ? "nextUp.whyNightwaveCredEach" : "nextUp.whyNightwaveCred", {
          cred: String(credRow.cred),
        }),
      ];
    }
    if (taskKey !== "darvo") return [];
    const deal = $worldData?.dailyDeals?.[0];
    const chips: string[] = [];
    if (typeof deal?.salePrice === "number") {
      chips.push($tr("nextUp.acqPlatEach", { plat: String(deal.salePrice) }));
    }
    if (typeof deal?.discount === "number") {
      chips.push($tr("nextUp.factDiscount", { percent: String(deal.discount) }));
    }
    return chips;
  });

  /** Everything the reader needs that no tile below carries: who the fight is
   *  against, where a travelling stall is, which batch a rotation is on. */
  const facts = $derived.by((): Fact[] => {
    const wd = $worldData;
    const now = $cardClock;
    const out: Fact[] = [];
    const boss = taskKey === "sortie" ? wd?.sortie?.boss : undefined;
    const archon = taskKey === "archonHunt" ? wd?.archonHunt?.boss : undefined;
    for (const name of [boss, archon]) {
      if (name) out.push({ value: name, title: $tr("nextUp.factBoss"), tone: CHIP_TONE.plain });
    }
    const trader =
      taskKey === "baro" ? wd?.voidTrader : taskKey === "varzia" ? wd?.vaultTrader : null;
    const where = trader?.location?.trim();
    if (where) {
      const here = activeWindow(trader?.activation, trader?.expiry, now);
      out.push({
        value: where,
        title: $tr(here ? "dailies.baroHere" : "dailies.baroAway", { location: where }),
        tone: here ? CHIP_TONE.good : CHIP_TONE.plain,
      });
    }
    if (taskKey === "codaWeapons") {
      out.push({
        value: codaBatch(now).batch,
        title: $tr("nextUp.factBatch"),
        tone: CHIP_TONE.plain,
      });
    }
    // What is held, where it cracks, and what one crack pays. An unpriced drop
    // table draws nothing rather than a zero.
    if (relic) {
      out.push({
        value: $tr("nextUp.whyRelicRefinement", {
          count: String(relic.count),
          quality: $tr(`relics.quality.${relic.quality}` as MessageKey),
        }),
        title: $tr("relics.qualityLabel"),
        tone: CHIP_TONE.plain,
      });
      out.push({
        value: relic.node,
        title: $tr("nextUp.factNode"),
        tone: CHIP_TONE.plain,
      });
      if (relic.platinum !== null) {
        const value = String(Math.round(relic.platinum));
        out.push({
          value: $tr("nextUp.acqPlatEach", { plat: value }),
          title: $tr("nextUp.whyRelicPlat", { value }),
          tone: CHIP_TONE.plain,
        });
      }
      if (relic.ducats !== null) {
        const value = String(Math.round(relic.ducats));
        out.push({
          value: $tr("world.baro.ducatsShort", { count: value }),
          title: $tr("nextUp.whyRelicDucats", { value }),
          tone: CHIP_TONE.plain,
        });
      }
    }
    // Every card in Acquisition is owed the item; only a subsume-only card is
    // owed something else, so that is the one need worth a chip.
    if (acq?.needs.includes("subsume")) {
      out.push({
        value: $tr("nextUp.acqNeedSubsume"),
        title: $tr("nextUp.acqNeedSubsume"),
        tone: CHIP_TONE.warn,
      });
    }
    return out;
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

  /** How the section this card sits in is ordered. A section with no sort
   *  control has none, and its lists read the ladder and then the odds. */
  const sectionSort = $derived.by((): string | null => {
    const picked = $suggestionPreferences.options;
    if (suggestion.category === "relics") return picked.relicSort;
    if (suggestion.category === "acquisition") return picked.acquisitionSort;
    return null;
  });

  /** Best first: the sort the player picked wherever a row can answer it, then
   *  where the ladder puts the drop, the odds of seeing it, and the tier - which
   *  is what carries a stall of gear the ladder places none of. */
  function poolScore(row: PoolTile): number[] {
    const tier = tierOrder(row.tile.tier);
    const ladder = [worthRank(row.worth), -(row.chance ?? 0), tier ?? UNRATED_RANK];
    return sectionSort === "tier" ? [tier ?? UNRATED_RANK, ...ladder] : ladder;
  }

  function comparePool(a: PoolTile, b: PoolTile): number {
    return compareScores(poolScore(a), poolScore(b)) || a.tile.name.localeCompare(b.tile.name);
  }

  /** A bare stock name carries no rating of its own, so the ladder is read here
   *  the way the drop-pool providers read it for their own rows. */
  function poolTile(row: SuggestionPoolRow): PoolTile {
    return {
      tile: itemTile(row),
      cost: priceChips(row.name),
      chance: row.chance ?? null,
      worth: row.worth ?? rewardWorth($suggestionPreferences, row.name),
    };
  }

  const poolTiles = $derived.by((): PoolTile[] => {
    void $overframeRankingsRevision;
    return pool.map(poolTile).sort(comparePool);
  });
  const offerTiles = $derived.by(() => {
    void $overframeRankingsRevision;
    return offers
      .map(poolTile)
      .sort(comparePool)
      .map((row) => row.tile);
  });
  const valenceTiles = $derived.by(() => {
    void $overframeRankingsRevision;
    return valenceRows.map((row) => {
      const tile = itemTile(
        { name: row.name, uniqueName: row.uniqueName },
        { tier: row.tier, element: row.element, bonus: row.bonus },
      );
      // A weapon with no roll of the player's own is one they do not hold, so
      // the count group goes rather than reading x0 beside a blank percentage.
      // Nothing on the table lifts a finished weapon, so that one reads as owned.
      return {
        ...tile,
        name: row.displayName ?? tile.name,
        owned: row.owned === null ? null : tile.owned,
        ownedBonus: row.owned,
        have: row.verdict === "done",
      };
    });
  });
  /** Every kind the reward can be, where the pool does not already list them. */
  const memberTiles = $derived.by(() => {
    void $overframeRankingsRevision;
    if (rewardMembers.length < 2 || pool.length > 0) return [];
    return rewardMembers.map((member) => itemTile(member));
  });
  /** A family label names no member, so where the rows below already list every
   *  possibility the headline would only draw the family a second time. */
  const familyOnly = $derived(
    rewardMembers.length > 1 &&
      (memberTiles.length > 0 || (poolTiles.length > 0 && valenceRows.length === 0)),
  );
  const optionTiles = $derived.by(() => {
    void $overframeRankingsRevision;
    return options.map((group) => {
      const tiles = group.options.map((option) => {
        const tile = itemTile(option);
        return { ...tile, name: plainName(option.displayName ?? tile.name) };
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
      label: part.displayName ?? part.name,
      tier: itemTiers(part.name),
      imageUrl: resolveDropArt($itemDb, part.name, part.uniqueName)?.imageUrl ?? null,
      owned: { owned: part.owned },
      required: part.missing === 0 ? null : part.required,
      have: part.missing === 0,
    }));
  });
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
    offerTiles.length > 1 || (offerTiles.length === 1 && offerTiles[0]?.name !== rewardTile?.name),
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
    ownedBonus={tile.ownedBonus}
    have={tile.have}
    stretch
  ></ItemTile>
{/snippet}

<!-- Stall stock reads as the item, what the manifest charges and what a run
     pays out at. -->
{#snippet poolRow(row: PoolTile)}
  <ItemTile
    name={row.tile.name}
    imageUrl={row.tile.imageUrl}
    tier={row.tile.tier}
    owned={row.tile.owned}
    element={row.tile.element}
    bonus={row.tile.bonus}
    have={row.tile.have}
    cost={row.cost}
    stretch
  >
    {#snippet actions()}
      {#if row.chance !== null}
        <span
          class="ml-auto shrink-0 pl-2 tabular-nums {TONE.quiet}"
          title={$tr("nextUp.detailsChance")}>{chanceText(row.chance)}%</span
        >
      {/if}
    {/snippet}
  </ItemTile>
{/snippet}

<!-- What the activity pays and asks for, whether or not the week offers a pick. -->
{#snippet factRows()}
  {#if memberTiles.length > 0}
    <div class={ROW}>
      <span class={LABEL}>{$tr("nextUp.detailsCouldBe")}</span>
      <div class={TILE_GRID}>
        {#each memberTiles as tile, index (index)}
          {@render itemRow(tile)}
        {/each}
      </div>
    </div>
  {/if}

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
      <!-- The chip's colour is the opinion; a word beside it says it twice. -->
      <span class="flex flex-wrap gap-1.5">
        {#each missions as mission (mission.name)}
          <span
            class="{CHIP} {mission.opinion === 'good'
              ? CHIP_TONE.good
              : mission.opinion === 'bad'
                ? CHIP_TONE.bad
                : 'text-text-primary'}">{mission.name}</span
          >
        {/each}
      </span>
    </div>
  {/if}
{/snippet}

<ModalShell ariaLabel={suggestion.title} {onClose}>
  <!-- Wider than the shared panel: this one lists whole drop tables, and three
       tracks of full item names is what they take. -->
  <div class="detail-panel w-[1180px] max-w-[95vw] p-4">
    <div class="mb-3 flex items-start justify-between gap-2">
      <!-- Inset by a tile's own padding, so the header letter and every tile
           letter below it share one column. -->
      <span class="flex min-w-0 items-center gap-2 pl-2">
        <!-- The same slot every tile below keeps, so the letters share a column
             and the title starts where the names do. -->
        <span class={TIER_SLOT}><TierBadge tier={headerTier} size="md" /></span>
        <h3 class="m-0 truncate font-display text-lg text-text-primary">{suggestion.title}</h3>
        {#if suggestion.wiki}
          <span class="shrink-0"><WikiButton fallbackName={suggestion.wiki} /></span>
        {/if}
        <span class="shrink-0">{@render overframeLink(suggestion.wiki)}</span>
        <!-- Urgency reads as a pill, in the one place every view keeps it. -->
        <TimeLeft expiry={details?.expiry} nowMs={$cardClock} reserve />
      </span>
      <button
        class="btn-secondary btn-sm !px-2"
        aria-label={$tr("common.close")}
        title={$tr("common.close")}
        onclick={onClose}>&times;</button
      >
    </div>

    {#if facts.length > 0}
      <div class="mb-3 flex flex-wrap gap-1.5">
        {#each facts as fact, index (index)}
          <span class="{CHIP} font-semibold {fact.tone}" title={fact.title}>{fact.value}</span>
        {/each}
      </div>
    {/if}

    {#if choices.length > 0}
      <div class="flex flex-col gap-2">
        {#each choices as choice (choice.name)}
          <ItemTile
            name={choice.name}
            imageUrl={choice.imageUrl}
            tier={choice.tier}
            element={choice.kind === "frame" ? (FRAME_ELEMENT.get(choice.name) ?? null) : null}
            have={choice.state === "done"}
            stacks={false}
            size="md"
            stretch
          >
            {#snippet actions()}
              <WikiButton fallbackName={choice.name} />
              {@render overframeLink(choice.name)}
              <span class="ml-auto shrink-0 pl-2"><StateChip state={choice.state} /></span>
            {/snippet}
            {#if choice.upgradePath || choice.sources?.length}
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
              </span>
            {/if}
          </ItemTile>
        {/each}
        {@render factRows()}
      </div>
    {:else}
      <div class="flex gap-4">
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          {#if rewardTile && !familyOnly}
            <ItemTile
              name={rewardTile.name}
              showArt={false}
              owned={rewardTile.owned}
              cost={rewardCost}
              size="md"
              stretch
            ></ItemTile>
          {/if}

          {@render factRows()}
        </div>
        {#if artPieces.length > 0}
          <span
            class="relative flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden
                   rounded-[var(--radius-md)] bg-bg-deep"
          >
            {#if artPieces.length > 1}
              <!-- Stair-stepped: the drop is one of these and no single picture
                   is the truth. -->
              {#each artPieces as piece, index (index)}
                <ItemImage
                  src={piece.imageUrl}
                  fallbackSrc={piece.fallbackUrl}
                  alt={piece.name}
                  cls="absolute inset-0 m-auto max-h-20 max-w-20 {index === 0
                    ? '-translate-x-3 -translate-y-3'
                    : 'translate-x-3 translate-y-3'}"
                  eager
                />
              {/each}
            {:else}
              <ItemImage
                src={artPieces[0].imageUrl}
                fallbackSrc={artPieces[0].fallbackUrl}
                alt={artPieces[0].name}
                cls="max-h-28 max-w-28"
                eager
              />
            {/if}
          </span>
        {/if}
      </div>
    {/if}

    {#if valenceTiles.length > 0}
      <div class="mt-3 border-t border-border pt-3">
        <div class={ROW}>
          <span class={LABEL}>{$tr("nextUp.detailsStock")}</span>
          <div class="flex flex-col gap-1.5">
            {#each valenceTiles as tile, index (index)}
              {@render itemRow(tile)}
            {/each}
          </div>
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
        {#if acq.parts.known || acq.nemesis}
          <div class="flex flex-col">
            {#if acq.parts.known}
              <div class={ROW}>
                <span class={LABEL}>{$tr("common.foundry")}</span>
                <!-- Green is buildable now; plain is still short. -->
                <span
                  class="{CHIP} w-fit tabular-nums {acq.parts.buildable
                    ? CHIP_TONE.good
                    : CHIP_TONE.plain}"
                  >{$tr("nextUp.acqFoundryCredits", {
                    credits: formatNumber(acq.parts.credits),
                  })}</span
                >
              </div>
            {/if}

            {#if acq.nemesis}
              <div class={ROW}>
                <span class={LABEL}>{$tr("nextUp.acqNemesis")}</span>
                <span class="text-sm capitalize text-text-primary">{acq.nemesis.family}</span>
              </div>
            {/if}
          </div>
        {/if}

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
            <div class={TILE_GRID}>
              {#each progenitorTiles as tile, index (index)}
                {@render itemRow(tile)}
              {/each}
            </div>
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
                  tier={tile.tier}
                  owned={tile.owned}
                  required={tile.required}
                  have={tile.have}
                  stretch
                />
              {/each}
            </div>
          </div>
        {/if}

        {#if materialTiles.length > 0}
          <div class="flex flex-col gap-1">
            <span class={LABEL}>{$tr("nextUp.detailsMaterials")}</span>
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

        {#if acqPaths.length > 0}
          <div class="flex flex-col gap-2">
            <span class={LABEL}>{$tr("nextUp.detailsRoutes")}</span>
            {#each acqPaths as path (path.id)}
              <div
                class="flex flex-col gap-1.5 rounded-[var(--radius-md)] border border-border p-2"
              >
                <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <strong class="font-display text-sm text-text-primary"
                    >{$tr(pathKindLabel(path.kind))}</strong
                  >
                  <span class="flex flex-wrap gap-1.5">
                    {#each costChips(path) as chip (chip)}
                      <span class="{CHIP} tabular-nums text-text-secondary">{chip}</span>
                    {/each}
                  </span>
                </div>

                <!-- The one sanctioned sentence in the feed: a farm route the
                     player has to follow step by step. -->
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

                {#if path.cost.relics?.known && path.cost.relics.rows.length > 0}
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

                {#if path.cost.plat && path.cost.plat.parts.length > 1}
                  <div class={TILE_GRID}>
                    {#each path.cost.plat.parts as row (row.name)}
                      <ItemTile
                        name={row.name}
                        showArt={false}
                        tier={itemTiers(row.name)}
                        cost={row.plat === null
                          ? []
                          : [$tr("nextUp.acqPlatEach", { plat: String(Math.round(row.plat)) })]}
                        stretch
                      />
                    {/each}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>
</ModalShell>
