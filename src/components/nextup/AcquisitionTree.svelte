<script lang="ts">
  import { SvelteMap } from "svelte/reactivity";

  import {
    buildCraftingTree,
    computeCraftingSummary,
    requestCraftingTree,
  } from "../../lib/craftingTree.js";
  import { formatBuildTime, formatNumber } from "../../lib/format.js";
  import { tr } from "../../lib/i18n.js";
  import { buildParsedItemFromDb } from "../../lib/parsedItemFromDb.js";
  import { componentOwnership, itemDb } from "../../stores/data.js";
  import { activeItem } from "../../stores/modals.js";
  import { TILE_MICRO, TONE } from "./chips.js";
  import type { CraftingTreeNode } from "../../lib/craftingTree.js";
  import type { AcquisitionTarget } from "../../lib/suggest/acquisition/types.js";

  interface Props {
    target: AcquisitionTarget;
    /** The item whose recipe the tree hangs off; a blueprint roots at its product. */
    root: string;
  }

  const { target, root }: Props = $props();

  const ROW =
    "grid grid-cols-[minmax(0,1fr)_5rem_minmax(0,11rem)_4rem] items-center gap-2 py-px text-xs leading-tight";
  const RAIL = "grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-2";
  const VALUE = "font-display text-sm font-semibold tabular-nums text-text-primary";
  const INDENT = 0.85;

  /** "Mag Prime Neuroptics Blueprint" -> "mag prime neuroptics", the same key the
   *  relic reader folds a part name down to. */
  function partKey(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+blueprint$/, "")
      .trim();
  }

  // A cut gem or a refined alloy is part of the bill the player has to work
  // through, so this tree opens those where the foundry's own tree stops. A part
  // and its blueprint are two lines: a blueprint in hand is not a built part.
  const tree = $derived(
    buildCraftingTree(root, $itemDb, $componentOwnership, {
      expandConversions: true,
      splitPartBlueprints: true,
    }),
  );
  const summary = $derived(tree ? computeCraftingSummary(tree) : null);

  /** Which relics pay a part the player is still short of. Absent leaves the row
   *  reading its shortfall; it never reads as a relic the player cannot name. */
  const relicsByPart = $derived.by(() => {
    const out = new SvelteMap<string, string[]>();
    for (const path of target.paths) {
      for (const row of path.cost.relics?.rows ?? []) {
        const key = partKey(row.part);
        const held = out.get(key);
        if (held) {
          if (!held.includes(row.relic)) held.push(row.relic);
        } else {
          out.set(key, [row.relic]);
        }
      }
    }
    return out;
  });

  const plat = $derived(target.paths.find((path) => path.kind === "trade")?.cost.plat ?? null);
  const platSet = $derived(plat?.set ?? null);
  // Buying the set and buying every missing part are two prices only when they
  // differ; an unpriced part leaves the total absent rather than low.
  const platParts = $derived(
    plat && plat.partsTotal !== null && plat.partsTotal !== plat.set ? plat.partsTotal : null,
  );

  /** What the market asks for one still-missing part. A part the cache has no
   *  price for is absent here, and its row stays blank rather than reading free. */
  const platByPart = $derived.by(() => {
    const out = new SvelteMap<string, number>();
    for (const row of plat?.parts ?? []) {
      if (row.plat !== null) out.set(partKey(row.name), row.plat);
    }
    return out;
  });

  function isPart(node: CraftingTreeNode): boolean {
    return (node.isCraftable && node.isConversion !== true) || node.isBlueprintItem === true;
  }

  const parts = $derived.by(() => {
    const rows = (tree?.children ?? []).filter(isPart);
    return { total: rows.length, done: rows.filter((row) => row.missing === 0).length };
  });

  /** Raw materials down the branches still in play. A branch already covered
   *  costs nothing more, so counting its bill would read as work outstanding. */
  const materials = $derived.by(() => {
    const seen = new SvelteMap<string, { count: number; owned: number }>();
    const walk = (node: CraftingTreeNode): void => {
      if (node.missing === 0) return;
      if (node.children.length === 0 && !isPart(node)) {
        const row = seen.get(node.uniqueName);
        if (row) row.count += node.count;
        else seen.set(node.uniqueName, { count: node.count, owned: node.owned });
        return;
      }
      for (const child of node.children) walk(child);
    };
    if (tree) walk(tree);
    const rows = [...seen.values()];
    return { total: rows.length, done: rows.filter((row) => row.owned >= row.count).length };
  });

  interface Fact {
    text: string;
    title: string;
  }

  /** Only what the owned/count ratio cannot say: what a run of this costs in
   *  time and credits, the batch a sub-combine yields, the relic a part drops
   *  from. A plain material earns nothing here. */
  function facts(node: CraftingTreeNode): Fact[] {
    const out: Fact[] = [];
    const recipe = node.recipe;
    if (recipe) {
      const perCraft = Math.max(1, recipe.num || 1);
      if (node.isConversion && perCraft > 1) {
        const count = formatNumber(perCraft);
        out.push({
          text: $tr("nextUp.treePerCraft", { count }),
          title: $tr("nextUp.treePerCraftTitle", { count }),
        });
      }
      if (recipe.buildTime > 0) {
        out.push({ text: formatBuildTime(recipe.buildTime), title: $tr("nextUp.treeBuildTime") });
      }
      if (recipe.buildPrice > 0) {
        out.push({
          text: $tr("world.baro.creditsShort", { amount: formatNumber(recipe.buildPrice) }),
          title: $tr("nextUp.treeCredits"),
        });
      }
      return out;
    }
    const relics = relicsByPart.get(partKey(node.name));
    if (relics?.length) out.push({ text: relics[0], title: relics.join(", ") });
    return out;
  }

  /** The trade price of a part still to find. The root is the whole item, which
   *  the rail already prices, and a part in hand costs nothing more. */
  function partPlat(node: CraftingTreeNode, depth: number): number | null {
    if (depth === 0 || node.missing === 0 || !isPart(node)) return null;
    const key = partKey(node.name);
    // What the market sells is the blueprint that drops, not the built part, so
    // a part carrying one of those rows leaves the price to it and prints none.
    const tradedBelow = node.children.some(
      (child) => child.isBlueprintItem === true && partKey(child.name) === key,
    );
    return tradedBelow ? null : (platByPart.get(key) ?? null);
  }

  /** A satisfied branch draws closed and a short one open, so the tree is only
   *  as long as the work left. The root is the item the panel is about and always
   *  opens; a hand-set branch keeps whatever it was set to. */
  const opened = new SvelteMap<string, boolean>();

  function isOpen(path: string, node: CraftingTreeNode, depth: number): boolean {
    return opened.get(path) ?? (depth === 0 || node.missing > 0);
  }

  function toggle(path: string, node: CraftingTreeNode, depth: number): void {
    opened.set(path, !isOpen(path, node, depth));
  }

  function label(node: CraftingTreeNode): string {
    return node.displayName || node.name;
  }

  const foundryEntry = $derived($itemDb[root] ?? null);

  function openFoundryTree(): void {
    if (!foundryEntry) return;
    requestCraftingTree();
    activeItem.set(buildParsedItemFromDb(root, foundryEntry, $componentOwnership));
  }
