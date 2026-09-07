<script lang="ts">
  import ModalShell from "../ModalShell.svelte";
  import ThemedButton from "../ThemedButton.svelte";
  import ThemedSelect from "../ThemedSelect.svelte";
  import { tr, type MessageKey } from "../../lib/i18n.js";
  import { normalizeType } from "../../lib/suggest/missionTypes.js";
  import { createRatings } from "../../lib/suggest/acquisition/ratings.js";
  import {
    ACQUISITION_DIFFICULTIES,
    ACQUISITION_TIERS,
    MISSION_TYPE_NAMES,
    NIGHTWAVE_ACTIVITY,
    NIGHTWAVE_ART_IDS,
    REWARD_DISPLAY_NAMES,
    REWARD_TIERS,
    UNRATED,
    acquisitionKey,
    defaultPreferences,
    type RewardOverride,
  } from "../../lib/suggest/preferences.js";
  import { compactCount, ownedRewardByName } from "../../lib/suggest/ownedRewards.js";
  import { WEIGHT_MAX, WEIGHT_STEP } from "../../lib/suggest/score.js";
  import { ACQUISITION_ACTIVITY } from "../../lib/suggest/providers/acquisition.js";
  import { MASTERY_ACTIVITY } from "../../lib/suggest/providers/mastery.js";
  import { RELICS_ACTIVITY } from "../../lib/suggest/providers/relics.js";
  import { BUILTIN_TASKS, trackerGroup } from "../../lib/world/dailies.js";
  import { componentOwnership, itemDb } from "../../stores/data.js";
  import {
    nightwaveArt,
    resetScoreWeights,
    resetSuggestionPreferences,
    setAcquisitionDifficulty,
    setAcquisitionTier,
    setActivityPref,
    setNightwaveArt,
    setMissionOpinion,
    setRewardTier,
    setScoreWeight,
    suggestionOverrides,
    suggestionPreferences,
  } from "../../stores/suggestionPrefs.js";
  import type {
    ActivityPref,
    MissionOpinion,
    RewardTier,
    ScoreWeightKey,
  } from "../../types/suggest.js";

  interface Props {
    onClose: () => void;
  }

  const { onClose }: Props = $props();

  type Tab = "activities" | "rewards" | "missions" | "gear" | "ranking";

  const TABS: ReadonlyArray<{ id: Tab; label: MessageKey }> = [
    { id: "activities", label: "nextUp.settingsActivities" },
    { id: "rewards", label: "nextUp.settingsRewards" },
    { id: "missions", label: "nextUp.settingsMissionTypes" },
    { id: "gear", label: "nextUp.settingsGear" },
    { id: "ranking", label: "nextUp.settingsRanking" },
  ];

  const DIFFICULTY_LABELS: Record<string, MessageKey> = {
    trivial: "nextUp.settingsDifficultyTrivial",
    easy: "nextUp.settingsDifficultyEasy",
    normal: "common.normal",
    hard: "nextUp.settingsDifficultyHard",
    brutal: "nextUp.settingsDifficultyBrutal",
  };

  const WEIGHT_ROWS: ReadonlyArray<{ key: ScoreWeightKey; label: MessageKey }> = [
    { key: "value", label: "nextUp.settingsWeightValue" },
    { key: "urgency", label: "nextUp.settingsWeightUrgency" },
    { key: "effort", label: "nextUp.settingsWeightEffort" },
  ];

  const ACTIVITY_OPTIONS: ReadonlyArray<{ value: ActivityPref; label: MessageKey }> = [
    { value: "never", label: "nextUp.settingsNever" },
    { value: "low", label: "nextUp.settingsLow" },
    { value: "normal", label: "common.normal" },
  ];

  const OPINION_OPTIONS: ReadonlyArray<{ value: MissionOpinion | null; label: MessageKey }> = [
    { value: "good", label: "nextUp.settingsGood" },
    { value: null, label: "nextUp.settingsNoOpinion" },
    { value: "bad", label: "nextUp.settingsBad" },
  ];

  const NIGHTWAVE_ART_LABELS: Record<(typeof NIGHTWAVE_ART_IDS)[number], MessageKey> = {
    amir: "nextUp.settingsArtAmir",
    nora: "nextUp.settingsArtNora",
  };

  const TIER_LABELS: Record<RewardTier, MessageKey> = {
    great: "nextUp.settingsTierGreat",
    good: "nextUp.settingsGood",
    ok: "nextUp.settingsTierOk",
    low: "nextUp.settingsLow",
  };

  function activityIds(group: "daily" | "weekly"): string[] {
    return BUILTIN_TASKS.filter((task) => trackerGroup(task.period, task.group) === group).map(
      (task) => task.id,
    );
  }

  // The tracker's vendors group also carries the Tenet and Coda rows, which no
  // provider reads; rating those here would rate nothing.
  const VENDOR_ACTIVITY_IDS = ["baro", "darvo"];

  const GOAL_ACTIVITY_IDS = [RELICS_ACTIVITY, ACQUISITION_ACTIVITY, MASTERY_ACTIVITY];

  const ACTIVITY_GROUPS: ReadonlyArray<{ title: MessageKey; ids: string[] }> = [
    { title: "nextUp.settingsGoals", ids: GOAL_ACTIVITY_IDS },
    { title: "dailies.groupWeekly", ids: activityIds("weekly") },
    { title: "dailies.groupDaily", ids: activityIds("daily") },
    { title: "dailies.groupVendors", ids: VENDOR_ACTIVITY_IDS },
    { title: "dailies.groupNightwave", ids: [NIGHTWAVE_ACTIVITY] },
  ];

  const SHIPPED = defaultPreferences();
  const SUGGESTION_LIMIT = 12;
  const DATALIST_ID = "next-up-item-names";
  const TEXT_INPUT_CLASS =
    "rounded-[var(--radius-md)] border border-[color:var(--ui-control-border)] " +
    "bg-[var(--ui-control-bg)] px-2 py-1 text-xs text-text-primary outline-none " +
    "placeholder:text-text-muted focus:border-accent-dim";

  let tab = $state<Tab>("activities");
  let filter = $state("");
  let addName = $state("");
  let resetArmed = $state(false);

  const prefs = $derived($suggestionPreferences);
  const overrides = $derived($suggestionOverrides);

  const ACTIVITY_LABELS: Record<string, MessageKey> = {
    [NIGHTWAVE_ACTIVITY]: "nextUp.settingsNightwave",
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

  const rewardGroups = $derived.by(() => {
    const db = $itemDb;
    const ownership = $componentOwnership;
    const needle = filter.trim().toLowerCase();
    const rows = Object.entries(prefs.rewards)
      .map(([key, tier]) => ({ key, tier, label: rewardLabel(key) }))
      .filter((row) => !needle || row.label.toLowerCase().includes(needle))
      .map((row) => ({ ...row, owned: ownedRewardByName(row.label, db, ownership) }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return REWARD_TIERS.map((tier) => ({ tier, rows: rows.filter((row) => row.tier === tier) }));
  });

  const rewardCount = $derived(rewardGroups.reduce((total, group) => total + group.rows.length, 0));

  const itemNames = $derived(
    Object.values($itemDb)
      .map((entry) => entry.name)
      .filter((name): name is string => Boolean(name)),
  );

  const addSuggestions = $derived.by(() => {
    const needle = addName.trim().toLowerCase();
    if (needle.length < 2) return [];
    const picked: string[] = [];
    for (const name of itemNames) {
      if (picked.length >= SUGGESTION_LIMIT) break;
      if (name.toLowerCase().includes(needle) && !picked.includes(name)) picked.push(name);
    }
    return picked;
  });

  const SHIPPED_RATINGS = createRatings();
  const DEFAULT_TIER = "B";
  const DEFAULT_DIFFICULTY = "normal";

  function shippedTier(key: string): string {
    const rank = SHIPPED_RATINGS.rank(key);
    return rank && ACQUISITION_TIERS.includes(rank) ? rank : DEFAULT_TIER;
  }

  function shippedDifficulty(key: string): string {
    const word = SHIPPED_RATINGS.difficultyLabel(key);
    return word && ACQUISITION_DIFFICULTIES.includes(word) ? word : DEFAULT_DIFFICULTY;
  }

  const gearNames = $derived(new Map(itemNames.map((name) => [acquisitionKey(name), name])));

  const gearRows = $derived.by(() => {
    const needle = filter.trim().toLowerCase();
    const keys = new Set([
      ...Object.keys(prefs.acquisitionTiers),
      ...Object.keys(prefs.acquisitionDifficulty),
    ]);
    return [...keys]
      .map((key) => ({
        key,
        label: gearNames.get(key) ?? rewardLabel(key),
        tier: prefs.acquisitionTiers[key] ?? shippedTier(key),
        difficulty: prefs.acquisitionDifficulty[key] ?? shippedDifficulty(key),
      }))
      .filter((row) => !needle || row.label.toLowerCase().includes(needle))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  const missionRows = $derived(
    MISSION_TYPE_NAMES.map((name) => {
      const key = normalizeType(name);
      return { name, key, opinion: prefs.missionTypes[key] ?? null };
    }),
  );

  /** Clearing a curated row stores the sentinel; clearing one the user added
   *  drops the override outright, so nothing lingers under a name no row shows. */
  function cleared(hasShipped: boolean): typeof UNRATED | null {
    return hasShipped ? UNRATED : null;
  }

  function pickTier(key: string, value: string): void {
    setRewardTier(
      key,
      value === UNRATED ? cleared(key in SHIPPED.rewards) : (value as RewardOverride),
    );
  }

  function pickOpinion(key: string, opinion: MissionOpinion | null): void {
    setMissionOpinion(key, opinion ?? cleared(key in SHIPPED.missionTypes));
  }

  function addItem(): void {
    const name = addName.trim();
    if (!name) return;
    setRewardTier(name, "good");
    addName = "";
  }

  /** A new row starts on what the app already thinks, so the player edits an
   *  opinion rather than an empty one. */
  function addGear(): void {
    const name = addName.trim();
    if (!name) return;
    const key = acquisitionKey(name);
    setAcquisitionTier(key, shippedTier(key));
    setAcquisitionDifficulty(key, shippedDifficulty(key));
    addName = "";
  }

  function revertGear(key: string): void {
    setAcquisitionTier(key, null);
    setAcquisitionDifficulty(key, null);
  }

  function selectTab(next: Tab): void {
    tab = next;
    resetArmed = false;
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

{#snippet prefRow(
  label: string,
  id: string,
  options: ReadonlyArray<{ value: ActivityPref; label: MessageKey }>,
)}
  <div
    class="flex items-center justify-between gap-3 rounded-[var(--radius-md)] px-1.5 py-1
           hover:bg-bg-hover"
  >
    <span class="min-w-0 truncate text-sm text-text-secondary">{label}</span>
    <div class="flex shrink-0 gap-1">
      {#each options as option (option.value)}
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

{#snippet weightRow(label: string, key: ScoreWeightKey)}
  <div
    class="flex items-center justify-between gap-3 rounded-[var(--radius-md)] px-1.5 py-1
           hover:bg-bg-hover"
  >
    <span class="min-w-0 truncate text-sm text-text-secondary">{label}</span>
    <div class="flex shrink-0 items-center gap-2">
      <input
        type="range"
        min="0"
        max={WEIGHT_MAX}
        step={WEIGHT_STEP}
        class="w-40 accent-accent"
        aria-label={label}
        value={prefs.weights[key]}
        oninput={(e) => setScoreWeight(key, Number((e.target as HTMLInputElement).value))}
      />
      <span class="w-9 shrink-0 text-right text-xs tabular-nums text-text-primary">
        {prefs.weights[key].toFixed(2)}
      </span>
    </div>
  </div>
{/snippet}

{#snippet groupHeading(label: string)}
  <h4
    class="m-0 mb-1 mt-3 text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-text-muted
           first:mt-0"
  >
    {label}
  </h4>
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
      {#if tab === "activities"}
        <p class="m-0 mb-2 text-xs text-text-secondary">{$tr("nextUp.settingsActivityHelp")}</p>
        {#each ACTIVITY_GROUPS as group (group.title)}
          {@render groupHeading($tr(group.title))}
          {#each group.ids as id (id)}
            {@render prefRow(activityLabel(id), id, ACTIVITY_OPTIONS)}
          {/each}
          {#if group.title === "dailies.groupNightwave"}
            <div
              class="flex items-center justify-between gap-3 rounded-[var(--radius-md)] px-1.5 py-1
                     hover:bg-bg-hover"
            >
              <span class="min-w-0 truncate text-sm text-text-secondary">
                {$tr("nextUp.settingsNightwaveArt")}
              </span>
              <div class="flex shrink-0 gap-1">
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
            </div>
          {/if}
        {/each}
      {:else if tab === "rewards"}
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

        {#if rewardCount === 0}
          <p class="m-0 text-sm text-text-muted">{$tr("nextUp.settingsNoRewards")}</p>
        {/if}
        {#each rewardGroups as group (group.tier)}
          {#if group.rows.length > 0}
            {@render groupHeading($tr(TIER_LABELS[group.tier]))}
            {#each group.rows as row (row.key)}
              <div
                class="flex items-center justify-between gap-3 rounded-[var(--radius-md)] px-1.5
                       py-1 hover:bg-bg-hover"
              >
                <span class="flex min-w-0 items-center gap-2">
                  <span
                    class="w-[5ch] shrink-0 text-right font-display text-xs font-semibold
                           tabular-nums text-success"
                    title={row.owned
                      ? $tr("nextUp.tileInInventory", { count: String(row.owned.owned) })
                      : undefined}>{row.owned ? `x${compactCount(row.owned.owned)}` : ""}</span
                  >
                  <span class="min-w-0 truncate text-sm text-text-secondary">{row.label}</span>
                  {#if row.owned?.built !== undefined}
                    <span
                      class="shrink-0 font-display text-xs font-semibold tabular-nums text-warning"
                      title={$tr("nextUp.tileInFoundry", { count: String(row.owned.built) })}
                      >x{compactCount(row.owned.built)}</span
                    >
                  {/if}
                </span>
                <div class="flex shrink-0 items-center gap-1">
                  <ThemedSelect
                    bind:value={() => row.tier, (value) => pickTier(row.key, String(value))}
                  >
                    {#each REWARD_TIERS as tier (tier)}
                      <option value={tier}>{$tr(TIER_LABELS[tier])}</option>
                    {/each}
                    <option value={UNRATED}>{$tr("nextUp.settingsTierUnrated")}</option>
                  </ThemedSelect>
                  <ThemedButton
                    size="compact"
                    className={row.key in overrides.rewards ? "" : "invisible"}
                    title={$tr("nextUp.settingsRevert")}
                    onClick={() => setRewardTier(row.key, null)}>&#8634;</ThemedButton
                  >
                </div>
              </div>
            {/each}
          {/if}
        {/each}
      {:else if tab === "gear"}
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
            list={DATALIST_ID}
            bind:value={addName}
            placeholder={$tr("nextUp.settingsAddItem")}
            aria-label={$tr("nextUp.settingsAddItem")}
          />
          <ThemedButton onClick={addGear}>{$tr("nextUp.settingsAdd")}</ThemedButton>
          <datalist id={DATALIST_ID}>
            {#each addSuggestions as name (name)}
              <option value={name}></option>
            {/each}
          </datalist>
        </div>

        {#if gearRows.length === 0}
          <p class="m-0 text-sm text-text-muted">{$tr("nextUp.settingsNoGear")}</p>
        {/if}
        {#each gearRows as row (row.key)}
          <div
            class="flex items-center justify-between gap-3 rounded-[var(--radius-md)] px-1.5 py-1
                   hover:bg-bg-hover"
          >
            <span class="min-w-0 truncate text-sm text-text-secondary">{row.label}</span>
            <div class="flex shrink-0 items-center gap-1">
              <ThemedSelect
                bind:value={() => row.tier, (value) => setAcquisitionTier(row.key, String(value))}
              >
                {#each ACQUISITION_TIERS as tier (tier)}
                  <option value={tier}>{tier}</option>
                {/each}
              </ThemedSelect>
              <ThemedSelect
                bind:value={
                  () => row.difficulty, (value) => setAcquisitionDifficulty(row.key, String(value))
                }
              >
                {#each ACQUISITION_DIFFICULTIES as word (word)}
                  <option value={word}>{$tr(DIFFICULTY_LABELS[word] ?? word)}</option>
                {/each}
              </ThemedSelect>
              <ThemedButton
                size="compact"
                title={$tr("nextUp.settingsRevert")}
                onClick={() => revertGear(row.key)}>&#8634;</ThemedButton
              >
            </div>
          </div>
        {/each}
      {:else if tab === "missions"}
        <p class="m-0 mb-2 text-xs text-text-secondary">{$tr("nextUp.settingsMissionHelp")}</p>
        {#each missionRows as row (row.key)}
          <div
            class="flex items-center justify-between gap-3 rounded-[var(--radius-md)] px-1.5 py-1
                   hover:bg-bg-hover"
          >
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
      {:else}
        <p class="m-0 mb-2 text-xs text-text-secondary">{$tr("nextUp.settingsRankingHelp")}</p>
        {#each WEIGHT_ROWS as row (row.key)}
          {@render weightRow($tr(row.label), row.key)}
        {/each}
        <div class="mt-3 px-1.5">
          <ThemedButton size="compact" onClick={resetScoreWeights}>
            {$tr("nextUp.settingsWeightsReset")}
          </ThemedButton>
        </div>
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
