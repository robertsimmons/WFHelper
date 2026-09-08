interface InventoryItemWithType {
  ItemType?: unknown;
  ItemCount?: unknown;
}

const DEFAULT_OWNED_COUNT = 1;

/** Stacked slices carry a count; built gear is one row per copy. A rolled mod or
 *  riven in `Upgrades` carries no count and so counts as the one copy it is,
 *  which the per-ItemType sum then adds up. */
const STACKED_COLLECTIONS = [
  "MiscItems",
  "Recipes",
  "FusionTreasures",
  "RawUpgrades",
  "Upgrades",
  "Arcanes",
  "LevelKeys",
] as const;

/** Currency the account holds as a top-level scalar with no inventory row to
 *  count. `PrimeTokens` is Regal Aya, not Aya. */
const CURRENCY_FIELDS: Record<string, string> = {
  endo: "FusionPoints",
  credits: "RegularCredits",
  platinum: "PremiumCredits",
  "regal aya": "PrimeTokens",
};

/** Currency shares the ownership map under a prefix no Lotus path can collide
 *  with, so a reward count needs one map and not two. Keys are normalized
 *  reward names. */
export function currencyOwnershipKey(name: string): string {
  return `currency:${name}`;
}

/** Built gear lives in its own collection, and a built weapon or frame can be a
 *  recipe ingredient - Aklex Prime consumes two built Lex Primes. Reading only
 *  the stacked slices reports gear the player is holding as missing. */
const BUILT_GEAR_COLLECTIONS = [
  "Suits",
  "LongGuns",
  "Pistols",
  "Melee",
  "SpecialItems",
  "SentinelWeapons",
  "Sentinels",
  "SpaceGuns",
  "SpaceMelee",
  "SpaceSuits",
  "MechSuits",
  "Hoverboards",
  "OperatorAmps",
  "KubrowPets",
  "MoaPets",
] as const;

function entryItemType(entry: unknown): string {
  if (!entry || typeof entry !== "object") return "";
  const value = (entry as InventoryItemWithType).ItemType;
  return typeof value === "string" ? value : "";
}

function addOwned(owned: Map<string, number>, itemType: string, count: number): void {
  owned.set(itemType, (owned.get(itemType) || 0) + count);
}

/** Owned copies per uniqueName. Pass an inventory that already went through
 *  withoutFoundryPending, so Recipes excludes blueprints the foundry spent. */
export function aggregateComponentOwnership(inventory: unknown): Map<string, number> {
  const owned = new Map<string, number>();
  const slices = (inventory ?? {}) as Record<string, unknown>;

  for (const key of STACKED_COLLECTIONS) {
    const slice = slices[key];
    if (!Array.isArray(slice)) continue;
    for (const entry of slice) {
      const itemType = entryItemType(entry);
      if (!itemType) continue;
      const raw = (entry as InventoryItemWithType).ItemCount;
      const count = typeof raw === "number" && Number.isFinite(raw) ? raw : DEFAULT_OWNED_COUNT;
      addOwned(owned, itemType, count);
    }
  }

  for (const key of BUILT_GEAR_COLLECTIONS) {
    const slice = slices[key];
    if (!Array.isArray(slice)) continue;
    for (const entry of slice) {
      const itemType = entryItemType(entry);
      // One row is one copy here; an ItemCount on built gear is not a stack.
      if (itemType) addOwned(owned, itemType, 1);
    }
  }

  for (const [name, field] of Object.entries(CURRENCY_FIELDS)) {
    const raw = slices[field];
    // A field the payload omits stays absent, so the caller reads unknown rather
    // than a balance of zero.
    if (typeof raw === "number" && Number.isFinite(raw)) {
      owned.set(currencyOwnershipKey(name), raw);
    }
  }

  return owned;
}
