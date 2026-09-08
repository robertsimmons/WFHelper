import incarnons from "../../data/suggest/incarnons.json";
import warframes from "../../data/suggest/warframes.json";
import { itemTiers } from "./acquisition/tiers.js";
import { bandWorthAt } from "./worthLadder.js";
import { circuitChoices, resolveCircuitChoices, type CircuitChoice } from "../world.js";
import type { Translator } from "../i18n.js";
import type {
  ChoiceSource,
  ChoiceState,
  LadderGroup,
  SuggestionChoice,
  SuggestionContext,
} from "../../types/suggest.js";

interface WarframeEntry {
  difficulty?: string;
  sources?: { kind?: string; where?: string }[];
}

interface IncarnonEntry {
  grade?: string;
  upgradePath?: string;
}

/** A tier is not a worth. It says where inside a ladder group a pick sits, so
 *  the group the player moves in settings is what moves the Circuit. A suffixed
 *  tier takes its letter's position. */
const TIER_POSITION: Record<string, number> = { S: 0, A: 0.33, B: 0.66, C: 1, D: 1, F: 1 };

/** An unrated pick is unknown, never bad. */
const UNRATED_POSITION = 0.66;

function tierLetter(tier: string | null | undefined): string {
  return tier?.charAt(0).toUpperCase() ?? "";
}

function tierWorth(group: LadderGroup, tier: string | null | undefined): number {
  return bandWorthAt(group, TIER_POSITION[tierLetter(tier)] ?? UNRATED_POSITION);
}

/** A pick the player does not own yet is the gear itself, which is a want. */
const OUTSTANDING: LadderGroup = "want";

/** Nothing left to win, so the week pays nothing; the run is still the player's
 *  to make, so it sinks rather than vanishing. */
const NOTHING_LEFT = bandWorthAt("junk", 1);

const NORMAL_EFFORT = 0.85;
const STEEL_PATH_EFFORT = 0.6;

const INCARNON_SUFFIX = / incarnon genesis$/;

// The tables spell "Ack & Brunt" where the game exports "Ack And Brunt", and
// Steel Path names the adapter rather than the weapon it evolves.
function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*&\s*/g, " and ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(INCARNON_SUFFIX, "");
}

function keyed<T>(table: Record<string, T>): Map<string, T> {
  return new Map(Object.entries(table).map(([name, value]) => [nameKey(name), value]));
}

const INCARNONS = keyed<IncarnonEntry>(incarnons);
const SOURCES = keyed<WarframeEntry>(warframes);

function effortWord(name: string): string | undefined {
  return SOURCES.get(nameKey(name))?.difficulty;
}

function frameValue(name: string): number {
  return tierWorth(OUTSTANDING, itemTiers(name));
}

/** No subsume-tier table ships yet, so every subsume reads as unrated. One
 *  letter back from here is the whole hookup: Overframe rates abilities under
 *  its own category, and `rankings.json` carries those rows with a null name. */
function subsumeTier(_frame: string): string | undefined {
  return undefined;
}

/** Only the Helminth feed is left, which is part of what the frame was worth: a
 *  middling subsume is useful, a top one is still a want. */
function subsumeValue(name: string): number {
  const letter = subsumeTier(name);
  return tierWorth(tierLetter(letter) === "S" ? OUTSTANDING : "useful", letter);
}

function tier(name: string): string | undefined {
  return INCARNONS.get(nameKey(name))?.grade;
}

function upgradePath(name: string): string | undefined {
  return INCARNONS.get(nameKey(name))?.upgradePath;
}

function adapterValue(name: string): number {
  return tierWorth(OUTSTANDING, tier(name));
}

function sources(name: string): ChoiceSource[] {
  return (SOURCES.get(nameKey(name))?.sources ?? []).flatMap((source) =>
    source.kind && source.where ? [{ kind: source.kind, where: source.where }] : [],
  );
}

function display(choice: CircuitChoice): string {
  return choice.displayName || choice.name;
}

