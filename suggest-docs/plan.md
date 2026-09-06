# Next Up — plan

Vision: `overall-epic-plan.md`. Tab name not locked.

## Spine

A suggestion engine in `src/lib/suggest/`. Every slice below plugs into it; adding a domain is adding a provider file, never touching the tab.

- **Provider** — `collect(ctx) => Suggestion[]`, one per domain.
- **Suggestion** — category, one-line title, one-line why, effort, payoff signals, and an action (jump to an existing view/modal, or an expandable step list).
- **Context** — derived from existing stores (`world`, `data`, `relics`, `mastery`, `pricing`, `preferences`). The engine reads; it never fetches.
- **Scorer** — providers emit raw value / effort / urgency; one normalizer ranks across categories. Weights in prefs, shipped with defaults.
- **Dismissal** — a dismissal is stored against the world fingerprint that produced it, so it returns on its own when that state changes. Plus a show-everything toggle.
- **Curated data** — `src/data/suggest/*.json`: farm difficulty, popularity/power tier, incarnon ranking, reward values. A missing entry means unknown, never bad.

## Slices

Each is shippable alone, in order.

| # | Slice | Notes |
|---|---|---|
| 1 | Tab shell + engine + dismissal + dailies/weeklies provider | Reads the existing tracker |
| 2 | Expiring windows: Baro, sortie/archon, circuit rotation, calendar, arbi | Adds urgency scoring, reward-value table, SP-circuit incarnon ranking |
| 3 | Relics, goal-driven (plat / ducats / finish X) | Matched to live fissures + mission-type prefs |
| 4 | Mastery | Wraps `masteryRoadmap`, adds filters (hide forma-dumps) |
| 5 | Acquisition resolver (warframes) | Missing components to ranked paths with concrete steps; normal circuit as a path |
| 6 | Weapons on the same resolver | Incl. lich / sister / coda |
| 7 | Popularity/power weighting across 5-6 | Tuning layer; needs real usage first |
| 8 | Mods: pin a mod with a reason, suggest missing popular ones | New input surface |
| 9 | Build import to full step plan | Needs 5, 6, 8 |