</script>

{#snippet branch(node: CraftingTreeNode, depth: number, path: string)}
  {@const open = isOpen(path, node, depth)}
  {@const done = node.missing === 0}
  {@const rowFacts = facts(node)}
  {@const cost = partPlat(node, depth)}
  <div class={ROW}>
    <span class="flex min-w-0 items-center gap-1" style="padding-left: {depth * INDENT}rem">
      {#if node.children.length > 0}
        <button
          type="button"
          class="flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-sm)]
                 text-text-muted transition-colors duration-150 hover:text-text-primary"
          aria-expanded={open}
          title={$tr(open ? "crafting.collapseRecipe" : "crafting.expandRecipe")}
          onclick={() => toggle(path, node, depth)}
        >
          <svg
            viewBox="0 0 12 12"
            width="10"
            height="10"
            fill="currentColor"
            aria-hidden="true"
            class="transition-transform duration-150 {open ? 'rotate-90' : ''}"
          >
            <path d="M4 2.5 8.5 6 4 9.5z" />
          </svg>
        </button>
      {:else}
        <span class="h-4 w-4 shrink-0"></span>
      {/if}
      <!-- Green is the whole answer for a line already covered: no word repeats it. -->
      <span class="min-w-0 truncate {done ? TONE.good : 'text-text-primary'}" title={label(node)}
        >{label(node)}</span
      >
    </span>
    <span class="text-right tabular-nums {done ? TONE.good : TONE.plain}"
      >{formatNumber(node.owned)}/{formatNumber(node.count)}</span
    >
    <span class="flex min-w-0 items-center justify-end gap-2 {TONE.quiet}">
      {#each rowFacts as fact, index (index)}
        <span class="truncate tabular-nums" title={fact.title}>{fact.text}</span>
      {/each}
    </span>
    {#if cost !== null}
      <span class="truncate text-right tabular-nums {TONE.quiet}" title={$tr("nextUp.tileCostTitle")}
        >{$tr("nextUp.acqPlatEach", { plat: String(Math.round(cost)) })}</span
      >
    {:else}
      <span></span>
    {/if}
  </div>
  {#if open}
    {#each node.children as child, index (child.uniqueName + index)}
      {@render branch(child, depth + 1, `${path}/${child.uniqueName}:${index}`)}
    {/each}
  {/if}
{/snippet}

{#snippet railRow(value: string, text: string, tone = "")}
  <span class="{VALUE} text-right {tone}">{value}</span>
  <span class="{TILE_MICRO} {TONE.plain}">{text}</span>
{/snippet}

{#if tree}
  <div class="flex gap-4">
    <div class="min-h-0 max-h-[24rem] min-w-0 flex-1 overflow-y-auto pr-1">
      {@render branch(tree, 0, tree.uniqueName)}
    </div>

    <div class="flex w-56 shrink-0 flex-col gap-3 border-l border-border pl-4">
      {#if platSet !== null}
        <div class={RAIL}>
          {@render railRow(
            $tr("nextUp.acqPlatEach", { plat: String(Math.round(platSet)) }),
            $tr("nextUp.treeSet"),
          )}
          {#if platParts !== null}
            {@render railRow(
              $tr("nextUp.acqPlatEach", { plat: String(Math.round(platParts)) }),
              $tr("nextUp.treePartsApart"),
            )}
          {/if}
        </div>
      {/if}

      {#if target.parts.known}
        <div class={RAIL}>
          {@render railRow(
            $tr("world.baro.creditsShort", { amount: formatNumber(target.parts.credits) }),
            $tr("common.foundry"),
            target.parts.buildable ? TONE.good : "",
          )}
        </div>
      {/if}

      {#if parts.total > 0 || materials.total > 0}
        <div class={RAIL}>
          {#if parts.total > 0}
            {@render railRow(`${parts.done}/${parts.total}`, $tr("nextUp.acqParts"))}
          {/if}
          {#if materials.total > 0}
            {@render railRow(`${materials.done}/${materials.total}`, $tr("nextUp.detailsMaterials"))}
          {/if}
        </div>
      {/if}

      {#if summary && summary.maxBuildTime > 0}
        <div class={RAIL}>
          {@render railRow(formatBuildTime(summary.maxBuildTime), $tr("nextUp.treeInOrder"))}
          {@render railRow(formatBuildTime(summary.minBuildTime), $tr("nextUp.treeInParallel"))}
        </div>
      {/if}

      {#if foundryEntry}
        <button
          class="detail-wiki-btn w-fit"
          title={$tr("nextUp.treeFoundryTitle")}
          onclick={openFoundryTree}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
            <path
              d="M2 1.5h1.5v13H2v-13zm1.5 2H14V5H3.5V3.5zm0 4.25H14v1.5H3.5v-1.5zm0 4.25H14v1.5H3.5V12z"
            />
          </svg>
          <span>{$tr("detail.craftingTree")}</span>
        </button>
      {/if}
    </div>
  </div>
{/if}
