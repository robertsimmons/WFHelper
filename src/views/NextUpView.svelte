<script lang="ts">
  import { onMount, tick } from "svelte";

  import {
    liftCard,
    pinnedNode,
    suggestionNode,
    upgradePinnedNode,
    upgradeSuggestionNode,
  } from "../components/nextup/cardFlight.js";
  import PinnedAcquisitions from "../components/nextup/PinnedAcquisitions.svelte";
  import {
    acquisitionKey,
    pinnedAcquisitions,
    withoutPinned,
    type PinnedEntry,
  } from "../components/nextup/pinnedAcquisitions.js";
  import {
    pinnedUpgrades,
    upgradeKey,
    withoutPinnedUpgrades,
    type PinnedUpgrade,
  } from "../components/nextup/pinnedUpgrades.js";
  import SuggestionSection from "../components/nextup/SuggestionSection.svelte";
  import SuggestionSettingsModal from "../components/nextup/SuggestionSettingsModal.svelte";
  import AcquisitionPlanPage from "../components/nextup/plan/AcquisitionPlanPage.svelte";
  import {
    resolvePinnedPlans,
    type PinnedPlanInput,
  } from "../components/nextup/plan/planResolution.js";
  import { rewardArt } from "../components/nextup/rewardArt.js";
  import { sectionNarrowed } from "../components/nextup/sectionFilters.js";
  import AcquisitionControls from "../components/nextup/controls/AcquisitionControls.svelte";
  import ArcanesControls from "../components/nextup/controls/ArcanesControls.svelte";
  import MasteryControls from "../components/nextup/controls/MasteryControls.svelte";
  import ModsControls from "../components/nextup/controls/ModsControls.svelte";
  import RelicsControls from "../components/nextup/controls/RelicsControls.svelte";
  import TasksControls from "../components/nextup/controls/TasksControls.svelte";
  import { onInventoryLoaded } from "../lib/actions.js";
  import { tr } from "../lib/i18n.js";
  import { invoke } from "../lib/ipc.js";
  import { UPGRADE_CATALOGS, UPGRADE_KINDS } from "../lib/suggest/upgradeCatalogs.js";
  import type { UpgradeKind } from "../lib/suggest/upgrades.js";
  import { partsRead } from "../lib/suggest/providers/acquisition.js";
  import { mountWorldPolling } from "../lib/world/useWorldView.js";
  import {
    acquisitionPins,
    toggleAcquisitionPin,
    unpinAcquisitionItems,
  } from "../stores/acquisitionPins.js";
  import {
    planProgress,
    planProgressFor,
    setPlanRowDone,
    togglePlanAltTaken,
  } from "../stores/acquisitionPlanProgress.js";
  import { inventoryData, itemDb } from "../stores/data.js";
  import { ensureDropPools } from "../stores/dropPools.js";
  import { toggleUpgradePin, unpinUpgrades, upgradePins } from "../stores/upgradePins.js";
  import { priceCacheRevision } from "../stores/pricing.js";
  import { worldData } from "../stores/world.js";
  import { suggestionPreferences } from "../stores/suggestionPrefs.js";
  import {
    completeTask,
    dismissSuggestion,
    restoreAllSuggestions,
    suggestionFeed,
  } from "../stores/suggestions.js";
  import {
    SUGGESTION_SECTIONS,
    type Suggestion,
    type SuggestionCategory,
    type SuggestionSection as Section,
    type SuggestionSectionId,
    type TaskKind,
  } from "../types/suggest.js";
  import type { PlanProgressOverride } from "../lib/suggest/acquisition/plan/index.js";
  import type { AcquisitionTarget } from "../lib/suggest/acquisition/types.js";
  import type { Component } from "svelte";

  const CONTROLS: Record<SuggestionSectionId, Component<Record<string, never>>> = {
    tasks: TasksControls,
    relics: RelicsControls,
    acquisition: AcquisitionControls,
    mods: ModsControls,
    arcanes: ArcanesControls,
    mastery: MasteryControls,
  };

  let settingsOpen = $state(false);
  /** The pinned item whose plan has taken the feed's place, by uniqueName. */
  let openPlan = $state<string | null>(null);
  /** Moves only on a refresh, so every live fact on the page resolves against
   *  one instant rather than drifting row by row. */
  let resolvedAt = $state(Date.now());

  // Nightwave and every live reward come from world state, which nothing else
  // fetches while this tab is the one on screen.
  onMount(() => {
    ensureDropPools();
    return mountWorldPolling();
  });

  const feed = $derived($suggestionFeed);
  const options = $derived($suggestionPreferences.options);

  function complete(suggestion: Suggestion, count: number): void {
    if (suggestion.complete) completeTask(suggestion.complete, count);
  }

  function shows(category: SuggestionCategory): boolean {
    const picked = options.taskKinds;
    return picked.includes(category as TaskKind);
  }

  /** A section whose controls choose the order keeps the one its provider chose;
   *  the rest read the band, worth and time left the engine already folded into
   *  the score, turned-down suggestions below the rest. */
  function byScore(a: Suggestion, b: Suggestion): number {
    if (a.order != null && b.order != null) return a.order - b.order;
    return (
      Number(a.deprioritized === true) - Number(b.deprioritized === true) ||
      b.score - a.score ||
      a.id.localeCompare(b.id)
    );
  }

  function suggestionsFor(section: Section): Suggestion[] {
    const categories =
      section.id === "tasks" ? section.categories.filter(shows) : section.categories;
    const rows = categories.flatMap((category) => feed.sections[category]).sort(byScore);
    if (section.id === "acquisition") return withoutPinned(rows, $acquisitionPins);
    if (section.id === "mods" || section.id === "arcanes") {
      return withoutPinnedUpgrades(rows, pinsOf(section.id));
    }
    return rows;
  }

  /** A section is dropped only where nothing the player did emptied it: its own
   *  controls are the only way back, and they go with it. */
  const shown = $derived(
    SUGGESTION_SECTIONS.map((section) => ({
      section,
      suggestions: suggestionsFor(section),
    })).filter((row) => row.suggestions.length > 0 || sectionNarrowed(row.section.id, options)),
  );

  // `$` subscribes only to a top-level store, so each kind's list gets a name.
  const modPins = upgradePins.mods;
  const arcanePins = upgradePins.arcanes;

  function pinsOf(kind: UpgradeKind): string[] {
    return kind === "mods" ? $modPins : $arcanePins;
  }

  const holdings = $derived(
    Object.fromEntries(
      UPGRADE_KINDS.map((kind) => [kind, UPGRADE_CATALOGS[kind].holdings($inventoryData, $itemDb)]),
    ),
  );
  // The card reads the price cache directly, so a revision has to rebuild it.
  const pinnedUpgradeEntries = $derived.by(() => {
    void $priceCacheRevision;
    return UPGRADE_KINDS.flatMap((kind) =>
      pinnedUpgrades(UPGRADE_CATALOGS[kind], pinsOf(kind), $itemDb, holdings[kind] ?? null),
    );
  });

  // Only a read inventory can say one is owned; an unread one owns nothing.
  $effect(() => {
    if (!$inventoryData) return;
    for (const kind of UPGRADE_KINDS) {
      const catalog = UPGRADE_CATALOGS[kind];
      const owned = pinsOf(kind).filter((name) =>
        catalog.owns(name, $itemDb, holdings[kind] ?? null),
      );
      if (owned.length > 0) unpinUpgrades(kind, owned);
    }
  });

  const acquisitionFeed = $derived(feed.sections.acquisition);
  const entries = $derived(pinnedAcquisitions($acquisitionPins, acquisitionFeed));

  /** The part count the card draws, in the words it draws them in: the plan
   *  layer holds neither a part-name join nor i18n. */
  function progressFor(target: AcquisitionTarget): PlanProgressOverride | undefined {
    const read = partsRead(target);
    if (!read) return undefined;
    const unit = $tr(
      read.unitKey ?? (read.need === 1 ? "nextUp.acqUnitPart" : "nextUp.acqUnitParts"),
    );
    return { have: read.have, need: read.need, unit, ready: read.ready };
  }

  const planInputs = $derived(
    entries.flatMap((entry): PinnedPlanInput[] => {
      const target = entry.suggestion.details?.acquisition;
      if (!target) return [];
      return [
        {
          uniqueName: entry.uniqueName,
          target,
          progress: progressFor(target),
          answers: planProgressFor($planProgress, entry.uniqueName),
        },
      ];
    }),
  );

  const plans = $derived(
    resolvePinnedPlans(planInputs, {
      itemDb: $itemDb,
      inventory: $inventoryData,
      world: $worldData,
      now: resolvedAt,
    }),
  );

  const pinned = $derived(pinnedAcquisitions($acquisitionPins, acquisitionFeed, plans));
  const openEntry = $derived(pinned.find((entry) => entry.uniqueName === openPlan) ?? null);
  const openResolved = $derived(openPlan === null ? null : (plans[openPlan] ?? null));
  const openTarget = $derived(openEntry?.suggestion.details?.acquisition ?? null);
  const openArt = $derived(
    openEntry
      ? (rewardArt($itemDb, openEntry.suggestion.reward).pieces[0]?.imageUrl ?? null)
      : null,
  );

  function tickRow(rowId: string, done: boolean): void {
    if (openPlan) setPlanRowDone(openPlan, rowId, done);
  }

  function takeAlt(rowId: string): void {
    if (openPlan) togglePlanAltTaken(openPlan, rowId);
  }

  /** Re-reads the inventory file behind the stores. The bump re-resolves every
   *  live fact at once, so the page never waits on the read to answer. */
  async function refreshFromInventory(): Promise<void> {
    resolvedAt = Date.now();
    const data = await invoke("getInventory");
    if (data) await onInventoryLoaded(data);
  }

  // The pin is written first and the copy is lifted off the DOM the browser has
  // not flushed yet, so a click that is followed straight away by leaving the
  // view still pins.
  function workOnThis(suggestion: Suggestion): void {
    const key = acquisitionKey(suggestion);
    if (!key) return;
    toggleAcquisitionPin(key);
    const flight = liftCard(suggestionNode(key));
    void tick().then(() => flight.settle(pinnedNode(key)));
  }

  function pinUpgrade(suggestion: Suggestion): void {
    const key = upgradeKey(suggestion);
    const kind = suggestion.details?.upgrade?.kind;
    if (!key || !kind) return;
    toggleUpgradePin(kind, key);
    const flight = liftCard(upgradeSuggestionNode(kind, key));
    void tick().then(() => flight.settle(upgradePinnedNode(kind, key)));
  }

  function unpinUpgrade(entry: PinnedUpgrade): void {
    unpinUpgrades(entry.kind, [entry.name]);
  }

  // The settings modal owns Escape while it is open, and it closes on its own.
  function onWindowKey(event: KeyboardEvent): void {
    if (event.key !== "Escape" || openPlan === null || settingsOpen) return;
    openPlan = null;
  }

  function unpin(entry: PinnedEntry): void {
    unpinAcquisitionItems([entry.uniqueName]);
    if (openPlan === entry.uniqueName) openPlan = null;
  }
