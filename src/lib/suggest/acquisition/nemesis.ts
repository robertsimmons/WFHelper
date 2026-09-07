import { PROGENITOR_ELEMENTS, progenitors } from "./progenitors.js";
import type { CuratedNemesis } from "./curated.js";
import type { NemesisProgenitor } from "./progenitors.js";
import type {
  NemesisBonusRange,
  NemesisFamily,
  NemesisPlan,
  PathStep,
  WeaponClass,
} from "./types.js";

const FAMILY_PREFIX: Array<[RegExp, NemesisFamily]> = [
  [/^kuva\s+\S/i, "kuva"],
  [/^tenet\s+\S/i, "tenet"],
  [/^coda\s+\S/i, "coda"],
];

interface FamilyFacts {
  /** What the player hunts, in the words the game uses. */
  hunted: string;
  candidate: string;
  requires: string[];
  /** Null where nothing the app holds says where the candidate is found. */
  spawn: string | null;
  elements: string[];
  bonus: NemesisBonusRange | null;
  /** Coda weapons are bought outright, so no progenitor decides their element. */
  progenitor: boolean;
  /** How the weapon's element is settled, before the bonus clause. */
  element: string;
  /** The meter that reveals the sequence, and the mods that sequence is made of. */
  meter: string;
  sequence: string;
  /** Null where nothing states where the mods come from. */
  modSource: string | null;
}

const PROGENITOR_TEXT = "Kill it with the progenitor Warframe for the element you want";

const FACTS: Record<NemesisFamily, FamilyFacts> = {
  kuva: {
    hunted: "Kuva Lich",
    candidate: "Kuva Larvling",
    requires: ["The War Within"],
    spawn: "Kill a Kuva Larvling on a level 20+ Grineer node - it shows the weapon it will carry",
    elements: PROGENITOR_ELEMENTS,
    bonus: { min: 25, max: 60 },
    progenitor: true,
    element: PROGENITOR_TEXT,
    meter: "Murmur",
    sequence: "Requiem",
    modSource: "Requiem relics",
  },
  tenet: {
    hunted: "Sister of Parvos",
    candidate: "Candidate",
    requires: ["The War Within", "Call of the Tempestarii"],
    spawn: "Kill a Candidate on a level 20+ Corpus node - it shows the weapon it will carry",
    elements: PROGENITOR_ELEMENTS,
    bonus: { min: 25, max: 60 },
    progenitor: true,
    element: PROGENITOR_TEXT,
    meter: "Murmur",
    sequence: "Requiem",
    modSource: "Requiem relics",
  },
  coda: {
    hunted: "Coda",
    candidate: "candidate",
    requires: ["The Hex"],
    spawn: null,
    elements: [],
    bonus: { min: 25, max: 60 },
    progenitor: false,
    element:
      "Buy the weapon from Eleanor at Höllvania Central Mall for 10 Live Heartcells - her stock " +
      "carries whatever element the rotation currently has, and it re-rolls every 4 days",
    meter: "Malware Disinfection",
    sequence: "Antivirus",
    modSource: null,
  },
};

/** Tenet melee is bought from Ergo Glast; only the guns come off a Sister. */
function carriedByNemesis(family: NemesisFamily, weapon: WeaponClass): boolean {
  return !(family === "tenet" && weapon === "melee");
}

/** The name prefix is the whole signal: the item DB has no nemesis flag. */
function nemesisFamily(name: string): NemesisFamily | null {
  for (const [pattern, family] of FAMILY_PREFIX) {
    if (pattern.test(name)) return family;
  }
  return null;
}

/** Null for a weapon no nemesis carries. Curated data wins over the built-in
 *  facts field by field, so a family the app knows nothing about still resolves. */
export function nemesisPlan(
  name: string,
  weapon: WeaponClass,
  supplied: CuratedNemesis | null,
  table: NemesisProgenitor[] = progenitors,
): NemesisPlan | null {
  const family = supplied?.family ?? nemesisFamily(name);
  if (!family) return null;
  if (!supplied && !carriedByNemesis(family, weapon)) return null;
  const facts = FACTS[family];
  return {
    family,
    requires: supplied?.requires.length ? supplied.requires : facts.requires,
    spawn: supplied?.spawn ?? facts.spawn,
    elements: supplied?.elements.length ? supplied.elements : facts.elements,
    progenitors: facts.progenitor ? table : [],
    bonus: supplied?.bonus ?? facts.bonus,
    valenceFusion: true,
  };
}

function bonusText(plan: NemesisPlan): string {
  const range = plan.bonus ? `a ${plan.bonus.min}-${plan.bonus.max}% roll` : "a roll";
  return `the bonus itself is ${range}`;
}

function elementText(plan: NemesisPlan): string {
  const list = plan.elements.length ? ` (${plan.elements.join(", ")})` : "";
  return `${FACTS[plan.family].element}${list} - ${bonusText(plan)}`;
}

/** The steps of one nemesis run, in the order the player walks them. A step the
 *  app cannot state is left out rather than guessed at. */
export function nemesisSteps(plan: NemesisPlan): PathStep[] {
  const facts = FACTS[plan.family];
  const steps: PathStep[] = [];
  const step = (where: string): void => {
    steps.push({ kind: "nemesis", where, parts: [] });
  };
  if (plan.requires.length) step(`Requires ${plan.requires.join(" and ")}`);
  if (plan.spawn) step(plan.spawn);
  step(elementText(plan));
  step(
    `Run the ${facts.hunted}'s territory and kill its thralls - each filled ${facts.meter} bar reveals one ${facts.sequence} of the three-mod sequence`,
  );
  if (facts.modSource) step(`${facts.sequence} mods drop from ${facts.modSource}`);
  step(
    `Parazon the ${facts.hunted} with the right ${facts.sequence} order - killing it hands the weapon over, converting it does not`,
  );
  if (plan.valenceFusion) {
    step("A second kill of the same weapon raises the bonus by valence fusion");
  }
  return steps;
}

/** A Tenet melee is not carried by a Sister, but the system still gates it. */
export function ergoGlastSource(name: string, weapon: WeaponClass): string | null {
  return nemesisFamily(name) === "tenet" && weapon === "melee"
    ? "Ergo Glast, any Relay - sold outright once Sisters of Parvos is open to you; the element and bonus are whatever the stock currently carries"
    : null;
}
