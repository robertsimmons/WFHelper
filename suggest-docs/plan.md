# Next Up — plan

Vision: `overall-epic-plan.md`. Tab name not locked.

## Spine

A suggestion engine in `src/lib/suggest/`. Every slice below plugs into it; adding a domain is adding a provider file, never touching the tab.

- **Provider** — `collect(ctx) => Suggestion[]`, one per domain.
- **Suggestion** — category, one-line title, one-line why, effort and payoff signals, and enough to tick the task off in place.
- **Context** — derived from existing stores (`world`, `data`, `relics`, `mastery`, `pricing`, `preferences`). The engine reads; it never fetches. Any view reading world state mounts it via `mountWorldData`.
- **Scorer** — providers emit raw value / effort / urgency; one normalizer ranks the lot. Weights in prefs, shipped with defaults.
- **Feed** — one ranked list. Categories are filter checkboxes, not sections; the list pages rather than truncating.
- **Dismissal** — per suggestion, stored against the world fingerprint that produced it, so it returns on its own when that state changes.
- **Curated data** — `src/data/suggest/*.json`: reward values, mission-type opinions, and later farm difficulty, popularity/power tier, incarnon ranking. Keyed by normalized display name. Shipped as defaults the user can override. A missing entry means unknown, never bad.
- **Reasons** — a card says what it pays and what it costs, from world state where it names a reward, curated tiers for how good that is, and inventory for whether it is still needed.

## Slices

Each is shippable alone, in order.

| # | Slice | Notes | Status |
|---|---|---|---|
| 1 | Tab shell + engine + dismissal + dailies/weeklies provider | Reads the existing tracker; cards tick tasks off in place | done |
| 1.5 | Configurable scoring weights | Parked until the ranking has enough inputs to be worth tuning | |
| 2a | Reward promotion + one ranked list | Reward and mission-type tables; calendar, Teshin and Archon shard drive value and the why line | done |
| 2b | Settings modal | Cog in the header, three tabs. Per-activity never/low/normal, reward tiers, global mission-type opinions; user entries win over shipped defaults | done |
| 2c | Reward art | A tile on the card, `itemDb.imageUrl` joined on the reward's uniqueName or name; it carries the reward name so the why line does not | done |
| 2d | Drop-table reward pools | Sortie, Netracells, Deep and Temporal Archimedea, normal Circuit. A pool labels the card and picks its art; value stays with the curated tables | done |
| 2e | Descendia stages | Parser keeps only the window; needs `challenges[]` and a `DT_*` map normalized into the `MT_*` vocabulary. Value stays the activity preference: no pool names what a run pays | |
| 2f | Vendor and window presence: Baro, Varzia, Darvo | Pure world state, same provider shape as slice 1 | |
| 2g | Circuit ranking | SP incarnons ranked best to worst; flags a normal-circuit frame the player needs | done |
| 3 | Relics, goal-driven (plat / ducats / finish X) | Matched to live fissures + mission-type prefs | |
| 4 | Mastery | Wraps `masteryRoadmap`, adds filters (hide forma-dumps) | |
| 5 | Acquisition resolver (warframes) | Missing components to ranked paths with concrete steps; normal circuit as a path | |
| 6 | Weapons on the same resolver | Incl. lich / sister / coda | |
| 7 | Popularity/power weighting across 5-6 | Tuning layer; needs real usage first | |
| 8 | Mods: pin a mod with a reason, suggest missing popular ones | New input surface | |
| 9 | Build import to full step plan | Needs 5, 6, 8 | |


## Misc
- need to look up per frame how difficult its farm is
- use overframe.gg to rank ALL things (frames, weapons, companions, etc). Save that rank. When we're suggesting what to farm next, difficulty + rank should bother be considered (so a really easy A-tier will likely be ranked higher than a very hard S-tier farm).
- use overframe.gg to get mod popularity. for each "thing" (frame, weapon, companion, etc), click it, and see what the "popular mods for (thing)" list are. store that in some mod-information JSON "database", what we want at the end is something like: { "myMod" : { usageCount: 26 }}. we'll use this to help populate the "go farm this mod".
- we'll then need to look up the farm for all mods. We'll link the wiki as well wherever we show this, but like we do for warframes and weapons, we'll read the wiki to store a very brief snapshot of what to do and what the difficulty is. The goal is to tell the user everything they need in this app, and not need the wiki.
- suggestions should consider if there's any server-wide events that boost affinity. 
- Deep/temporal archimedea should consider if you have the frames/weapons that are needed for that week's (if that info is available, may not be)
- for weapons/frames - we link to the wiki, we should also link to their page on overframe.gg. at some point I want to have "Import build" that takes an overframe.gg and makes a plan or something for you, sees what you're missing, and tells you everything - get this mod, comes from X place, do exactly this or that. if the weapon has a prime and you don't have it, exact steps to get it (including plat price), etc.
- on next up, when clicking detalis, show how much of each known reward the player already has (for stuff like forma, shards, adapters, etc)
- a way to estimate the pain of a farm. maybe research reddit combined with drop tables to come up with ranking / estimate? The value here is determining if something is difficult or not, and the time estimate to know "oh you should REALLY get this one from circuit this week"
- add sortie mission coloring and such the same as archon hunt
- circuit steel path deatils - we can tighten this up a lot. Instead of "nothing left" say "owned".. Grade can just be the letter (maybe color coded? S = purple, a = green, b = yellow, c = red), probably put upgrade path just right after it.