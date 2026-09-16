import type { CycleData, WorldState } from "../../../../types/world.js";
import type { PlanGroup } from "./schema.js";
import type { ResolvedLive } from "./types.js";

/** Duviri runs the five moods in this order, two hours each, so the wait for a
 *  mood a group needs is a walk from the current one rather than a guess. */
const DUVIRI_MOODS = ["joy", "anger", "envy", "sorrow", "fear"] as const;
const DUVIRI_WINDOW_MS = 2 * 60 * 60 * 1000;

type CycleName = "duviri" | "vallis" | "cetus" | "cambion" | "earth";

const PHASE_CYCLES: Record<string, CycleName> = {
  joy: "duviri",
  anger: "duviri",
  envy: "duviri",
  sorrow: "duviri",
  fear: "duviri",
  warm: "vallis",
  cold: "vallis",
  fass: "cambion",
  vome: "cambion",
  day: "cetus",
  night: "cetus",
};

/** Where a location's whole window is wider than the phase the authored text
 *  happens to name. Only locations the plan data itself states belong here. */
const MAP_WINDOWS: Record<string, string[]> = {
  "kullervos-hold": ["anger", "sorrow", "fear"],
  archarbor: ["joy", "envy", "sorrow"],
};

function formatGap(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const days = Math.floor(total / 86400);
  if (days >= 1) return `${days}d`;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours >= 1) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)}m`;
}

function titleCase(phase: string): string {
  return phase.charAt(0).toUpperCase() + phase.slice(1);
}

function expiryOf(cycle: CycleData | undefined, now: number): number | null {
  const raw = cycle?.expiry;
  if (typeof raw !== "string") return null;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) || parsed <= now ? null : parsed;
}

function currentPhase(cycle: CycleName, world: WorldState): string | null {
  if (cycle === "duviri") {
    const state = world.duviriCycle?.state;
    return typeof state === "string" && state !== "" ? state.toLowerCase() : null;
  }
  if (cycle === "vallis") {
    const warm = world.vallisCycle?.isWarm;
    return typeof warm === "boolean" ? (warm ? "warm" : "cold") : null;
  }
  if (cycle === "cambion") {
    const active = world.cambionCycle?.active;
    return typeof active === "string" && active !== "" ? active.toLowerCase() : null;
  }
  const day = cycle === "cetus" ? world.cetusCycle?.isDay : world.earthCycle?.isDay;
  return typeof day === "boolean" ? (day ? "day" : "night") : null;
}

function cycleData(cycle: CycleName, world: WorldState): CycleData | undefined {
  if (cycle === "duviri") return world.duviriCycle as CycleData | undefined;
  if (cycle === "vallis") return world.vallisCycle;
  if (cycle === "cambion") return world.cambionCycle;
  return cycle === "cetus" ? world.cetusCycle : world.earthCycle;
}

function phasesIn(text: string): string[] {
  const found: string[] = [];
  for (const phase of Object.keys(PHASE_CYCLES)) {
    if (new RegExp(`\\b${phase}\\b`, "i").test(text)) found.push(phase);
  }
  return found;
}

interface PhaseWindow {
  cycle: CycleName;
  phases: string[];
}

/** The phases a group can be run in. A mapped location states its whole window;
 *  anything else is read off the phase the authored live text leads with. */
function windowFor(group: PlanGroup): PhaseWindow | null {
  const mapped = group.map ? MAP_WINDOWS[group.map] : undefined;
  if (mapped && mapped.length > 0) {
    const cycle = PHASE_CYCLES[mapped[0]];
    if (cycle) return { cycle, phases: mapped };
  }
  const named = phasesIn(group.live?.text ?? "");
  if (named.length === 0) return null;
  const cycle = PHASE_CYCLES[named[0]];
  return cycle ? { cycle, phases: [named[0]] } : null;
}

/** Milliseconds until the first phase in `phases` comes round again. Two-phase
 *  cycles flip at the current expiry; Duviri walks its fixed mood order. */
function opensIn(gate: PhaseWindow, current: string, endsAt: number, now: number): number | null {
  const left = endsAt - now;
  if (gate.cycle !== "duviri") return gate.phases.length > 0 ? left : null;

  const index = DUVIRI_MOODS.indexOf(current as (typeof DUVIRI_MOODS)[number]);
  if (index < 0) return null;
  for (let step = 1; step <= DUVIRI_MOODS.length; step += 1) {
    const mood = DUVIRI_MOODS[(index + step) % DUVIRI_MOODS.length];
    if (gate.phases.includes(mood)) return left + (step - 1) * DUVIRI_WINDOW_MS;
  }
  return null;
}

function nextPhase(gate: PhaseWindow, current: string): string {
  if (gate.cycle !== "duviri") return gate.phases[0];
  const index = DUVIRI_MOODS.indexOf(current as (typeof DUVIRI_MOODS)[number]);
  if (index < 0) return gate.phases[0];
  for (let step = 1; step <= DUVIRI_MOODS.length; step += 1) {
    const mood = DUVIRI_MOODS[(index + step) % DUVIRI_MOODS.length];
    if (gate.phases.includes(mood)) return mood;
  }
  return gate.phases[0];
}

/** One world-state value splits groups in opposite directions, so every group
 *  resolves against it on its own. Null world data keeps the authored text. */
export function resolveCycleLive(
  group: PlanGroup,
  world: WorldState | null | undefined,
  now: number,
): ResolvedLive | null {
  const authored = group.live;
  if (!authored) return null;
  const fallback: ResolvedLive = { state: authored.state, text: authored.text, resolved: false };
  if (!world) return fallback;

  const gate = windowFor(group);
  if (!gate) return fallback;

  const current = currentPhase(gate.cycle, world);
  const endsAt = expiryOf(cycleData(gate.cycle, world), now);
  if (!current || endsAt === null) return fallback;

  if (gate.phases.includes(current)) {
    return {
      state: "open",
      text: `${titleCase(current)} now, ${formatGap(endsAt - now)} left`,
      resolved: true,
    };
  }

  const gap = opensIn(gate, current, endsAt, now);
  if (gap === null) return fallback;
  return {
    state: "blocked",
    text: `${titleCase(nextPhase(gate, current))} in ${formatGap(gap)}`,
    resolved: true,
  };
}

export { formatGap };
