/** Founders-pack exclusives: masterable, but no longer obtainable by anyone. */
const UNOBTAINABLE_ITEMS: ReadonlyMap<string, string> = new Map([
  ["/Lotus/Powersuits/Excalibur/ExcaliburPrime", "Excalibur Prime"],
  ["/Lotus/Weapons/Tenno/Pistol/LatoPrime", "Lato Prime"],
  ["/Lotus/Weapons/Tenno/Melee/LongSword/SkanaPrime", "Skana Prime"],
]);

const UNOBTAINABLE_NAMES: ReadonlySet<string> = new Set(UNOBTAINABLE_ITEMS.values());

/** Matches on either identifier, so rows that carry only an English name still land. */
export function isUnobtainableItem(item: {
  uniqueName?: string | null | undefined;
  name?: string | null | undefined;
}): boolean {
  return (
    (item.uniqueName != null && UNOBTAINABLE_ITEMS.has(item.uniqueName)) ||
    (item.name != null && UNOBTAINABLE_NAMES.has(item.name))
  );
}
