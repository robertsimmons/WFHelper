<script lang="ts">
  import { tr } from "../../lib/i18n.js";
  import { mapPins, pinsForNeeds, type PlacedPin } from "../../lib/maps/pins.js";
  import { baseMap } from "../../lib/maps/registry.js";
  import MapView from "../maps/MapView.svelte";
  import type {
    ScannablePlaceCard,
    ScannablePlaceItem,
  } from "../../lib/suggest/scannablePlaces.js";
  import { SCAN_GROUPS } from "../../lib/suggest/scannables.js";
  import { simulacrum } from "../../stores/simulacrum.js";
  import { CHIP_TONE, TILE_MICRO, TONE } from "./chips.js";
  import ItemTile from "./ItemTile.svelte";
  import { SCAN_GROUP_LABEL } from "./scanGroupLabels.js";
  import ModalShell from "../ModalShell.svelte";
  import WikiButton from "../WikiButton.svelte";

  interface Props {
    card: ScannablePlaceCard;
    title: string;
    onClose: () => void;
  }

  const { card, title, onClose }: Props = $props();

  const SCANNABLE_PIN_FILES = import.meta.glob("../../data/maps/pins/scannables-*.json", {
    eager: true,
    import: "default",
  });
  const SCANNABLE_PIN_IDS: ReadonlySet<string> = new Set(
    Object.values(SCANNABLE_PIN_FILES).flatMap((pins) =>
      Array.isArray(pins) ? pins.map((pin: { id?: unknown }) => pin.id).filter(isString) : [],
    ),
  );
  // CHIP_TONE has four tones for five kinds, so fish takes the info tone.
  const PIN_COLOR: Readonly<Record<string, string>> = {
    fragment: "var(--success)",
    somachord: "var(--warning)",
    prex: "var(--danger)",
    fish: "var(--info)",
    object: "var(--text-muted)",
  };

  function isString(value: unknown): value is string {
    return typeof value === "string";
  }

  const CHIP = "rounded-[var(--radius-sm)] border border-border px-1.5 py-0.5 text-[0.6875rem]";
  const GRID = "grid min-w-0 grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-2";

  const place = $derived(card.place);
  const facts = $derived([
    $tr("nextUp.scanPlaceLeft", { count: String(card.left) }),
    ...(place ? [$tr("nextUp.scanPlacePerRun", { count: String(card.perRun) })] : []),
  ]);
  const sections = $derived(
    SCAN_GROUPS.map((group) => ({
      group,
      items: card.items.filter((item) => item.group === group),
    })).filter((section) => section.items.length > 0),
  );

  const map = $derived(baseMap(place?.mapKey));
  const placed = $derived.by((): PlacedPin[] => {
    if (!map || !place?.mapKey) return [];
    const names = new Map(card.items.map((item) => [item.entry.type, item.entry.name]));
    const scannables = mapPins(place.mapKey).filter((pin) => SCANNABLE_PIN_IDS.has(pin.id));
    return pinsForNeeds(scannables, [...names.keys()]).map(({ pin, refs }) => ({
      pin,
      refs: refs.map((type) => names.get(type) ?? type),
    }));
  });

  function progress(item: ScannablePlaceItem): string {
    const { scanned, required } = item.entry;
    return required === null ? String(scanned) : `${scanned}/${required}`;
  }
</script>

<ModalShell ariaLabel={title} {onClose}>
  <div class="detail-panel w-[960px] max-w-[95vw] p-4" data-scannable-place-details={card.key}>
    <div class="mb-3 flex items-start justify-between gap-2">
      <span class="flex min-w-0 flex-wrap items-center gap-2 pl-2">
        <h3 class="m-0 truncate font-display text-lg text-text-primary">{title}</h3>
        {#each facts as fact (fact)}
          <span class="shrink-0 {CHIP} font-semibold tabular-nums {CHIP_TONE.plain}">{fact}</span>
        {/each}
        {#if place?.wiki}
          <span class="shrink-0"><WikiButton wikiUrl={place.wiki} fallbackName={place.name} /></span
          >
        {/if}
      </span>
      <button
        class="btn-secondary btn-sm !px-2"
        aria-label={$tr("common.close")}
        title={$tr("common.close")}
        onclick={onClose}>&times;</button
      >
    </div>

    <div class="flex flex-col gap-3">
      {#if map?.imageUrl}
        <div
          class="flex flex-col overflow-hidden rounded-[var(--radius-sm)] border border-border"
          data-scannable-place-map={map.key}
        >
          <div class="h-[420px] min-w-0">
            <MapView
              imageUrl={map.imageUrl}
              size={map.size}
              alt={map.name}
              pins={placed}
              colors={{}}
              kindColors={PIN_COLOR}
              backdrop={map.backdrop}
            />
          </div>
          <div
            class="flex justify-between gap-3 border-t border-border bg-bg-surface px-3.5 py-1.5
                   text-[0.6875rem] text-text-muted"
          >
            <span>{map.credit}</span>
            <span>{$tr("nextUp.farmMapPinsShown", { count: placed.length })}</span>
          </div>
        </div>
      {/if}

      {#if place && (place.run || place.gear.length > 0 || place.gates.length > 0)}
        <div class="flex flex-wrap items-center gap-1 pl-2" data-scannable-place-gates>
          {#if place.run}
            <span class="{CHIP} leading-none text-text-primary">{place.run}</span>
          {/if}
          {#each place.gear as gear (gear)}
            <span class="{CHIP} leading-none {CHIP_TONE.plain}">{gear}</span>
          {/each}
          {#each place.gates as gate (gate)}
            <span class="{CHIP} leading-none {CHIP_TONE.plain}">{gate}</span>
          {/each}
        </div>
      {/if}

      {#if place && place.steps.length > 0}
        <ol class="m-0 flex list-none flex-col gap-0.5 p-0 pl-2" data-scannable-place-steps>
          {#each place.steps as step, index (index)}
            <li class="flex min-w-0 items-baseline gap-1 text-sm">
              <span class="w-3 shrink-0 font-display font-semibold text-accent">{index + 1}</span>
              <span class="min-w-0 text-text-primary">{step}</span>
            </li>
          {/each}
        </ol>
      {/if}

      {#each sections as section (section.group)}
        <div class="flex min-w-0 flex-col gap-2" data-scannable-place-group={section.group}>
          <span class="pl-2 {TILE_MICRO} {TONE.quiet}"
            >{$tr(SCAN_GROUP_LABEL[section.group])} · {section.items.length}</span
          >
          <div class={GRID}>
            {#each section.items as item (item.entry.type)}
              <ItemTile
                name={item.entry.name}
                imageUrl={$simulacrum.enemyImage(item.entry.image)}
                stretch
              >
                {#snippet actions()}
                  <span class="tabular-nums {TONE.quiet}">{progress(item)}</span>
                  {#if item.entry.wiki}
                    <span class="flex [&>button]:h-5 [&>button]:px-1">
                      <WikiButton wikiUrl={item.entry.wiki} fallbackName={item.entry.name} />
                    </span>
                  {/if}
                {/snippet}
              </ItemTile>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </div>
</ModalShell>
