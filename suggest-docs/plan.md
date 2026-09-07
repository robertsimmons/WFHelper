# Next Up — plan

Vision: `overall-epic-plan.md`. Tab name not locked.

## Spine

A suggestion engine in `src/lib/suggest/`. Every slice below plugs into it; adding a domain is adding a provider file, never touching the tab.

- **Provider** — `collect(ctx) => Suggestion[]`, one per domain.
- **Suggestion** — category, one-line title, one-line why, effort and payoff signals, and enough to tick the task off in place.
- **Context** — derived from existing stores (`world`, `data`, `relics`, `mastery`, `pricing`, `preferences`). The engine reads; it never fetches. Any view reading world state mounts it via `mountWorldData`.
- **Scorer** — providers emit raw value / effort / urgency; one normalizer ranks the lot. Weights in prefs, shipped with defaults.
- **Feed** — a scrolling column of collapsible sections, one per category, each ranked within itself. The filter checkboxes show and hide whole sections.
- **Dismissal** — per suggestion, stored against the world fingerprint that produced it, so it returns on its own when that state changes.
- **Curated data** — `src/data/suggest/*.json`: reward values, mission-type opinions, and later farm difficulty, popularity/power tier, incarnon ranking. Keyed by normalized display name. Shipped as defaults the user can override. A missing entry means unknown, never bad.
- **Reasons** — a card says what it pays and what it costs, from world state where it names a reward, curated tiers for how good that is, and inventory for whether it is still needed.

## Slices

Each is shippable alone, in order.

| # | Slice | Notes | Status |
|---|---|---|---|
| 1 | Tab shell + engine + dismissal + dailies/weeklies provider | Reads the existing tracker; cards tick tasks off in place | done |
| 1.5 | Configurable scoring weights | Three weights on a Ranking tab, shipped at the previous fixed values | done |
| 2a | Reward promotion + one ranked list | Reward and mission-type tables; calendar, Teshin and Archon shard drive value and the why line | done |
| 2b | Settings modal | Cog in the header, three tabs. Per-activity never/low/normal, reward tiers, global mission-type opinions; user entries win over shipped defaults | done |
| 2c | Reward art | A tile on the card, `itemDb.imageUrl` joined on the reward's uniqueName or name; it carries the reward name so the why line does not | done |
| 2d | Drop-table reward pools | Sortie, Netracells, Deep and Temporal Archimedea, normal Circuit. A pool labels the card and picks its art; value stays with the curated tables | done |
| 2e | Descendia stages | Dropped | - |
| 2f | Vendor and window presence: Baro, Varzia, Darvo | Pure world state, same provider shape as slice 1 | done |
| 2g | Circuit ranking | SP incarnons ranked best to worst; flags a normal-circuit frame the player needs | done |
| 3 | Relics, goal-driven (plat / ducats / finish X) | Matched to live fissures + mission-type prefs | done |
| 4 | Mastery | Wraps `masteryRoadmap`, adds filters (hide forma-dumps) | done |
| 5 | Acquisition resolver (warframes) | Missing components to ranked paths with concrete steps; normal circuit as a path | done |
| 6 | Weapons on the same resolver | Incl. lich / sister / coda | done |
| 7 | Popularity/power weighting across 5-6 | Tuning layer; needs real usage first | done |
| 8 | Mods: pin a mod with a reason, suggest missing popular ones | New input surface | |
| 9 | Build import to full step plan | Needs 5, 6, 8 | |


## Misc
- mod popularity into a mod database for "go farm this mod". Overframe gives an ordered top-8 per item and no usage counts; the honest derived signal is how many items list a mod. `popularMods.json` holds the lists.
- read the wiki for a brief farm snapshot per mod, the way `weapons.json` does for weapons, so the app answers it without the wiki.
- Deep/Temporal Archimedea should say whether you own the frames and weapons that week wants. Nothing in world state names them; `api.warframestat.us/pc/deepArchimedea` does, which means a new feed.
- Baro stock should flag what is new since his last visit. Needs visit history the app does not keep.
- estimate the time a farm costs, not just its difficulty band.
- narrower cards for relics, acquisition and mastery, which carry item art rather than a banner.
- the acquisition section header wraps on a narrow window; the include checkboxes are the piece to move.
- Bird 3 and Yonta offer little once their permanent stock is excluded. Revisit whether "worth the trip" should include standing rotations.
- Steel Path Incursions are excluded from suggestions; they rotate constantly and read better in game.