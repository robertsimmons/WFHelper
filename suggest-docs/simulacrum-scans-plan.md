# Simulacrum scans band

A Next Up section that tells the player which star-chart node to run to finish the most codex entries, which unlocks those enemies in the Simulacrum.

## Rules

- **Gap:** an incomplete codex row (`buildCodexRows`) with a known requirement. Eximus rows count. Cost is `required - scanned`.
- **Place:** a planet, or a tileset when the enemy names one (Orb Vallis, Kuva Fortress). A tileset-only enemy counts only toward that tileset's nodes.
- **Regular:** an enemy with only a faction to go on. It counts toward every node that faction holds, but never decides which place wins. It is listed at every stop it spawns at.
- **Railjack:** Railjack enemies get one card per Proxima region, stopping only at Railjack nodes. Railjack nodes never serve other gaps.
- **Card:** one place. It has 1 to 3 numbered node stops picked greedily: the node covering the most remaining place-specific gaps wins (cheapest-to-finish first, then higher node `maxEnemyLevel`), its gaps are removed, repeat.
- **Rank:** easy places come first: normal star-chart nodes you can run with Helios and a scanner. Within that group, the card that finishes the most entries wins, and fewer scans breaks ties. After them, in order: open worlds, archwing, Railjack, bounty-only zones (Deepmines), activities (Narmer bounties, Descendia, Isleweaver, Follie's Hunt, Arbitrations, Archon Hunt), boss and assassination fights, Steel Path, Death Mark, and unplaced last.
- **Mission preference:** inside the normal tier, stops are picked by mission group first, coverage second. Good: exterminate, capture, defense, mobile defense, sabotage, survival, spy. Tough: interception, disruption, rescue. Niche: everything else. Cards rank by what their good-group stops finish.
- **Stop line:** every stop names its node and planet ("Laomedeia, Neptune · Disruption"), since a tileset card spans planets.
- **Progress numbers:** the card shows how many enemies are left. Each stop in the modal shows its enemy and scan counts.
- **Progress notification:** each scan refresh is compared with the last snapshot. When anything changed, the bell gets "Scanning Progress: N enemies completed, M new scans". The first load only sets the baseline. Scans refresh with the app's post-mission data reload.
- **Open worlds:** ranked low until a later wiki pass splits them by map area.
- **Mission gate:** an enemy whose codex entry lists `missions` only counts at nodes of that mission type.
- **Steel Path:** curated Steel Path enemies (Acolytes) form their own card, "any Steel Path mission". No other card points at a Steel Path node.
- **Nothing left out:** every enemy gap appears on some card, or in a details modal. Gaps no node can serve go on a final unplaced card.
- **Other scannables:** non-enemy codex entries belong to the Scannables slice in `plan.md`.
- **Moving on:** completed gaps drop off after the profile refreshes. An empty stop drops, and so does an empty card.

## Data

- `scripts/codex-scans/build-codex-scan-data.mjs` also emits star-chart nodes from `ExportRegions`: name, planet, mission type, faction(s), tileset, min/max enemy level. Railjack nodes are flagged. Hubs, relays, junctions and Conclave are excluded.
- Descendia and Narmer bounties are activity cards: a place plus the activity to start there.
- Per-enemy level gates are not in DE's data and are ignored.

## Files

- `src/lib/suggest/simulacrum.ts`: the pure engine `(codexRows, requirements, nodes) => SimulacrumCard[]`.
- `tests/renderer/lib/suggest/simulacrum.test.ts`: specs.
- Card UI, section wiring, i18n: after a scratch HTML prototype on real profile data.

## Card layout

```
┌ Jupiter ──────────────┐
│ 1 Io · Defense        │
│   [Osprey 1/3] [Hyena…]│
│ 2 Ganymede · Disrupt. │
│   [Amalgam… EX] +1    │
│ +9 Corpus        ▸    │
└───────────────────────┘
```

Click opens a modal with every enemy as a tile and the other valid nodes per stop.