</script>

<svelte:window onkeydown={onWindowKey} />

<section class="view active">
  <div class="view-header">
    <div class="flex min-w-0 items-center gap-3">
      {#if openPlan && openTarget}
        <h2 class="flex min-w-0 items-baseline gap-2">
          <button
            class="shrink-0 cursor-pointer whitespace-nowrap text-text-secondary
                   transition-colors duration-150 hover:text-accent hover:underline"
            title={$tr("nextUp.planBack")}
            data-plan-back
            onclick={() => (openPlan = null)}>‹ {$tr("common.nextUp")}</button
          >
          <span class="shrink-0 text-text-muted" aria-hidden="true">/</span>
          <span class="min-w-0 truncate">{openTarget.name}</span>
        </h2>
      {:else}
        <h2>{$tr("common.nextUp")}</h2>
        {#if feed.hiddenCount > 0}
          <button
            class="cursor-pointer rounded border border-border bg-bg-surface px-3 py-1 text-sm
                   text-text-secondary transition-[border-color,color] duration-150
                   hover:border-border-strong hover:text-text-primary"
            onclick={restoreAllSuggestions}
            >{$tr("nextUp.restoreHidden", { count: String(feed.hiddenCount) })}</button
          >
        {/if}
      {/if}
    </div>
    <button
      class="cursor-pointer rounded border border-border bg-bg-surface px-2 py-1 text-base
             leading-none text-text-secondary transition-[border-color,color] duration-150
             hover:border-border-strong hover:text-text-primary"
      title={$tr("nextUp.settings")}
      aria-label={$tr("nextUp.settings")}
      onclick={() => (settingsOpen = true)}>⚙</button
    >
  </div>

  <!-- The plan and the feed are separate scroll containers, so coming back
       remounts the feed and lands the reader at the top of it. -->
  {#if openPlan && openTarget}
    <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-4">
      <div data-acquisition-plan={openPlan}>
        {#key openPlan}
          <AcquisitionPlanPage
            plan={openResolved}
            name={openTarget.name}
            tier={openTarget.tier}
            uniqueName={openPlan}
            art={openArt}
            onRefresh={() => void refreshFromInventory()}
            onToggleDone={tickRow}
            onTakeAlt={takeAlt}
          />
        {/key}
      </div>
    </div>
  {:else}
    <div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pr-4">
      <PinnedAcquisitions
        entries={pinned}
        upgrades={pinnedUpgradeEntries}
        onOpen={(entry) => (openPlan = entry.uniqueName)}
        onUnpin={unpin}
        onUnpinUpgrade={unpinUpgrade}
      />
      <!-- Only when the page has nothing at all on it: a section kept for its
           controls says why it is empty itself, and still offers the way back. -->
      {#if shown.length === 0 && pinned.length === 0 && pinnedUpgradeEntries.length === 0}
        <div class="empty-state">
          <p>{$tr(feed.hiddenCount > 0 ? "nextUp.emptyDismissed" : "nextUp.empty")}</p>
        </div>
      {:else}
        {#each shown as row (row.section.id)}
          <SuggestionSection
            id={row.section.id}
            title={$tr(row.section.titleKey)}
            suggestions={row.suggestions}
            onComplete={complete}
            onDismiss={(suggestion) => dismissSuggestion(suggestion.id, suggestion.fingerprint)}
            onWorkOnThis={row.section.id === "acquisition"
              ? workOnThis
              : row.section.id === "mods" || row.section.id === "arcanes"
                ? pinUpgrade
                : undefined}
            controls={CONTROLS[row.section.id]}
          />
        {/each}
      {/if}
    </div>
  {/if}

  {#if settingsOpen}
    <SuggestionSettingsModal onClose={() => (settingsOpen = false)} />
  {/if}
</section>
