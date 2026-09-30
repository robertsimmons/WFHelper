<script lang="ts">
  import { onMount } from "svelte";

  import { invoke } from "../lib/ipc.js";
  import { itemDb, componentOwnership } from "../stores/data.js";
  import { addSavedSearch, removeSavedSearch, savedSearches } from "../stores/savedSearches.js";
  import { activeEnemy, activeItem, activeRelic, wikiSearchRequest } from "../stores/modals.js";
  import { relicDb } from "../stores/relics.js";
  import { buildItemNameIndex } from "../lib/componentResolution.js";
  import { dropRowPlaces, type DropRowPlace } from "../lib/dropSources.js";
  import {
    relicGroupForDisplayName,
    relicGroupForUniqueName,
  } from "../lib/relic/relicInventory.js";
  import { buildParsedItemFromDb } from "../lib/parsedItemFromDb.js";
  // Aliased: a store named `tr` makes svelte-check flag every <tr> row as a lowercase component.
  import { tr as t, type MessageKey } from "../lib/i18n.js";
  import { stripQuantityPrefix } from "../../config/shared/quantityPrefix.js";
  import DropSourceTile from "../components/DropSourceTile.svelte";
  import WikiButton from "../components/WikiButton.svelte";
  import type { DropKind, DropRow, DropSearchMode } from "../../config/shared/dropTypes.js";

  let query = "";
  let mode: DropSearchMode = "item";
  let rows: DropRow[] = [];
  let total = 0;
  let loading = false;
  let searched = false;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  // The query a search actually ran with. bestWikiName walks the whole itemDb
  // name index, so the header link follows this instead of every keystroke.
  let linkQuery = "";
  let requestToken = 0;
  let searchEl: HTMLInputElement | null = null;

  function clearSearch(): void {
    query = "";
    onInput();
    searchEl?.focus();
  }

  // Per-mode lists: an item search saved under "By item" reruns as an item search.
  $: savedStore = savedSearches(`wiki:${mode}`);
  $: currentSearchSaved = $savedStore.some((s) => s.toLowerCase() === query.trim().toLowerCase());

  function applySavedSearch(text: string): void {
    query = text;
    void runSearch();
  }

  // The dictionary rejects duplicate values, so four of these tags borrow the
  // key that already owns the word rather than adding a wiki-local twin.
  const KIND_LABEL_KEYS: Record<DropKind, MessageKey | null> = {
    enemy: "common.enemy",
    mission: "common.mission",
    bounty: "world.bountyLabel",
    relic: "drops.relicSuffix",
    sortie: "dailies.task.sortie",
    quest: "common.quest",
    syndicate: "common.syndicate",
    dojo: "drops.kind.dojo",
    // No upstream table produces this today; it stays the unlabelled fallback.
    other: null,
  };

  $: places = dropRowPlaces(rows);

  function openPlace(place: DropRowPlace): (() => void) | undefined {
    if (place.kind === "enemy") return () => openEnemy(place.source.raw[0] ?? place.source.place);
    const relic =
      place.kind === "relic" ? relicGroupForDisplayName($relicDb, place.source.place) : null;
    return relic ? () => activeRelic.set(relic) : undefined;
  }

  async function runSearch(): Promise<void> {
    const q = query.trim();
    linkQuery = q;
    if (!q) {
      rows = [];
      total = 0;
      searched = false;
      return;
    }
    const token = ++requestToken;
    loading = true;
    try {
      const result = await invoke("searchDrops", q, mode);
      if (token !== requestToken) return; // a newer search superseded this one
      rows = result.rows;
      total = result.total;
      searched = true;
    } finally {
      if (token === requestToken) loading = false;
    }
  }

  function onInput(): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    requestToken += 1;
    loading = false;
    if (!query.trim()) {
      rows = [];
      total = 0;
      searched = false;
      linkQuery = "";
      return;
    }
    debounceTimer = setTimeout(runSearch, 250);
  }

  // One list drives the toggle, the placeholder and the request fallback, so a
  // mode is one entry rather than three copies of the same markup.
  const MODES: readonly DropSearchMode[] = ["item", "place", "enemy"];
  const MODE_LABEL_KEYS: Record<DropSearchMode, MessageKey> = {
    item: "wiki.byItem",
    place: "wiki.byLocation",
    enemy: "wiki.byEnemy",
  };
  const MODE_PLACEHOLDER_KEYS: Record<DropSearchMode, MessageKey> = {
    item: "wiki.searchPlaceholderItem",
    place: "wiki.searchPlaceholderPlace",
    enemy: "wiki.searchPlaceholderEnemy",
  };

  function setMode(next: DropSearchMode): void {
    if (mode === next) return;
    mode = next;
    void runSearch();
  }

  // Map display names back to itemDb entries for detail modals. Rows without an
  // entry remain non-clickable.
  $: nameIndex = buildItemNameIndex($itemDb);

  /** Best itemDb name for the raw query, so the header link lands on a real page. */
  function bestWikiName(raw: string, index: Map<string, string>): string {
    const query = raw.trim();
    if (query.length < 2) return query;
    const lower = query.toLowerCase();
    let best: string | null = null;
    for (const name of index.keys()) {
      const low = name.toLowerCase();
      if (low === lower) return name;
      if (low.startsWith(lower) && (best === null || name.length < best.length)) best = name;
    }
    return best ?? query;
  }

  $: wikiLinkName = bestWikiName(linkQuery, nameIndex);

  // The enemy panel hands its own search back here when its drop list is capped.
  function applyWikiSearchRequest(request: { query: string; mode: DropSearchMode }): void {
    wikiSearchRequest.set(null);
    mode = MODES.includes(request.mode) ? request.mode : "item";
    query = request.query;
    void runSearch();
  }

  $: if ($wikiSearchRequest) applyWikiSearchRequest($wikiSearchRequest);

  function openEnemy(name: string): void {
    activeEnemy.set({ name });
  }

  function openItem(name: string): void {
    // Bundled rows like "2X Orokin Cell" carry a quantity prefix the db lacks.
    const uniqueName = nameIndex.get(name) ?? nameIndex.get(stripQuantityPrefix(name));
    if (!uniqueName) return;
    // A relic reward row gets the breakdown modal, not the generic item card.
    const group = relicGroupForUniqueName($relicDb, uniqueName);
    if (group) {
      activeRelic.set(group);
      return;
    }
    const entry = $itemDb[uniqueName];
    if (!entry) return;
    activeItem.set(buildParsedItemFromDb(uniqueName, entry, $componentOwnership));
  }

  onMount(() => () => {
    if (debounceTimer) clearTimeout(debounceTimer);
  });