/** Owning the frame and feeding it to the Helminth are separate wins. */
function frameState(choice: CircuitChoice): ChoiceState {
  if (choice.subsumed) return "done";
  return choice.inInventory ? "subsume" : "wanted";
}

function frameStateValue(choice: CircuitChoice): number {
  const state = frameState(choice);
  if (state === "done") return 0;
  return state === "subsume" ? subsumeValue(choice.name) : frameValue(choice.name);
}

function best(
  choices: CircuitChoice[],
  value: (choice: CircuitChoice) => number,
): CircuitChoice | null {
  let winner: CircuitChoice | null = null;
  for (const choice of choices) {
    if (!winner || value(choice) > value(winner)) winner = choice;
  }
  return winner;
}

interface CircuitRead {
  choices: SuggestionChoice[];
  value: number;
  effort: number;
  why: string;
}

const CATEGORIES: Record<string, "normal" | "hard"> = {
  circuitNormal: "normal",
  circuitSteelPath: "hard",
};

function normalWhy(pick: CircuitChoice | null, t: Translator): string {
  if (!pick || frameState(pick) === "done") return t("nextUp.whyCircuitAllOwned");
  const frame = display(pick);
  return frameState(pick) === "subsume"
    ? t("nextUp.whyCircuitSubsume", { frame })
    : t("nextUp.whyCircuitFrame", { frame });
}

function readNormal(resolved: CircuitChoice[], t: Translator): CircuitRead {
  const pick = best(resolved, frameStateValue);
  return {
    choices: resolved.map((choice) => ({
      name: display(choice),
      imageUrl: choice.imageUrl,
      kind: "frame",
      state: frameState(choice),
      effort: effortWord(choice.name),
      sources: sources(choice.name),
    })),
    value: Math.max(pick ? frameStateValue(pick) : 0, NOTHING_LEFT),
    effort: NORMAL_EFFORT,
    why: normalWhy(pick, t),
  };
}

/** An adapter is owned or it is not; there is no Helminth step behind it. */
function adapterState(choice: CircuitChoice): ChoiceState {
  return choice.inInventory ? "done" : "wanted";
}

function steelPathWhy(pick: CircuitChoice | null, count: number, t: Translator): string {
  if (!pick) return t("nextUp.whyIncarnonAllOwned");
  const weapon = display(pick);
  const letter = tier(pick.name);
  if (!letter) return t("nextUp.whyIncarnon", { weapon, count: String(count) });
  return t("nextUp.whyIncarnonGraded", { weapon, grade: letter, count: String(count) });
}

function readSteelPath(resolved: CircuitChoice[], t: Translator): CircuitRead {
  const wanted = resolved.filter((choice) => !choice.inInventory);
  const pick = best(wanted, (choice) => adapterValue(choice.name));
  return {
    choices: resolved.map((choice) => ({
      name: display(choice),
      imageUrl: choice.imageUrl,
      kind: "adapter",
      state: adapterState(choice),
      tier: tier(choice.name),
      upgradePath: upgradePath(choice.name),
    })),
    value: Math.max(pick ? adapterValue(pick.name) : 0, NOTHING_LEFT),
    effort: STEEL_PATH_EFFORT,
    why: steelPathWhy(pick, wanted.length, t),
  };
}

/** Null for any task that is not a Circuit, and for a week the game has not named. */
export function readCircuit(ctx: SuggestionContext, taskId: string): CircuitRead | null {
  const category = CATEGORIES[taskId];
  if (!category) return null;
  const resolved = resolveCircuitChoices(
    circuitChoices(ctx.world, category),
    ctx.itemDb,
    ctx.inventory,
  );
  // Before the item DB loads nothing resolves, which would read as a whole week
  // of picks the player is missing.
  if (!resolved.some((choice) => choice.uniqueName)) return null;
  return category === "hard" ? readSteelPath(resolved, ctx.t) : readNormal(resolved, ctx.t);
}
