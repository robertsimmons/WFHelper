<script lang="ts">
  import { tr, type MessageKey } from "../../lib/i18n.js";
  import { mapNeeds, type MapNeed } from "../../lib/maps/needs.js";
  import { mapPins, orderedKinds, pinKinds, pinsForNeeds } from "../../lib/maps/pins.js";
  import { SvelteSet } from "svelte/reactivity";
  import { baseMap } from "../../lib/maps/registry.js";
  import type { ResolvedPlan } from "../../lib/suggest/acquisition/plan/index.js";
  import ModalShell from "../ModalShell.svelte";
  import MapView from "./MapView.svelte";

  interface Props {
    /** Every group of the plan counts, not only the one whose button opened this. */
    plan: ResolvedPlan;
    mapKey: string;
    onClose: () => void;
  }

  const { plan, mapKey, onClose }: Props = $props();

  const KIND_WORD: Readonly<Record<string, MessageKey>> = {
    mining: "nextUp.farmMapKindMining",
    fishing: "nextUp.farmMapKindFishing",
    resource: "nextUp.farmMapKindResource",
    cave: "nextUp.farmMapKindCave",
  };
  const SUMMARY: Readonly<Record<string, [MessageKey, MessageKey]>> = {
    resource: ["nextUp.farmMapSpot", "nextUp.farmMapSpots"],
    fishing: ["nextUp.farmMapFishingSpot", "nextUp.farmMapFishingSpots"],
    cave: ["nextUp.farmMapCave", "nextUp.farmMapCaves"],
    mining: ["nextUp.farmMapMiningArea", "nextUp.farmMapMiningAreas"],
  };

  const map = $derived(baseMap(mapKey));
  const needs = $derived(mapNeeds(plan, mapKey));
  const placed = $derived(
    pinsForNeeds(
      mapPins(mapKey),
      needs.map((need) => need.name),
    ),
  );
  const colors = $derived(Object.fromEntries(needs.map((need) => [need.name, need.color])));
  const kinds = $derived(pinKinds(placed));
  const pinned = $derived(needs.filter((need) => kinds.has(need.name)).map((need) => need.name));

  // Null is every pinned resource, so a plan that gains one keeps showing it.
  let chosen = $state<ReadonlySet<string> | null>(null);
  const shown = $derived(chosen ?? new Set(pinned));

  const visible = $derived(
    placed
      .map((entry) => ({ pin: entry.pin, refs: entry.refs.filter((name) => shown.has(name)) }))
      .filter((entry) => entry.refs.length > 0),
  );

  function pinCount(need: MapNeed): number {
    let total = 0;
    for (const count of kinds.get(need.name)?.values() ?? []) total += count;
    return total;
  }

  function summary(need: MapNeed): string {
    const counts = kinds.get(need.name);
    if (!counts) return "";
    return orderedKinds(counts)
      .map((kind) => {
        const count = counts.get(kind) ?? 0;
        const [one, many] = SUMMARY[kind] ?? ["nextUp.farmMapPin", "nextUp.farmMapPins"];
        return $tr(count === 1 ? one : many, { count });
      })
      .join(" + ");
  }

  function kindWord(need: MapNeed): string {
    const counts = kinds.get(need.name);
    const top = counts ? orderedKinds(counts)[0] : undefined;
    return $tr(KIND_WORD[top ?? "resource"] ?? "nextUp.farmMapKindResource");
  }

  function solo(need: MapNeed): void {
    chosen = new Set([need.name]);
  }

  function toggle(need: MapNeed): void {
    const next = new SvelteSet(shown);
    if (next.has(need.name)) next.delete(need.name);
    else next.add(need.name);
    chosen = next;
  }

  const ariaLabel = $derived(
    map ? $tr("nextUp.farmMapAria", { map: map.name, plan: plan.name }) : plan.name,
  );
</script>

