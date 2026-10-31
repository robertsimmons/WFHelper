import type { CraftingTreeNode } from "../../lib/craftingTree.js";
import type { ResolvedPlan } from "../../lib/suggest/acquisition/plan/index.js";
import type { ItemDbEntry } from "../../types/inventory.js";

/** A part the plan's foundry builds that the item's own recipe never names: a
 *  K-Drive's reactor, nose and jet. */
interface PlanOnlyPart {
  name: string;
  /** Null when no item carries the name, which still draws as a line. */
  uniqueName: string | null;
  done: boolean;
}

function treeNames(node: CraftingTreeNode, out = new Set<string>()): Set<string> {
  out.add(node.name.toLowerCase());
  if (node.displayName) out.add(node.displayName.toLowerCase());
  for (const child of node.children) treeNames(child, out);
  return out;
}

/** The built item a name belongs to, never its blueprint. */
function builtItem(name: string, itemDb: Record<string, ItemDbEntry>): string | null {
  const wanted = name.trim().toLowerCase();
  let fallback: string | null = null;
  for (const [uniqueName, entry] of Object.entries(itemDb)) {
    if (entry.name?.toLowerCase() !== wanted || entry.buildsProduct) continue;
    if (entry.recipe) return uniqueName;
    fallback ??= uniqueName;
  }
  return fallback;
}

export function planOnlyParts(
  plan: ResolvedPlan | null,
  tree: CraftingTreeNode | null,
  itemDb: Record<string, ItemDbEntry>,
): PlanOnlyPart[] {
  if (!plan || !tree) return [];
  const known = treeNames(tree);
  const out: PlanOnlyPart[] = [];
  for (const group of plan.groups) {
    if (group.type !== "foundry") continue;
    for (const row of group.rows) {
      const key = row.label.trim().toLowerCase();
      if (known.has(key)) continue;
      known.add(key);
      out.push({ name: row.label, uniqueName: builtItem(row.label, itemDb), done: row.done });
    }
  }
  return out;
}

/** A line for a part no recipe describes: one to build, held or not. */
export function partLeaf(part: PlanOnlyPart): CraftingTreeNode {
  const owned = part.done ? 1 : 0;
  return {
    uniqueName: part.uniqueName ?? part.name,
    name: part.name,
    imageUrl: null,
    count: 1,
    owned,
    missing: 1 - owned,
    isCraftable: true,
    recipe: null,
    usedFor: [],
    children: [],
  };
}
