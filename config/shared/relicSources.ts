import type { DropKind } from "./dropTypes";

type RelicSourceKind = "mission" | "caches" | "bounty" | "quest" | "other";

/** One drop-table row a relic drops from. */
export interface RelicSource {
  /** "Hydron (Sedna)", "Level 15 - 25 Plague Star"; rotation, stage and the
   *  Railjack "(Caches)" tag are split off. */
  place: string;
  kind: RelicSourceKind;
  /** The node's mission type; null when the place is no star-chart node. */
  missionType: string | null;
  rotation: string | null;
  /** A bounty stage as the table states it: "Stage 4 of 5", "Final Stage". */
  stage: string | null;
  /** The refinement the row pays out at, when it is not Intact: "Radiant". */
  refinement: string | null;
  chance: number;
}

export interface RelicSourceRow {
  place: string;
  chance: number;
  kind: DropKind;
  gameMode: string | null;
  refinement: string | null;
}

const ROTATION = /^(.+?), Rotation ([A-Z])(?: \((.+)\))?$/;
const CACHES = /\s*\(Caches\)/;

function kindOf(row: RelicSourceRow): RelicSourceKind {
  if (row.kind === "bounty") return "bounty";
  if (row.kind === "quest") return "quest";
  if (row.kind !== "mission") return "other";
  return CACHES.test(row.place) ? "caches" : "mission";
}

export function relicSource(row: RelicSourceRow): RelicSource {
  const match = ROTATION.exec(row.place);
  const kind = kindOf(row);
  const place = (match?.[1] ?? row.place).replace(CACHES, "").trim();
  const onNode = kind === "mission" || kind === "caches";
  return {
    place,
    kind,
    missionType: onNode ? row.gameMode : null,
    rotation: match?.[2] ?? null,
    stage: match?.[3] ?? null,
    refinement: row.refinement,
    chance: row.chance,
  };
}
