// "Safe to turn in" on the user's real inventory: the real item DB builder over
// the bundled packages, the real masteryHelper, and SyndicatesView's turnIns
// derivation (foundry-adjusted ownership, no pins).
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import * as itemDatabase from "../../../services/itemDatabase";
import * as masteryHelper from "../../../services/masteryHelper";
import { aggregateComponentOwnership } from "../../../config/shared/componentOwnership";
import { withoutFoundryPending } from "../../../config/shared/foundryPending";
import { turnInsBySyndicate, type SyndicateTurnIns } from "../../../src/lib/syndicates/turnIns";
import type { ItemDbEntry, MasteryData, RawInventoryData } from "../../../src/types/inventory";

const CAVIA = "EntratiLabSyndicate";
const HOLDFASTS = "ZarimanSyndicate";
const ENTRATI = "EntratiSyndicate";
const NECRALOID = "NecraloidSyndicate";
const OSTRON = "CetusSyndicate";
const SOLARIS = "SolarisSyndicate";
const HEX = "HexSyndicate";
const QUILLS = "QuillsSyndicate";
const VOX = "VoxSyndicate";
const LAB = "/Lotus/Types/Gameplay/EntratiLab/Resources/";
const ZARIMAN = "/Lotus/Types/Gameplay/Zariman/Resources/";
const DEIMOS = "/Lotus/Types/Items/Deimos/";
const NECRALOID_ITEMS = "/Lotus/Types/Gameplay/InfestedMicroplanet/Resources/Necraloids/";
const CETUS_GEMS = "/Lotus/Types/Items/Gems/Eidolon/";
const CETUS_FISH = "/Lotus/Types/Items/Fish/Eidolon/";
const DEBT = "/Lotus/Types/Items/Solaris/";
const SOLARIS_GEMS = "/Lotus/Types/Items/Gems/Solaris/";
const SOLARIS_FISH = "/Lotus/Types/Items/Fish/Solaris/";
const HEX_ITEMS = "/Lotus/Types/Gameplay/1999Wf/Resources/";
const CORES = "/Lotus/Types/Gameplay/Eidolon/Resources/";
const TOROIDS = "/Lotus/Types/Gameplay/Venus/Resources/";
const NARMER = "/Lotus/Types/Items/MiscItems/NarmerBountyResource";

let itemDb: Record<string, ItemDbEntry>;

beforeAll(() => {
  itemDatabase.buildDatabase();
  itemDb = itemDatabase.getRendererLookup() as unknown as Record<string, ItemDbEntry>;
});

/** SyndicatesView.svelte's turnIns derivation. */
function turnIns(raw: RawInventoryData): Map<string, SyndicateTurnIns> {
  const usable = withoutFoundryPending(
    raw as { Recipes?: unknown; PendingRecipes?: unknown },
    (uniqueName) => itemDb[uniqueName]?.reusableBlueprint === true,
  );
  const mastery = masteryHelper.computeMasteryProgress(raw) as unknown as MasteryData;
  return turnInsBySyndicate({
    itemDb,
    inventory: raw,
    mastery,
    owned: aggregateComponentOwnership(usable),
    pinned: new Map(),
  });
}

