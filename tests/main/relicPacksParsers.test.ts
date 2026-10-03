import { describe, expect, it } from "vitest";

// @ts-expect-error -- plain build script module, no type declarations
import * as relicPacks from "../../scripts/suggest/relicPacks.mjs";

const { buildRelicPacks, parseRelicPackRules } = relicPacks;

const VOID = `local p = {}
function p.Other()
	local RarityMap = { Requiem = 'Rare' }
end

function p.RelicPack()
	local Aya = Tooltips.full('Aya', 'Resources')
	local RarityMap = { Lith = 'Common', Meso = 'Common', Neo = 'Uncommon', Axi = "Rare" }
	local EmpyreanDerelictRelics = {
		["Lith C7"] = true, ["Axi S8"] = true
	}
	for name, relic in Table.skpairs(RelicData) do
		if not relic.Vaulted and not relic.IsBaro and not EmpyreanDerelictRelics[name] and RarityMap[relic.Tier] ~= nil then
			TierCount[relic.Tier] = TierCount[relic.Tier] + 1
		end
	end
end

return p`;

const VOID_DATA = `local Table = require('Module:Table')

local RelicData = {}

RelicData = {
	["Axi A1"] = { Drops = {}, Name = "Axi A1", Tier = "Axi", Vaulted = "21.6" },
	["Axi A10"] = { Drops = {}, Name = "Axi A10", Tier = "Axi" },
	["Axi A2"] = { Drops = {}, Name = "Axi A2", Tier = "Axi" },
	["Axi M5"] = { Drops = {}, Name = "Axi M5", Tier = "Axi", IsBaro = true },
	["Axi S8"] = { Drops = {}, Name = "Axi S8", Tier = "Axi" },
	["Lith C7"] = { Drops = {}, Name = "Lith C7", Tier = "Lith" },
	["Lith G1"] = { Drops = {}, Name = "Lith G1", Tier = "Lith" },
	["Requiem I"] = { Drops = {}, Name = "Requiem I", Tier = "Requiem" },
	["Vanguard C1"] = { Drops = {}, Name = "Vanguard C1", Tier = "Vanguard" },
}

return { RelicData = RelicData }`;

describe("relic pack pool", () => {
  it("reads the tiers and exclusions out of p.RelicPack, not another function", () => {
    expect(parseRelicPackRules(VOID)).toEqual({
      tiers: ["Axi", "Lith", "Meso", "Neo"],
      excluded: ["Axi S8", "Lith C7"],
    });
  });

  it("keeps unvaulted relics of the four tiers, minus Baro and derelict ones", () => {
    expect(buildRelicPacks(VOID, VOID_DATA)).toEqual({ pool: ["Lith G1", "Axi A2", "Axi A10"] });
  });

  it("throws when p.RelicPack's filter no longer reads as expected", () => {
    const changed = VOID.replace("not relic.IsBaro and ", "");
    expect(() => buildRelicPacks(changed, VOID_DATA)).toThrow(/filter changed/);
  });

  it("throws when the module has no RelicPack", () => {
    expect(() => parseRelicPackRules("return {}")).toThrow(/p.RelicPack/);
  });
});