</script>

<section class="view active">
  <div class="mx-auto flex w-full max-w-[1040px] flex-col gap-4 py-4">
    <header class="view-header mb-0">
      <div class="flex flex-col gap-1">
        <h2>{$t("wiki.title")}</h2>
        <p class="m-0 text-sm text-text-secondary">
          {$t("wiki.description")}
        </p>
      </div>
    </header>

    <div class="flex flex-wrap items-center gap-2">
      <div class="relative min-w-[240px] flex-1">
        <input
          type="search"
          class="w-full rounded-lg border border-border bg-bg-soft px-3 py-2 pr-8 text-sm text-text-primary outline-none placeholder:text-text-muted focus:border-accent [&::-webkit-search-cancel-button]:hidden"
          placeholder={$t(MODE_PLACEHOLDER_KEYS[mode])}
          bind:value={query}
          bind:this={searchEl}
          on:input={onInput}
          autocomplete="off"
          spellcheck="false"
          data-search-focus
        />
        {#if query}
          <button
            type="button"
            class="absolute right-1.5 top-1/2 -translate-y-1/2 cursor-pointer rounded border-0 bg-transparent px-1.5 py-0.5 text-base leading-none text-text-muted hover:text-text-primary"
            aria-label={$t("common.clearSearch")}
            on:click={clearSearch}>&times;</button
          >
        {/if}
      </div>
      <button
        type="button"
        class="shrink-0 rounded-lg border border-border px-3 py-2 text-sm disabled:cursor-default disabled:opacity-40 {currentSearchSaved
          ? 'bg-accent-glow text-accent'
          : 'bg-bg-soft text-text-secondary hover:text-text-primary'}"
        disabled={!query.trim()}
        title={currentSearchSaved ? $t("wiki.searchAlreadySaved") : $t("wiki.saveSearch")}
        on:click={() => addSavedSearch(`wiki:${mode}`, query)}>★</button
      >
      {#if linkQuery}
        <span class="shrink-0" data-wiki-search-link={wikiLinkName}>
          <WikiButton wikiUrl={null} fallbackName={wikiLinkName} />
        </span>
      {/if}
      <div class="flex shrink-0 overflow-hidden rounded-lg border border-border">
        {#each MODES as m, i (m)}
          <button
            type="button"
            data-wiki-mode={m}
            class="px-3 py-2 text-sm font-display {i > 0 ? 'border-l border-border' : ''} {mode ===
            m
              ? 'bg-accent-glow text-accent'
              : 'bg-bg-soft text-text-secondary hover:text-text-primary'}"
            on:click={() => setMode(m)}>{$t(MODE_LABEL_KEYS[m])}</button
          >
        {/each}
      </div>
    </div>

    {#if $savedStore.length > 0}
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="text-xs uppercase tracking-[0.05em] text-text-muted">{$t("common.saved")}</span
        >
        {#each $savedStore as s (s)}
          <span
            class="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm {query.trim() ===
            s
              ? 'border-accent/50 bg-accent-glow text-accent'
              : 'border-border bg-bg-soft text-text-secondary'}"
          >
            <button
              type="button"
              class="cursor-pointer border-0 bg-transparent p-0 text-inherit hover:text-text-primary"
              title={$t("wiki.searchThis")}
              on:click={() => applySavedSearch(s)}>{s}</button
            >
            <button
              type="button"
              class="cursor-pointer border-0 bg-transparent p-0 text-inherit opacity-60 hover:opacity-100"
              title={$t("wiki.removeSearch")}
              on:click={() => removeSavedSearch(`wiki:${mode}`, s)}>×</button
            >
          </span>
        {/each}
      </div>
    {/if}

    {#if loading && rows.length === 0}
      <div
        class="rounded-lg border border-dashed border-border bg-bg-soft px-3 py-6 text-center text-sm text-text-secondary"
      >
        {$t("common.searching")}
      </div>
    {:else if !searched}
      <div
        class="rounded-lg border border-dashed border-border bg-bg-soft px-3 py-6 text-center text-sm text-text-secondary"
      >
        {$t("wiki.typeToSearch")}
      </div>
    {:else if rows.length === 0}
      <div
        class="rounded-lg border border-dashed border-border bg-bg-soft px-3 py-6 text-center text-sm text-text-secondary"
      >
        {$t("wiki.noResults", { query: query.trim() })}
      </div>
    {:else}
      <div class="overflow-hidden rounded-lg border border-border">
        <table class="w-full border-collapse text-sm">
          <thead>
            <tr class="bg-bg-soft text-left text-xs uppercase tracking-[0.05em] text-text-muted">
              <th class="px-3 py-2 font-medium">{$t("common.item")}</th>
              <th class="px-3 py-2 font-medium">{$t("wiki.col.dropsFrom")}</th>
            </tr>
          </thead>
          <tbody>
            {#each places as place (place.item + "|" + place.kind + "|" + place.source.key)}
              {@const kindKey = KIND_LABEL_KEYS[place.kind]}
              <tr class="border-t border-border/60 align-top hover:bg-bg-hover">
                <td class="px-3 py-1.5">
                  {#if nameIndex.has(place.item) || nameIndex.has(stripQuantityPrefix(place.item))}
                    <button
                      type="button"
                      class="cursor-pointer border-0 bg-transparent p-0 text-left text-text-primary hover:text-accent hover:underline"
                      on:click={() => openItem(place.item)}>{place.item}</button
                    >
                  {:else}
                    <span class="text-text-primary">{place.item}</span>
                  {/if}
                </td>
                <td class="px-3 py-1.5 text-text-secondary">
                  <div class="flex min-w-0 items-start gap-1.5">
                    {#if kindKey}
                      <span
                        class="mt-1 inline-block shrink-0 rounded border border-border px-1 py-px font-display text-[0.6rem] font-bold uppercase tracking-[0.05em] text-text-muted"
                        >{$t(kindKey)}</span
                      >
                    {/if}
                    <div class="min-w-0 flex-1">
                      <DropSourceTile source={place.source} onOpen={openPlace(place)} />
                    </div>
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if total > rows.length}
        <p class="m-0 text-center text-xs text-text-muted">
          {$t("wiki.showingResults", { shown: rows.length, total })}
        </p>
      {/if}
    {/if}
  </div>
</section>