describe("the user's real inventory", () => {
  // Captured by scripts/safe-to-sell/capture-turn-in-slice.mjs from
  // %APPDATA%/wfhelper/api-helper/inventory.json on 2026-10-31.
  const fixture = path.join(__dirname, "../../fixtures/safe-to-sell/syndicate-turn-in-slice.json");
  const userInventory = (): RawInventoryData => JSON.parse(fs.readFileSync(fixture, "utf-8"));

  // Player-correct answer: held minus what unbuilt, unmastered gear still
  // consumes. Both syndicates are at max rank, so no rank-up sacrifice remains.
  const EXPECTED: Array<[string, string, string, number, number]> = [
    // Ekhein mastered.
    ["Shrill Voca", CAVIA, `${LAB}EntratiLabDogTagCommon`, 60, 60],
    // Ruvox 2 blades x10, Dante neuroptics 4 x2 copies (master + feed), Riot-848 stock 2.
    ["Bellow Voca", CAVIA, `${LAB}EntratiLabDogTagUncommon`, 78, 48],
    // Ruvox 2 gloves x4, Mandonel 2.
    ["Echo Voca", CAVIA, `${LAB}EntratiLabDogTagRare`, 57, 47],
    ["Voidplume Down", HOLDFASTS, `${ZARIMAN}ZarimanDogTagCommon`, 56, 56],
    ["Voidplume Vane", HOLDFASTS, `${ZARIMAN}ZarimanDogTagUncommon`, 36, 36],
    // Held for Yonta Quill trades: Quill short 24.
    ["Voidplume Crest", HOLDFASTS, `${ZARIMAN}ZarimanDogTagRare`, 7, 0],
    // Phenmor 20, Hespar 20, Aeolak 15, Styanax systems 15 (one copy to feed): 70 > 46 held.
    ["Voidplume Quill", HOLDFASTS, `${ZARIMAN}ZarimanDogTagBounty`, 46, 0],
    // Phenmor 15 > 4 held.
    ["Voidplume Pinion", HOLDFASTS, `${ZARIMAN}VoidAngelItem`, 4, 0],

    // Every other syndicate is at max rank too. Zaws, Kitguns, Amps, MOAs,
    // Hounds, Predasites and Vulpaphylas award mastery only once gilded, so
    // each unmastered piece owes its gild plus the cheapest companion parts.
    ["Mother Token", ENTRATI, `${DEIMOS}EntratiFragmentUncommonB`, 56, 56],
    // Sporelacer and Vermisplicer gild 25 each: 50 > 24.
    ["Father Token", ENTRATI, `${DEIMOS}EntratiFragmentUncommonA`, 24, 0],
    ["Daughter Token", ENTRATI, `${DEIMOS}EntratiFragmentCommonC`, 12, 12],
    // Vizier, Pharaoh, Medjay Predasite and Sly, Crescent Vulpaphyla gild 10 each: 50 > 11.
    ["Son Token", ENTRATI, `${DEIMOS}EntratiFragmentCommonB`, 11, 0],
    ["Otak Token", ENTRATI, `${DEIMOS}EntratiFragmentCommonA`, 14, 14],
    // Grandmother sells Seriglass Shard at 10: Quassus, Sepulcrum, Trumna 3 shards, none held: 30 > 15.
    ["Grandmother Token", ENTRATI, `${DEIMOS}EntratiFragmentRareA`, 15, 0],
    ["Orokin Animus Matrix", NECRALOID, `${NECRALOID_ITEMS}NecraloidStandingRareItem`, 9, 9],

    // Raw gems refine 1:1 in batches; held refined gems net out first.
    // Tear: Koumei systems x2 copies 20, Amanata handle, Ooltha, Sepfahn, Plague Kripath 10 each, Raplak 10, Rahn 20.
    ["Azurite", OSTRON, `${CETUS_GEMS}CommonGemAItem`, 208, 118],
    // Esher 220 - 5 held: Gara systems x2 50, Xaku 40 (Prime owned: one copy), Koumei chassis x2 20, Korrudo/Rahn/Shwaak 15, eight more at 10.
    ["Devar", OSTRON, `${CETUS_GEMS}CommonGemBItem`, 155, 0],
    // Marquise 72 -> 80: Trumna 15, Vulcax/Shwaak/Granmu 10, four strikes 27.
    ["Veridos", OSTRON, `${CETUS_GEMS}UncommonGemAItem`, 285, 205],
    // Star 94 - 4 held: Ramflare loader x6 (one per kitgun) 60, Helstrum 10,
    // Styanax chassis 20 (feed copy), Gauss chassis x2 12, Bonewidow, Granmu 6, Wrath blade x2 at 3: 120 > 60.
    ["Crimzian", OSTRON, `${CETUS_GEMS}RareGemAItem`, 60, 0],
    // Radian 13 - 1 held -> 12: Gauss chassis x2 6, Styanax systems 5 (feed copy), Dorma Hound 2.
    ["Sentirum", OSTRON, `${CETUS_GEMS}EidolonGemAItem`, 33, 21],
    // Heart 6 - 2 held -> 6: Gauss chassis x2.
    ["Nyth", OSTRON, `${CETUS_GEMS}EidolonGemBItem`, 53, 47],
    // Fish Oil short 273 (Kroostra grip x11 at 50, Grendel x2 200 vs 477), Meat short 23: keep every fish.
    ["Murkray (Small)", OSTRON, `${CETUS_FISH}BothRareFishAItem`, 2, 0],
    ["Murkray (Medium)", OSTRON, `${CETUS_FISH}BothRareFishAItemMedium`, 1, 0],
    ["Sharrac (Small)", OSTRON, `${CETUS_FISH}BothUncommonFishAItem`, 1, 0],
    ["Karkina (Small)", OSTRON, `${CETUS_FISH}BothUncommonFishBItem`, 1, 0],
    ["Tralok (Medium)", OSTRON, `${CETUS_FISH}DayUncommonFishAItemMedium`, 1, 0],
    ["Tralok (Large)", OSTRON, `${CETUS_FISH}DayUncommonFishAItemLarge`, 1, 0],

    // MOA (4) and Hound (3) models gild 10 each: 70 > 35.
    ["Training Debt-Bond", SOLARIS, `${DEBT}DebtTokenA`, 35, 0],
    // Catchmoon, Gaze, Rattleguts, Tombfinger gild 10 each.
    ["Shelter Debt-Bond", SOLARIS, `${DEBT}DebtTokenB`, 67, 27],
    ["Medical Debt-Bond", SOLARIS, `${DEBT}DebtTokenC`, 62, 62],
    ["Advances Debt-Bond", SOLARIS, `${DEBT}DebtTokenD`, 51, 51],
    ["Familial Debt-Bond", SOLARIS, `${DEBT}DebtTokenE`, 22, 22],
    // Smooth 145 -> 150: Thugs jet x5 (one per K-Drive deck) 125, Tazicor, Para Moa 10.
    ["Phasmin", SOLARIS, `${SOLARIS_GEMS}SolarisCommonGemAItem`, 172, 22],
    // Heart 45 - 3 held -> 50: Battacor 25, Cryotra, Lambeo Moa.
    ["Noctrul", SOLARIS, `${SOLARIS_GEMS}SolarisCommonGemBItem`, 100, 50],
    // Tears 70 - 9 held -> 70: Oxylus, Bonewidow casing 15, Vulcax, Kompressa barrel, Nychus, Oloro 10.
    ["Goblite", SOLARIS, `${SOLARIS_GEMS}SolarisUncommonGemAItem`, 281, 211],
    // Star 153 -> 156: Ramflare x6 60, Lehan core + Atheca gyro x4 40, Kreska 25,
    // Helstrum 10, Garuda neuroptics x2 12, Verdilac, Kompressa receiver 6: 162 > 124.
    ["Amarast", SOLARIS, `${SOLARIS_GEMS}SolarisRareGemAItem`, 124, 0],
    // Radiant 32 - 1 held -> 33: Baruuk systems x2 10, Korumm 6, Garuda/Gauss x2 6 each, Cantic, Lega 3.
    ["Zodian", SOLARIS, `${SOLARIS_GEMS}SolarisEidolonGemAItem`, 51, 18],
    // Marquise 44 - 8 held -> 36: Suo brace x6 18, Baruuk chassis x2 10,
    // Garuda/Gauss systems x2 6 each, Bhaira 2: 36 > 29.
    ["Thyst", SOLARIS, `${SOLARIS_GEMS}SolarisEidolonGemBItem`, 29, 0],
    // Entroplasma short 36 (Battacor 20, Atheca gyro x4 20, Baruuk x2 20, Nepheri 6, Vulcax 5 vs 35 held): keep all 4.
    ["Tromyzon (Basic)", SOLARIS, `${SOLARIS_FISH}OrokinCoolRareFishAItem`, 3, 0],
    ["Tromyzon (Magnificent)", SOLARIS, `${SOLARIS_FISH}OrokinCoolRareFishALargeItem`, 1, 0],
    ["Tink (Basic)", SOLARIS, `${SOLARIS_FISH}SolarisCoolCommonFishAItem`, 3, 3],
    ["Recaster (Basic)", SOLARIS, `${SOLARIS_FISH}SolarisCoolUncommonFishAItem`, 2, 2],
    ["Recaster (Adorned)", SOLARIS, `${SOLARIS_FISH}SolarisCoolUncommonFishAMediumItem`, 1, 1],
    ["Recaster (Magnificent)", SOLARIS, `${SOLARIS_FISH}SolarisCoolUncommonFishALargeItem`, 1, 1],

    ["Big Bytes Pizza", HEX, `${HEX_ITEMS}HexDogTagRare`, 39, 39],
    ["Argon Burger Meal", HEX, `${HEX_ITEMS}HexDogTagUncommon`, 29, 29],
    ["35mm Film", HEX, `${HEX_ITEMS}HexDogTagQuincy`, 31, 31],
    ["Cheddar Crowns Cereal", HEX, `${HEX_ITEMS}HexDogTagLettie`, 39, 39],
    ["Mood Crystal", HEX, `${HEX_ITEMS}HexDogTagEleanor`, 38, 38],
    ["Chuggin' Along Sixpack", HEX, `${HEX_ITEMS}HexDogTagArthur`, 39, 39],
    ["On-lyne CD", HEX, `${HEX_ITEMS}HexDogTagAoi`, 27, 27],
    ["The Countessa Comic", HEX, `${HEX_ITEMS}HexDogTagAmir`, 36, 36],

    // Verdilac 10.
    ["Intact Sentient Core", QUILLS, `${CORES}QuillsDogTag`, 748, 738],
    // Venato 5.
    ["Exceptional Sentient Core", QUILLS, `${CORES}QuillsUncommonDogTag`, 117, 112],
    ["Flawless Sentient Core", QUILLS, `${CORES}QuillsRareDogTag`, 88, 88],
    // Caliban feed copy 40, Korumm 16, Venato 16, Verdilac 12, Nepheri 10: 94 > 10 held.
    ["Narmer Isoplast (Quills)", QUILLS, NARMER, 10, 0],

    // Baruuk chassis x2 6, Garuda neuroptics x2 4, Cantic and Lega Prism 3 each: 16 > 13.
    ["Vega Toroid", VOX, `${TOROIDS}ArachnoidMicroidItem`, 13, 0],
    // Exard scaffold x6 18, Urga bracket x3 (Hounds) 15, Baruuk systems x2 6, Garuda chassis x2 4: 43 > 17.
    ["Calda Toroid", VOX, `${TOROIDS}ArachnoidHungerItem`, 17, 0],
    // Suo brace x6 18, Baruuk neuroptics x2 6, Garuda systems x2 4: 28 > 10.
    ["Sola Toroid", VOX, `${TOROIDS}ArachnoidWraithItem`, 10, 0],
    ["Narmer Isoplast (Vox)", VOX, NARMER, 10, 0],
    // Larkspur mastered and owned.
    ["Crisma Toroid", VOX, `${TOROIDS}ArachnoidCamperItem`, 10, 10],
    // Hildryn mastered, owned, not subsumed: one copy to feed, 3 parts x2.
    ["Lazulite Toroid", VOX, `${TOROIDS}ArachnoidCamperTerraItem`, 1, 0],
  ];

  let result: Map<string, SyndicateTurnIns>;
  beforeAll(() => {
    result = turnIns(userInventory());
  });

  it.each(EXPECTED)("%s", (name, tag, itemType, held, safe) => {
    const row = result.get(tag)?.rows.find((entry) => entry.itemType === itemType);
    expect(row, `${name} should be a turn-in row`).toBeDefined();
    expect(row?.held, `${name} held`).toBe(held);
    expect(row?.safe, `${name} safe to turn in`).toBe(safe);
  });
});
