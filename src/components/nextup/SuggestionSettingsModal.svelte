<script lang="ts">
  import { SvelteSet } from "svelte/reactivity";

  import ModalShell from "../ModalShell.svelte";
  import ThemedButton from "../ThemedButton.svelte";
  import ThemedSelect from "../ThemedSelect.svelte";
  import { tr, type MessageKey } from "../../lib/i18n.js";
  import { normalizeType } from "../../lib/suggest/missionTypes.js";
  import { createRatings } from "../../lib/suggest/acquisition/ratings.js";
  import {
    ACQUISITION_TIERS,
    MISSION_TYPE_NAMES,
    NIGHTWAVE_ART_IDS,
    REWARD_DISPLAY_NAMES,
    UNRATED,
    WORTH_LADDER,
    acquisitionKey,
    defaultPreferences,
  } from "../../lib/suggest/preferences.js";
  import { compactCount, ownedRewardByName } from "../../lib/suggest/ownedRewards.js";
  import { orderEntries } from "../../lib/suggest/worthLadder.js";
  import { unplacedNames } from "../../lib/suggest/unplaced.js";
  import { listArchwings, listFrames } from "../../lib/suggest/acquisition/parts.js";
  import { listWeapons } from "../../lib/suggest/acquisition/weapons.js";
  import { ACQUISITION_ACTIVITY } from "../../lib/suggest/providers/acquisition.js";
  import { MASTERY_ACTIVITY } from "../../lib/suggest/providers/mastery.js";
  import { RELICS_ACTIVITY } from "../../lib/suggest/providers/relics.js";
  import { BUILTIN_TASKS, trackerGroup, type TrackerGroup } from "../../lib/world/dailies.js";
  import { componentOwnership, itemDb } from "../../stores/data.js";
  import {
    moveRewardEntry,
    nightwaveArt,
    resetSuggestionPreferences,
    setAcquisitionTier,
    setActivityPref,
    setMissionOpinion,
    setNightwaveArt,
    setNightwaveStock,
    setRewardWorth,
    suggestionOverrides,
    suggestionPreferences,
  } from "../../stores/suggestionPrefs.js";
  import { DEFAULT_NIGHTWAVE_STOCK, NIGHTWAVE_STAPLES } from "../../types/suggest.js";
  import type {
    ActivityPref,
    LadderGroup,
    MissionOpinion,
    WorthGroup,
  } from "../../types/suggest.js";

  interface Props {
    onClose: () => void;
  }

  const { onClose }: Props = $props();

  type Tab = "value" | "missions" | "activities" | "nightwave" | "tier";

  const TABS: ReadonlyArray<{ id: Tab; label: MessageKey }> = [
    { id: "value", label: "nextUp.settingsValue" },
    { id: "missions", label: "nextUp.settingsMissionTypes" },
    { id: "activities", label: "nextUp.settingsActivities" },
    { id: "nightwave", label: "nextUp.settingsNightwave" },
    { id: "tier", label: "nextUp.sortTier" },
  ];

  const NIGHTWAVE_ART_LABELS: Record<(typeof NIGHTWAVE_ART_IDS)[number], MessageKey> = {
    amir: "nextUp.settingsArtAmir",
    nora: "nextUp.settingsArtNora",
  };

  const GROUP_LABELS: Record<LadderGroup, MessageKey> = {
    must: "nextUp.settingsGroupMust",
    want: "nextUp.settingsGroupWant",
    useful: "nextUp.settingsGroupUseful",
    filler: "nextUp.settingsGroupFiller",
    junk: "nextUp.settingsGroupJunk",
  };

  const ACTIVITY_OPTIONS: ReadonlyArray<{ value: ActivityPref; label: MessageKey }> = [
    { value: "normal", label: "nextUp.settingsActivityOn" },
    { value: "low", label: "nextUp.settingsLow" },
    { value: "never", label: "nextUp.settingsActivityOff" },
  ];

  const OPINION_OPTIONS: ReadonlyArray<{ value: MissionOpinion | null; label: MessageKey }> = [
    { value: "good", label: "nextUp.settingsGood" },
    { value: null, label: "nextUp.settingsNoOpinion" },
    { value: "bad", label: "nextUp.settingsBad" },
  ];

  function activityIds(group: TrackerGroup): string[] {
    return BUILTIN_TASKS.filter((task) => trackerGroup(task.period, task.group) === group).map(
      (task) => task.id,
    );
  }

  const GOAL_ACTIVITY_IDS = [RELICS_ACTIVITY, ACQUISITION_ACTIVITY, MASTERY_ACTIVITY];

  // Nightwave acts no longer reach the feed, so the synthetic id the whole group
  // answered to governs nothing and is deliberately not offered here.
  const ACTIVITY_GROUPS: ReadonlyArray<{ title: MessageKey; ids: string[] }> = [
    { title: "nextUp.settingsGoals", ids: GOAL_ACTIVITY_IDS },
    { title: "dailies.groupVendors", ids: activityIds("vendors") },
    { title: "dailies.groupWeekly", ids: activityIds("weekly") },
    { title: "dailies.groupDaily", ids: activityIds("daily") },
  ];

  const SHIPPED = defaultPreferences();
  const SUGGESTION_LIMIT = 12;
  const DATALIST_ID = "next-up-item-names";
  const TIER_DATALIST_ID = "next-up-tier-names";
  const TEXT_INPUT_CLASS =
    "rounded-[var(--radius-md)] border border-[color:var(--ui-control-border)] " +
    "bg-[var(--ui-control-bg)] px-2 py-1 text-xs text-text-primary outline-none " +
    "placeholder:text-text-muted focus:border-accent-dim";
  const ROW_CLASS =
    "flex items-center justify-between gap-3 rounded-[var(--radius-md)] px-1.5 py-1 " +
    "hover:bg-bg-hover";

  let tab = $state<Tab>("value");
  let filter = $state("");
  let addName = $state("");
  let resetArmed = $state(false);

  const prefs = $derived($suggestionPreferences);
  const overrides = $derived($suggestionOverrides);

  const ACTIVITY_LABELS: Record<string, MessageKey> = {
    [RELICS_ACTIVITY]: "common.relics",
    [ACQUISITION_ACTIVITY]: "nextUp.sectionAcquisition",
    [MASTERY_ACTIVITY]: "common.mastery",
  };

  function activityLabel(id: string): string {
    return $tr(ACTIVITY_LABELS[id] ?? (`dailies.task.${id}` as MessageKey));
  }

  /** A user-added item is only ever known by what was typed, so title-case it. */
  function rewardLabel(key: string): string {
    return REWARD_DISPLAY_NAMES[key] ?? key.replace(/(^|\s)\S/g, (c) => c.toUpperCase());
  }

  function matches(label: string): boolean {
    const needle = filter.trim().toLowerCase();
    return !needle || label.toLowerCase().includes(needle);
  }

  /** `index` is the entry's place in the unfiltered group, so a search can
   *  narrow what is on screen without moving what a drag lands next to. */
  interface LadderRow {
    key: string;
    label: string;
    index: number;
    owned: ReturnType<typeof ownedRewardByName>;
  }

  interface LadderSection {
    group: LadderGroup;
    keys: string[];
    rows: LadderRow[];
  }

  const ladder = $derived.by((): LadderSection[] => {
    const db = $itemDb;
    const ownership = $componentOwnership;
    const positions = overrides.rewardOrder;
    const byGroup: Partial<Record<WorthGroup, string[]>> = {};
    for (const [key, group] of Object.entries(prefs.worth)) {
      (byGroup[group] ??= []).push(key);
    }
    return WORTH_LADDER.map((group) => {
      const keys = orderEntries(group, byGroup[group] ?? [], positions);
      const rows = keys
        .map((key, index) => ({ key, index, label: rewardLabel(key) }))
        .filter((row) => matches(row.label))
        .map((row) => ({ ...row, owned: ownedRewardByName(row.label, db, ownership) }));
      return { group, keys, rows };
    });
  });

  /** The feed fills this as it resolves rewards, so it is re-read whenever the
   *  tab is opened rather than watched. */
  let unplacedKeys = $state<string[]>(unplacedNames());

  const unplaced = $derived(
    unplacedKeys
      .filter((key) => (prefs.worth[key] ?? "unplaced") === "unplaced")
      .map((key) => ({ key, label: rewardLabel(key) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  );

  const itemNames = $derived(
    Object.values($itemDb)
      .map((entry) => entry.name)
      .filter((name): name is string => Boolean(name)),
  );

  function suggestNames(names: readonly string[]): string[] {
    const needle = addName.trim().toLowerCase();
    if (needle.length < 2) return [];
    const picked: string[] = [];
    for (const name of names) {
      if (picked.length >= SUGGESTION_LIMIT) break;
      if (name.toLowerCase().includes(needle) && !picked.includes(name)) picked.push(name);
    }
    return picked;
  }

  const addSuggestions = $derived(suggestNames(itemNames));

  let dragKey = $state<string | null>(null);
  let dropAt = $state<{ group: LadderGroup; index: number } | null>(null);

  function startDrag(event: DragEvent, key: string): void {
    dragKey = key;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", key);
    }
  }

  function dragOver(event: DragEvent, group: LadderGroup, index: number): void {
    if (dragKey === null) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    dropAt = { group, index };
  }

  /** Dropping onto a row puts the entry where that row was, which is one place
   *  higher once the entry itself is lifted out from above it. */
  function landingIndex(section: LadderSection, key: string, index: number): number {
    const from = section.keys.indexOf(key);
    return from >= 0 && from < index ? index - 1 : index;
  }

  function drop(event: DragEvent): void {
    event.preventDefault();
    const key = dragKey;
    const target = dropAt;
    dragKey = null;
    dropAt = null;
    if (key === null || target === null) return;
    const section = ladder.find((entry) => entry.group === target.group);
    if (!section) return;
    moveRewardEntry(target.group, section.keys, key, landingIndex(section, key, target.index));
  }

  function endDrag(): void {
    dragKey = null;
    dropAt = null;
  }

  function nudge(section: LadderSection, row: LadderRow, by: number): void {
    moveRewardEntry(section.group, section.keys, row.key, row.index + by);
  }

  function pickGroup(key: string, value: string): void {
    if (value === UNRATED) {
      setRewardWorth(key, key in SHIPPED.worth ? UNRATED : null);
      return;
    }
    setRewardWorth(key, value as WorthGroup);
  }

  const SHIPPED_RATINGS = createRatings();
  const DEFAULT_TIER = "B";

  function shippedTier(key: string): string {
    const tier = SHIPPED_RATINGS.tier(key);
    return tier && ACQUISITION_TIERS.includes(tier) ? tier : DEFAULT_TIER;
  }

  /** Only masterable gear carries a tier, so the tab offers exactly what the
   *  acquisition sweep counts as gear - never a resource, mod or skin. */
  const gearNames = $derived.by(() => {
    const db = $itemDb;
    const names = new SvelteSet<string>();
    for (const entry of listFrames(db)) names.add(entry.name);
    for (const entry of listArchwings(db)) names.add(entry.name);
    for (const entry of listWeapons(db)) names.add(entry.name);
    return [...names].sort((a, b) => a.localeCompare(b));
  });

  const gearByKey = $derived(new Map(gearNames.map((name) => [acquisitionKey(name), name])));

  const tierSuggestions = $derived(suggestNames(gearNames));

  const tierRows = $derived(
    Object.keys(prefs.acquisitionTiers)
      .map((key) => ({
        key,
        label: gearByKey.get(key) ?? rewardLabel(key),
        tier: prefs.acquisitionTiers[key] ?? shippedTier(key),
      }))
      .filter((row) => matches(row.label))
      .sort((a, b) => a.label.localeCompare(b.label)),
  );

  const missionRows = $derived(
    MISSION_TYPE_NAMES.map((name) => {
      const key = normalizeType(name);
      return { name, key, opinion: prefs.missionTypes[key] ?? null };
    }),
  );

  function pickOpinion(key: string, opinion: MissionOpinion | null): void {
    setMissionOpinion(key, opinion ?? (key in SHIPPED.missionTypes ? UNRATED : null));
  }

  const stapleRows = $derived(
    NIGHTWAVE_STAPLES.map((key) => ({
      key,
      label: rewardLabel(key),
      level: prefs.nightwaveStock[key] ?? DEFAULT_NIGHTWAVE_STOCK,
      overridden: key in overrides.nightwaveStock,
    })),
  );

  /** An emptied box is not a level of zero; it reverts the staple. */
  function pickStock(key: string, raw: string): void {
    const typed = raw.trim();
    setNightwaveStock(key, typed === "" ? null : Number(typed));
  }

  function addItem(): void {
    const name = addName.trim();
    if (!name) return;
    setRewardWorth(name, "want");
    addName = "";
  }

  /** A new row starts on what the app already thinks, so the player edits an
   *  opinion rather than an empty one. Anything with no tier to overrule is
   *  refused rather than given a row that governs nothing. */
  function addTier(): void {
    const name = addName.trim();
    if (!name) return;
    const key = acquisitionKey(name);
    if (!gearByKey.has(key)) return;
    setAcquisitionTier(key, shippedTier(key));
    addName = "";
  }

  function selectTab(next: Tab): void {
    tab = next;
    resetArmed = false;
    if (next === "value") unplacedKeys = unplacedNames();
  }

  function reset(): void {
    if (!resetArmed) {
      resetArmed = true;
      return;
    }
    resetSuggestionPreferences();
    resetArmed = false;
  }
</script>

{#snippet prefRow(label: string, id: string)}
  <div class={ROW_CLASS}>
    <span class="min-w-0 truncate text-sm text-text-secondary">{label}</span>
    <div class="flex shrink-0 gap-1">
      {#each ACTIVITY_OPTIONS as option (option.value)}
        <ThemedButton
          size="compact"
          active={(prefs.activities[id] ?? "normal") === option.value}
          onClick={() => setActivityPref(id, option.value)}
        >
          {$tr(option.label)}
        </ThemedButton>
      {/each}
    </div>
  </div>
{/snippet}

{#snippet dragHandle(key: string)}
  <span
    draggable="true"
    role="presentation"
    class="shrink-0 cursor-grab select-none px-0.5 text-text-muted"
    title={$tr("nextUp.settingsDragHandle")}
    ondragstart={(event) => startDrag(event, key)}
    ondragend={endDrag}>&#8942;&#8942;</span
  >
{/snippet}

{#snippet groupHeading(label: string)}
  <h4
    class="m-0 mb-1 mt-3 text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-text-muted
           first:mt-0"
  >
    {label}
  </h4>
{/snippet}

{#snippet groupPicker(key: string, group: WorthGroup | typeof UNRATED)}
  <ThemedSelect bind:value={() => group, (value) => pickGroup(key, String(value))}>
    {#each WORTH_LADDER as entry (entry)}
      <option value={entry}>{$tr(GROUP_LABELS[entry])}</option>
    {/each}
    <option value={UNRATED}>{$tr("nextUp.settingsTierUnrated")}</option>
  </ThemedSelect>
{/snippet}

{#snippet nameCell(label: string, owned: ReturnType<typeof ownedRewardByName>)}
  <span class="flex min-w-0 items-center gap-2">
    <span
      class="w-[5ch] shrink-0 text-right font-display text-xs font-semibold tabular-nums {owned &&
      owned.owned > 0
        ? 'text-success'
        : 'text-text-muted'}"
      title={owned ? $tr("nextUp.tileInInventory", { count: String(owned.owned) }) : undefined}
      >{owned ? `x${compactCount(owned.owned)}` : ""}</span
    >
    <span class="min-w-0 truncate text-sm text-text-secondary">{label}</span>
    {#if owned?.built !== undefined}
      <span
        class="shrink-0 font-display text-xs font-semibold tabular-nums text-text-secondary"
        title={$tr("nextUp.tileBuilt", { count: String(owned.built) })}
        >x{compactCount(owned.built)}</span
      >
    {/if}
  </span>
{/snippet}

{#snippet dropStrip(group: LadderGroup, index: number, label: string | null)}
  <div
    role="presentation"
    class="min-h-4 rounded-[var(--radius-md)] border border-dashed px-1.5 py-1 text-[0.7rem]
           text-text-muted transition-colors {dropAt?.group === group && dropAt?.index === index
      ? 'border-accent text-accent'
      : 'border-transparent'}"
    ondragover={(event) => dragOver(event, group, index)}
    ondrop={drop}
  >
    {label ?? ""}
  </div>
{/snippet}

<ModalShell ariaLabel={$tr("nextUp.settings")} {onClose}>
  <div class="detail-panel next-up-settings-panel">
    <div class="mb-3 flex items-start justify-between gap-2">
      <h3 class="m-0 font-display text-lg text-text-primary">{$tr("nextUp.settings")}</h3>
      <button
        class="btn-secondary btn-sm !px-2"
        aria-label={$tr("common.close")}
        title={$tr("common.close")}
        onclick={onClose}>&times;</button
      >
    </div>

    <div class="mb-3 flex flex-wrap gap-2 border-b border-border pb-3">
      {#each TABS as entry (entry.id)}
        <ThemedButton active={tab === entry.id} onClick={() => selectTab(entry.id)}>
          {$tr(entry.label)}
        </ThemedButton>
      {/each}
    </div>

    <div class="max-h-[52vh] min-h-[18rem] overflow-y-auto pr-1">
      {#if tab === "value"}
        <p class="m-0 mb-2 text-xs text-text-secondary">{$tr("nextUp.settingsValueHelp")}</p>
        <div class="mb-2 flex flex-wrap items-center gap-2">
          <input
            class={TEXT_INPUT_CLASS}
            type="search"
            bind:value={filter}
            placeholder={$tr("nextUp.settingsFilter")}
            aria-label={$tr("nextUp.settingsFilter")}
          />
          <input
            class={TEXT_INPUT_CLASS}
            type="text"
            list={DATALIST_ID}
            bind:value={addName}
            placeholder={$tr("nextUp.settingsAddItem")}
            aria-label={$tr("nextUp.settingsAddItem")}
          />
          <ThemedButton onClick={addItem}>{$tr("nextUp.settingsAdd")}</ThemedButton>
          <datalist id={DATALIST_ID}>
            {#each addSuggestions as name (name)}
              <option value={name}></option>
            {/each}
          </datalist>
        </div>

        <div class="mb-2 rounded-[var(--radius-md)] border border-border px-2 py-1.5">
          <div class="flex items-baseline justify-between gap-2">
            <span class="font-display text-xs font-semibold text-text-primary">
              {$tr("nextUp.settingsUnplaced", { count: String(unplaced.length) })}
            </span>
            <span class="text-[0.7rem] text-text-muted">{$tr("nextUp.settingsUnplacedHelp")}</span>
          </div>
          {#if unplaced.length === 0}
            <p class="m-0 mt-1 text-xs text-text-muted">{$tr("nextUp.settingsUnplacedNone")}</p>
          {/if}
          {#each unplaced as row (row.key)}
            {#if matches(row.label)}
              <div class={ROW_CLASS}>
                <span class="flex min-w-0 items-center gap-1">
                  {@render dragHandle(row.key)}
                  <span class="min-w-0 truncate text-sm text-text-secondary">{row.label}</span>
                </span>
                {@render groupPicker(row.key, UNRATED)}
              </div>
            {/if}
          {/each}
        </div>

        {#if unplaced.length === 0 && ladder.every((section) => section.rows.length === 0)}
          <p class="m-0 text-sm text-text-muted">{$tr("nextUp.settingsNoRewards")}</p>
        {/if}
        {#each ladder as section (section.group)}
          <div
            role="presentation"
            ondragover={(event) => dragOver(event, section.group, 0)}
            ondrop={drop}
          >
            {@render groupHeading($tr(GROUP_LABELS[section.group]))}
          </div>
          {#each section.rows as row (row.key)}
            <div
              role="presentation"
              class="{ROW_CLASS} {dragKey === row.key ? 'opacity-40' : ''} {dropAt?.group ===
                section.group && dropAt?.index === row.index
                ? 'ring-1 ring-accent'
                : ''}"
              ondragover={(event) => dragOver(event, section.group, row.index)}
              ondrop={drop}
            >
              <span class="flex min-w-0 items-center gap-1">
                {@render dragHandle(row.key)}
                {@render nameCell(row.label, row.owned)}
              </span>
              <div class="flex shrink-0 items-center gap-1">
                <ThemedButton
                  size="compact"
                  disabled={row.index === 0}
                  title={$tr("filters.moveControlUp")}
                  onClick={() => nudge(section, row, -1)}>&#9650;</ThemedButton
                >
                <ThemedButton
                  size="compact"
                  disabled={row.index === section.keys.length - 1}
                  title={$tr("filters.moveControlDown")}
                  onClick={() => nudge(section, row, 1)}>&#9660;</ThemedButton
                >
                {@render groupPicker(row.key, section.group)}
                <ThemedButton
                  size="compact"
                  className={row.key in overrides.rewards || row.key in overrides.rewardOrder
                    ? ""
                    : "invisible"}
                  title={$tr("nextUp.settingsRevert")}
                  onClick={() => setRewardWorth(row.key, null)}>&#8634;</ThemedButton
                >
              </div>
            </div>
          {/each}
          {@render dropStrip(
            section.group,
            section.keys.length,
            section.rows.length === 0 ? $tr("nextUp.settingsGroupEmpty") : null,
          )}
        {/each}
      {:else if tab === "missions"}
        <p class="m-0 mb-2 text-xs text-text-secondary">{$tr("nextUp.settingsMissionHelp")}</p>
        {#each missionRows as row (row.key)}
          <div class={ROW_CLASS}>
            <span class="min-w-0 truncate text-sm text-text-secondary">{row.name}</span>
            <div class="flex shrink-0 gap-1">
              {#each OPINION_OPTIONS as option (option.label)}
                <ThemedButton
                  size="compact"
                  active={row.opinion === option.value}
                  onClick={() => pickOpinion(row.key, option.value)}
                >
                  {$tr(option.label)}
                </ThemedButton>
              {/each}
            </div>
          </div>
        {/each}
      {:else if tab === "activities"}
        <p class="m-0 mb-2 text-xs text-text-secondary">
          {$tr("nextUp.settingsActivityBandHelp")}
        </p>
        {#each ACTIVITY_GROUPS as group (group.title)}
          {@render groupHeading($tr(group.title))}
          {#each group.ids as id (id)}
            {@render prefRow(activityLabel(id), id)}
          {/each}
        {/each}
      {:else if tab === "nightwave"}
        <p class="m-0 mb-2 text-xs text-text-secondary">{$tr("nextUp.settingsNightwaveHelp")}</p>
        {@render groupHeading($tr("nextUp.settingsNightwaveStock"))}
        {#each stapleRows as row (row.key)}
          <div class={ROW_CLASS}>
            <span class="min-w-0 truncate text-sm text-text-secondary">{row.label}</span>
            <div class="flex shrink-0 items-center gap-1">
              <input
                class="{TEXT_INPUT_CLASS} w-16 text-right tabular-nums"
                type="number"
                min="0"
                step="1"
                value={row.level}
                aria-label={row.label}
                oninput={(event) => pickStock(row.key, event.currentTarget.value)}
              />
              <ThemedButton
                size="compact"
                className={row.overridden ? "" : "invisible"}
                title={$tr("nextUp.settingsRevert")}
                onClick={() => setNightwaveStock(row.key, null)}>&#8634;</ThemedButton
              >
            </div>
          </div>
        {/each}

        {@render groupHeading($tr("nextUp.settingsNightwaveArt"))}
        <div class="flex flex-wrap gap-1 px-1.5 py-1">
          {#each NIGHTWAVE_ART_IDS as art (art)}
            <ThemedButton
              size="compact"
              active={$nightwaveArt === art}
              onClick={() => setNightwaveArt(art)}
            >
              {$tr(NIGHTWAVE_ART_LABELS[art])}
            </ThemedButton>
          {/each}
        </div>
      {:else}
        <p class="m-0 mb-2 text-xs text-text-secondary">{$tr("nextUp.settingsGearHelp")}</p>
        <div class="mb-2 flex flex-wrap items-center gap-2">
          <input
            class={TEXT_INPUT_CLASS}
            type="search"
            bind:value={filter}
            placeholder={$tr("nextUp.settingsFilter")}
            aria-label={$tr("nextUp.settingsFilter")}
          />
          <input
            class={TEXT_INPUT_CLASS}
            type="text"
            list={TIER_DATALIST_ID}
            bind:value={addName}
            placeholder={$tr("nextUp.settingsAddItem")}
            aria-label={$tr("nextUp.settingsAddItem")}
          />
          <ThemedButton onClick={addTier}>{$tr("nextUp.settingsAdd")}</ThemedButton>
          <datalist id={TIER_DATALIST_ID}>
            {#each tierSuggestions as name (name)}
              <option value={name}></option>
            {/each}
          </datalist>
        </div>

        {#if tierRows.length === 0}
          <p class="m-0 text-sm text-text-muted">{$tr("nextUp.settingsNoGear")}</p>
        {/if}
        {#each tierRows as row (row.key)}
          <div class={ROW_CLASS}>
            <span class="min-w-0 truncate text-sm text-text-secondary">{row.label}</span>
            <div class="flex shrink-0 items-center gap-1">
              <ThemedSelect
                bind:value={() => row.tier, (value) => setAcquisitionTier(row.key, String(value))}
              >
                {#each ACQUISITION_TIERS as tier (tier)}
                  <option value={tier}>{tier}</option>
                {/each}
              </ThemedSelect>
              <ThemedButton
                size="compact"
                title={$tr("nextUp.settingsRevert")}
                onClick={() => setAcquisitionTier(row.key, null)}>&#8634;</ThemedButton
              >
            </div>
          </div>
        {/each}
      {/if}
    </div>

    <div class="mt-3 flex items-center justify-between gap-3 border-t border-border pt-3">
      <button
        class="cursor-pointer rounded border bg-bg-surface px-3 py-1 text-sm
               transition-[border-color,color] duration-150 {resetArmed
          ? 'border-danger text-danger'
          : 'border-border text-text-secondary hover:border-border-strong hover:text-text-primary'}"
        onclick={reset}
        onblur={() => (resetArmed = false)}
      >
        {$tr(resetArmed ? "nextUp.settingsResetConfirm" : "nextUp.settingsReset")}
      </button>
      <ThemedButton onClick={onClose}>{$tr("common.close")}</ThemedButton>
    </div>
  </div>
</ModalShell>

<style>
  .next-up-settings-panel {
    width: min(680px, calc(100vw - 3rem));
    padding: 1rem;
  }
</style>
