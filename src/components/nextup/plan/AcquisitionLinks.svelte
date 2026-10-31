<script lang="ts">
  import { requestCraftingTree } from "../../../lib/craftingTree.js";
  import { tr, type MessageKey } from "../../../lib/i18n.js";
  import { buildParsedItemFromDb } from "../../../lib/parsedItemFromDb.js";
  import { openOnWfm } from "../../../lib/priceLoader.js";
  import { componentOwnership, itemDb, wfmItems } from "../../../stores/data.js";
  import { activeItem } from "../../../stores/modals.js";
  import WikiButton from "../../WikiButton.svelte";
  import { marketLinks } from "./marketLinks.js";
  import { copiesTag, type CopiesTag } from "./planSteps.js";
  import type { ResolvedPlan } from "../../../lib/suggest/acquisition/plan/index.js";

  interface Props {
    name: string;
    /** The item the crafting tree and the market pages root at. */
    root: string | null;
    plan: ResolvedPlan | null;
  }

  const { name, root, plan }: Props = $props();

  const COPIES: Record<CopiesTag, MessageKey> = {
    two: "nextUp.copiesTwo",
    haveOne: "nextUp.copiesHaveOne",
    subsumed: "common.subsumed",
    primeOwned: "nextUp.copiesPrimeOwned",
  };
  const LINK =
    "cursor-pointer text-xs text-info underline-offset-2 transition-colors duration-150 " +
    "hover:text-accent hover:underline";

  const tag = $derived(plan ? copiesTag(plan) : null);
  const market = $derived(marketLinks(root, $itemDb, $wfmItems));
  const treeEntry = $derived(root ? ($itemDb[root] ?? null) : null);

  function openTree(): void {
    if (!root || !treeEntry) return;
    requestCraftingTree();
    activeItem.set(buildParsedItemFromDb(root, treeEntry, $componentOwnership));
  }
</script>

<span class="flex flex-wrap items-center gap-x-2.5 gap-y-1" data-acquisition-links>
  {#if tag}
    <span
      class="rounded-[var(--radius-sm)] px-1.5 py-px text-xs {tag === 'two'
        ? 'bg-bg-raised text-text-secondary'
        : 'bg-success/15 text-success'}"
      data-copies-tag={tag}>{$tr(COPIES[tag])}</span
    >
  {/if}
  <WikiButton fallbackName={name} />
  {#if market.length > 0}
    <span class="flex flex-wrap items-baseline gap-x-1.5 text-xs" data-market-links>
      {#if market[0]?.part}<span class="text-text-muted">{$tr("market.wfmTitle")}</span>{/if}
      {#each market as link (link.slug)}
        <button
          type="button"
          class={LINK}
          title={$tr("common.openOnWarframeMarket")}
          onclick={() => openOnWfm(link.slug)}>{link.part ?? $tr("market.wfmTitle")}</button
        >
      {/each}
    </span>
  {/if}
  {#if treeEntry}
    <button type="button" class={LINK} data-crafting-tree onclick={openTree}
      >{$tr("detail.craftingTree")}</button
    >
  {/if}
</span>
