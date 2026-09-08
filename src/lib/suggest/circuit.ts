import incarnons from "../../data/suggest/incarnons.json";
import warframes from "../../data/suggest/warframes.json";
import { circuitChoices, resolveCircuitChoices, type CircuitChoice } from "../world.js";
import type { Translator } from "../i18n.js";
import type {
  ChoiceSource,
  ChoiceState,
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

const TIER_VALUE_BY_LETTER: Record<string, number> = {
  "S+": 1.0,
  S: 0.92,
  "S-": 0.86,
  "A+": 0.8,
  A: 0.75,
  "A-": 0.7,
  "B+": 0.62,
  B: 0.56,
  "B-": 0.5,
  "C+": 0.42,
  C: 0.36,
  "C-": 0.3,
  F: 0.1,
};

const EFFORT_VALUE: Record<string, number> = { hard: 0.9, normal: 0.7, easy: 0.3 };

// The riven --grade-* tokens run S green through F red, which reads as "S is a
// win" rather than as a tier, so the Circuit letters take their own ramp.
const TIER_CLASS: Record<string, string> = {
  S: "text-[var(--relic-requiem)]",
  A: "text-success",
  B: "text-warning",
  C: "text-danger",
  F: "text-danger",
};

/** Tailwind class for a tier letter; a suffixed tier takes its letter's colour. */
export function tierClass(tier: string | null | undefined): string {
  return TIER_CLASS[tier?.charAt(0).toUpperCase() ?? ""] ?? "text-text-muted";
}

/** An unresearched frame or adapter is unknown, never bad. */
const UNRATED_FRAME_VALUE = 0.7;
const UNRATED_ADAPTER_VALUE = 0.56;

/** The frame is in hand; only the Helminth feed is still outstanding. */
const SUBSUME_ONLY_VALUE = 0.4;

/** Nothing left to win, but the run is still the player's to make. */
const NOTHING_LEFT_VALUE = 0.1;

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
  return EFFORT_VALUE[effortWord(name) ?? ""] ?? UNRATED_FRAME_VALUE;
}

function tier(name: string): string | undefined {
  return INCARNONS.get(nameKey(name))?.grade;
}

function upgradePath(name: string): string | undefined {
  return INCARNONS.get(nameKey(name))?.upgradePath;
}

function adapterValue(name: string): number {
  return TIER_VALUE_BY_LETTER[tier(name) ?? ""] ?? UNRATED_ADAPTER_VALUE;
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
  return state === "subsume" ? SUBSUME_ONLY_VALUE : frameValue(choice.name);
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
    value: Math.max(pick ? frameStateValue(pick) : 0, NOTHING_LEFT_VALUE),
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
    value: Math.max(pick ? adapterValue(pick.name) : 0, NOTHING_LEFT_VALUE),
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
