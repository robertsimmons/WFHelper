<script lang="ts">
  import { itemLabel } from "../lib/itemLabel.js";

  import { relicDb, relicOwnedCounts } from "../stores/relics.js";
  import { activeItem, activeComponent, activeRelic } from "../stores/modals.js";
  import { dropRarityColour } from "../lib/dropDisplay.js";
  import { dropSourcesStore } from "../lib/dropSourceStore.js";
  import { fissureTierClass, RELIC_ICON_PATHS } from "../lib/relic.js";
  import { relicGroupForDisplayName } from "../lib/relic/relicInventory.js";
  import { buildWikiUrl } from "../lib/wikiUrl.js";
  import { tr } from "../lib/i18n.js";
  import DropSourceTile from "./DropSourceTile.svelte";
  import type { DropSource } from "../lib/dropSources.js";
  import type { DropInfo } from "../types/inventory.js";
  import type { RelicGroup } from "../types/relics.js";

  interface Props {
    drops: DropInfo[];
    /** Empty means "use the default heading", which has to stay translatable. */
    title?: string;
    initialLimit?: number;
  }

  const { drops, title = "", initialLimit = 5 }: Props = $props();

  const headingText = $derived(title || $tr("drops.acquisition"));
  const places = $derived(dropSourcesStore(drops));

  let showAll = $state(false);
  let openRelicKey = $state<string | null>(null);

  $effect(() => {
    void drops;
    showAll = false;
    openRelicKey = null;
  });

  const shown = $derived(showAll ? $places : $places.slice(0, initialLimit));

  function relicFor(source: DropSource): RelicGroup | null {
    return source.kind === "relic" ? relicGroupForDisplayName($relicDb, source.place) : null;
  }

  function toggleRelic(key: string): void {
    openRelicKey = openRelicKey === key ? null : key;
  }

  function isOwned(groupKey: string): boolean {
    const counts = $relicOwnedCounts[groupKey];
    if (!counts) return false;
    return counts.intact + counts.exceptional + counts.flawless + counts.radiant > 0;
  }

  function relicFallbackIcon(rg: RelicGroup): string {
    return RELIC_ICON_PATHS[fissureTierClass(rg.tier)] || RELIC_ICON_PATHS.default;
  }

  // rg.imageUrl can 404 (mirror gap / dead upstream); swap to the bundled tier icon
  function onRelicImgError(event: Event, rg: RelicGroup): void {
    const img = event.currentTarget as HTMLImageElement | null;
    if (!img) return;
    const fallback = relicFallbackIcon(rg);
    if (!img.src.endsWith(fallback)) img.src = fallback;
  }

  function getPopoverRewards(rg: RelicGroup) {
    return (rg.qualities?.intact ?? Object.values(rg.qualities ?? {})[0])?.rewards ?? [];
  }

  function openDetailedRelic(rg: RelicGroup): void {
    openRelicKey = null;
    activeItem.set(null);
    activeComponent.set(null);
    activeRelic.set(rg);
  }

  function openRelicWiki(rg: RelicGroup, ev: MouseEvent): void {
    ev.preventDefault();
    ev.stopPropagation();
    window.api?.openExternal?.(buildWikiUrl(rg.name));
  }
</script>

{#if $places.length > 0}
  <div class="detail-section">
    <h3>{headingText}</h3>
    <div class="detail-acquisition flex flex-col gap-1.5">
      {#each shown as source (source.key)}
        {@const rg = relicFor(source)}
        {#if rg}
          <DropSourceTile
            {source}
            active={openRelicKey === rg.key}
            onOpen={() => toggleRelic(rg.key)}
          />
          {#if openRelicKey === rg.key}
            {@const rewards = getPopoverRewards(rg)}
            {@const owned = isOwned(rg.key)}
            <div
              class="mb-1 rounded-lg border border-border-strong bg-bg-raised px-3 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
            >
              <div class="flex items-center gap-2 pb-2 mb-2 border-b border-border">
                <img
                  src={rg.imageUrl || relicFallbackIcon(rg)}
                  alt={rg.name}
                  class="w-8 h-8 object-contain shrink-0"
                  onerror={(e) => onRelicImgError(e, rg)}
                />
                <div class="flex-1 min-w-0 flex flex-col gap-0.5">
                  <span class="font-display text-sm font-semibold text-text-primary truncate"
                    >{rg.name}</span
                  >
                  <span
                    class="font-display text-xs font-bold tracking-wider px-1.5 py-0.5 rounded w-fit {owned
                      ? 'bg-success/15 text-success'
                      : 'bg-danger/20 text-danger'}"
                  >
                    {owned ? $tr("common.owned") : $tr("common.vaulted")}
                  </span>
                </div>
                <button
                  type="button"
                  class="shrink-0 self-start bg-transparent border-0 text-text-muted text-base leading-none cursor-pointer px-0.5 opacity-70 hover:opacity-100 hover:text-text-primary"
                  aria-label={$tr("common.close")}
                  onclick={() => (openRelicKey = null)}>&times;</button
                >
              </div>

              <div class="flex items-center gap-1.5 mb-2">
                <button
                  type="button"
                  class="flex-1 px-2 py-1 text-xs font-display font-semibold tracking-wider rounded border border-accent/50 text-accent hover:bg-accent/10 hover:border-accent cursor-pointer transition-colors"
                  onclick={() => openDetailedRelic(rg)}>{$tr("common.detailed")}</button
                >
                <button
                  type="button"
                  class="flex-1 px-2 py-1 text-xs font-display font-semibold tracking-wider rounded border border-border-strong text-text-secondary hover:bg-surface-hover hover:text-text-primary cursor-pointer transition-colors"
                  onclick={(e) => openRelicWiki(rg, e)}>{$tr("common.wiki")}</button
                >
              </div>

              <div class="flex max-h-[240px] flex-col overflow-y-auto">
                {#each rewards as r, index (index)}
                  <div
                    class="flex items-center gap-2 py-1 border-b border-dashed border-border-subtle last:border-b-0"
                  >
                    {#if r.imageUrl}
                      <img
                        src={r.imageUrl}
                        alt={itemLabel(r)}
                        class="w-[22px] h-[22px] object-contain shrink-0 opacity-90"
                      />
                    {/if}
                    <span class="flex-1 min-w-0 text-xs text-text-primary truncate"
                      >{itemLabel(r)}</span
                    >
                    <span
                      class="text-xs font-semibold shrink-0"
                      style="color:{dropRarityColour(r.rarity)}"
                    >
                      {r.rarity}
                    </span>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        {:else}
          <DropSourceTile {source} />
        {/if}
      {/each}
      {#if $places.length > initialLimit}
        <button
          class="block w-full cursor-pointer border-0 bg-transparent py-1.5 text-left font-display text-xs text-accent opacity-85 hover:opacity-100 hover:underline"
          onclick={() => (showAll = !showAll)}
          >{showAll
            ? $tr("common.showFewer")
            : $tr("drops.viewAllSources", { count: $places.length })}</button
        >
      {/if}
    </div>
  </div>
{/if}
