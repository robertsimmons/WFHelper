<script lang="ts">
  import { SvelteMap } from "svelte/reactivity";

  import { buildCraftingTree } from "../../lib/craftingTree.js";
  import { formatNumber } from "../../lib/format.js";
  import { tr } from "../../lib/i18n.js";
  import { componentOwnership, itemDb } from "../../stores/data.js";
  import { partLeaf, planOnlyParts } from "./acquisitionParts.js";
  import { TONE } from "./chips.js";
  import type { CraftingTreeNode } from "../../lib/craftingTree.js";
  import type { ResolvedPlan } from "../../lib/suggest/acquisition/plan/index.js";

  interface Props {
    /** The item whose recipe the tree hangs off; a blueprint roots at its product. */
    root: string;
    /** Its plan, whose foundry can build parts the recipe never names. */
    plan: ResolvedPlan | null;
  }

  const { root, plan }: Props = $props();

  const ROW = "grid grid-cols-[minmax(0,1fr)_4rem] items-center gap-2 py-px text-xs leading-tight";
  const INDENT = 0.85;

  // A cut gem or a refined alloy is part of the bill the player has to work
  // through, so this tree opens those where the foundry's own tree stops. A part
  // and its blueprint are two lines: a blueprint in hand is not a built part.
  const OPTIONS = { expandConversions: true, splitPartBlueprints: true } as const;

  const tree = $derived(buildCraftingTree(root, $itemDb, $componentOwnership, OPTIONS));

  /** With parts only the plan names, the item itself becomes one part beside them. */
  const top = $derived.by((): CraftingTreeNode[] => {
    if (!tree) return [];
    const extras = planOnlyParts(plan, tree, $itemDb);
    if (extras.length === 0) return tree.children;
    return [
      tree,
      ...extras.map(
        (part) =>
          (part.uniqueName
            ? buildCraftingTree(part.uniqueName, $itemDb, $componentOwnership, OPTIONS)
            : null) ?? partLeaf(part),
      ),
    ];
  });

  function isPart(node: CraftingTreeNode): boolean {
    return (node.isCraftable && node.isConversion !== true) || node.isBlueprintItem === true;
  }

  const parts = $derived.by(() => {
    const rows = top.filter(isPart);
    return { total: rows.length, done: rows.filter((row) => row.missing === 0).length };
  });

  /** Every part opens on request only, so the list reads as the parts first. */
  const opened = new SvelteMap<string, boolean>();

  function label(node: CraftingTreeNode): string {
    return node.displayName || node.name;
  }
</script>

{#snippet branch(node: CraftingTreeNode, depth: number, path: string)}
  {@const open = opened.get(path) ?? false}
  {@const done = node.missing === 0}
  <div class={ROW}>
    <span class="flex min-w-0 items-center gap-1" style="padding-left: {depth * INDENT}rem">
      {#if node.children.length > 0}
        <button
          type="button"
          class="flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-[var(--radius-sm)]
                 text-text-muted transition-colors duration-150 hover:text-text-primary"
          aria-expanded={open}
          title={$tr(open ? "crafting.collapseRecipe" : "crafting.expandRecipe")}
          onclick={() => opened.set(path, !open)}
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
  </div>
  {#if open}
    {#each node.children as child, index (child.uniqueName + index)}
      {@render branch(child, depth + 1, `${path}/${child.uniqueName}:${index}`)}
    {/each}
  {/if}
{/snippet}

{#if top.length > 0}
  <div class="flex flex-col gap-1" data-acquisition-parts>
    <div class="flex items-baseline justify-between gap-3.5">
      <span class="text-xs font-semibold uppercase tracking-[0.1em] text-text-secondary"
        >{$tr("nextUp.acqParts")}</span
      >
      {#if parts.total > 0}
        <span class="text-xs tabular-nums {parts.done === parts.total ? TONE.good : TONE.plain}"
          >{parts.done}/{parts.total}</span
        >
      {/if}
    </div>
    <div class="flex flex-col">
      {#each top as node, index (node.uniqueName + index)}
        {@render branch(node, 0, `${node.uniqueName}:${index}`)}
      {/each}
    </div>
  </div>
{/if}