<ModalShell {ariaLabel} {onClose}>
  {#if map}
    <div
      class="detail-panel flex h-[92vh] max-h-[92vh] w-[96vw] max-w-[96vw] flex-col overflow-hidden p-0"
      data-farm-map
    >
      <div class="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <span class="flex min-w-0 items-baseline gap-2.5 pl-2">
          <h3 class="m-0 truncate font-display text-lg text-text-primary">{map.name}</h3>
          <span class="truncate text-sm text-accent">{plan.name}</span>
        </span>
        <button
          class="btn-secondary btn-sm !px-2"
          aria-label={$tr("common.close")}
          title={$tr("common.close")}
          onclick={onClose}>&times;</button
        >
      </div>

      <div class="grid min-h-0 flex-1 grid-cols-[1fr_380px]">
        <div class="min-h-0 min-w-0">
          <MapView
            imageUrl={map.imageUrl}
            size={map.size}
            alt={map.name}
            pins={visible}
            {colors}
            backdrop={map.backdrop}
          />
        </div>

        <aside class="flex min-h-0 flex-col border-l border-border bg-bg-surface">
          <div class="flex items-center justify-between border-b border-border px-3.5 py-2.5">
            <span class="text-xs font-semibold uppercase leading-[1.2] tracking-[0.1em]"
              >{$tr("nextUp.farmMapResources")}</span
            >
            <button
              class="cursor-pointer rounded-[var(--radius-sm)] border border-border px-[9px] py-0.5
                     text-xs text-text-secondary transition-colors duration-150
                     hover:bg-bg-hover hover:text-text-primary"
              title={$tr("nextUp.farmMapAllTitle")}
              aria-pressed={chosen === null}
              onclick={() => (chosen = null)}>{$tr("nextUp.farmMapAll")}</button
            >
          </div>

          {#if needs.length === 0}
            <p class="m-0 px-3.5 py-3 text-xs text-text-muted">{$tr("nextUp.farmMapNothing")}</p>
          {/if}

          <ul class="m-0 min-h-0 list-none overflow-y-auto p-0 py-1.5">
            {#each needs as need (need.name)}
              {@const count = pinCount(need)}
              {@const on = shown.has(need.name)}
              {@const dim = count > 0 && !on}
              <li
                class="grid grid-cols-[12px_1fr_auto] items-start gap-x-2.5 gap-y-1 border-b
                       border-border-subtle px-3.5 py-2 last:border-b-0"
                data-farm-need={need.name}
              >
                <span
                  class="mt-[3px] h-3 w-3 rounded-full border border-bg-deep
                         {dim ? 'opacity-30' : ''}"
                  style="background: {need.color}"
                ></span>
                <div class="flex min-w-0 flex-wrap items-baseline gap-2">
                  {#if count > 0}
                    <button
                      class="cursor-pointer border-0 bg-transparent p-0 text-left font-semibold
                             hover:text-accent {dim ? 'text-text-muted' : 'text-text-primary'}"
                      title={$tr("nextUp.farmMapSolo", { name: need.name })}
                      onclick={() => solo(need)}>{need.name}</button
                    >
                  {:else}
                    <span class="font-semibold text-text-primary">{need.name}</span>
                  {/if}
                  {#if need.qty !== null}
                    <span
                      class="text-[0.8125rem] tabular-nums {dim
                        ? 'text-text-muted'
                        : 'text-accent'}">&times;{need.qty.toLocaleString("en-US")}</span
                    >
                  {/if}
                  {#if count === 0}
                    <span
                      class="rounded-[var(--radius-sm)] border border-border-subtle px-[5px]
                             text-[0.6875rem] uppercase tracking-[0.08em] text-text-muted"
                      >{$tr("nextUp.farmMapAnywhere")}</span
                    >
                  {/if}
                </div>
                <button
                  class="relative mt-0.5 h-4 w-[30px] cursor-pointer rounded-lg border p-0
                         disabled:cursor-default disabled:opacity-35
                         {on
                    ? 'border-border-strong bg-accent-glow'
                    : 'border-border-subtle bg-bg-raised'}"
                  aria-pressed={on}
                  aria-label={$tr("nextUp.farmMapToggle", { name: need.name })}
                  title={$tr("nextUp.farmMapToggle", { name: need.name })}
                  disabled={count === 0}
                  onclick={() => toggle(need)}
                  ><span
                    class="absolute top-[2px] h-2.5 w-2.5 rounded-full transition-[left] duration-150
                           {on ? 'left-4 bg-accent' : 'left-[2px] bg-text-muted'}"
                  ></span></button
                >
                {#if count > 0}
                  <div class="col-span-2 col-start-2 text-xs text-text-muted">
                    <span class="text-text-secondary">{kindWord(need)}</span> · {summary(need)}
                  </div>
                {/if}
                {#if need.where}
                  <div class="col-span-2 col-start-2 text-xs text-text-secondary">{need.where}</div>
                {/if}
              </li>
            {/each}
          </ul>
        </aside>
      </div>

      <div
        class="flex justify-between gap-3 border-t border-border bg-bg-surface px-3.5 py-1.5
               text-[0.6875rem] text-text-muted"
      >
        <span>{map.credit}</span>
        <span>{$tr("nextUp.farmMapPinsShown", { count: visible.length })}</span>
      </div>
    </div>
  {/if}
</ModalShell>
