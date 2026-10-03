# Next Up — plan

Vision: `overall-epic-plan.md`. Tab name not locked.

THIS FILE: The main goal of this file is "What should we do next". It is NOT a history log.
- Top has some very terse overall instructions / information.
- Slices / and Misc are "to do" work.
- When something is noted that we want to do later, it should be added as a slice or misc note.
- Once something is done, we should remove it.

## Spine

A suggestion engine in `src/lib/suggest/`. Every slice below plugs into it; adding a domain is adding a provider file, never touching the tab.

- **Provider** — `collect(ctx) => Suggestion[]`, one per domain.
- **Suggestion** — category, one-line title, one-line why, effort and payoff signals, and enough to tick the task off in place.
- **Context** — derived from existing stores (`world`, `data`, `relics`, `mastery`, `pricing`, `preferences`). The engine reads; it never fetches. Any view reading world state mounts it via `mountWorldData`.
- **Scorer** — providers emit worth / gain / effort / urgency; one normalizer orders the lot. Weights in prefs, shipped with defaults.
- **Feed** — a scrolling column of collapsible sections, one per category, each ranked within itself. The filter checkboxes show and hide whole sections.
- **Dismissal** — per suggestion, stored against the world fingerprint that produced it, so it returns on its own when that state changes.
- **Curated data** — `src/data/suggest/*.json`: reward values, mission-type opinions, and later farm difficulty, popularity/power tier, incarnon ranking. Keyed by normalized display name. Shipped as defaults the user can override. A missing entry means unknown, never bad.
- **Shared store**: `acquisitionPlans/resources.json` holds the one route and tips for every material, currency and standing. A plan lists what it needs in `materials` or points at it with `ref`; only its blueprint source, part drops, boss and recipe live on the item. The validator rejects a farm route for a store thing written on an item.
- **Reasons** — a card says what it pays and what it costs, from world state where it names a reward, curated tiers for how good that is, and inventory for whether it is still needed.

## Vocabulary

One word per concept. `rank` is not one of them, in code or in the UI.

| Word | Means | Source | In the UI |
|---|---|---|---|
| **tier** | how good the item itself is — `S A B C D` | Overframe table, plus the curated incarnon table | The only letter that ever renders |
| **worth** | how much the player wants a reward | the worth ladder; shipped defaults, user-editable | Never |
| **gain** | how much this particular offer advances this player, `0..1` | computed from inventory | Never as a number |
| **effort** | how painful the thing is to do or farm | shipped defaults, user-editable | Never |
| **urgency** | time left in the window | world state | As a time-left pill |
| **score** | `worth × gain`, against effort and urgency at their weights | derived | Never |

Every place an item name renders, it renders through `ItemTile`, which always draws the tier. A name drawn outside `ItemTile` is a bug.

## Worth ladder

One ordered list of reward entries. An entry is an item, a currency or a standing — anything a suggestion can pay.

- Groups, best first: **Must-have, Want, Useful, Filler, Junk**, and **Unplaced**.
- A group owns a numeric band; an entry's position inside its group interpolates within that band. Moving groups jumps the worth, reordering nudges it. No numbers are typed.
- Quantity scales inside the entry, so `3x Forma` beats `1x Forma` without a second entry.
- A resolved reward that is not on the ladder lands in **Unplaced** at zero worth, and settings shows the count. Nothing scores off a category default, so a coverage gap is visible rather than becoming a middling score. A caller naming a group for an entry the ladder does not place gets Unplaced too, not that group's floor.
- An entry the player moves to another group lands at the foot of its new band until they drag it.

## Gain

Worth is what a reward is; gain is whether this player still needs it. A mastered weapon, an owned frame and a capped valence weapon all resolve to zero gain and drop out.

Valence weapons — Coda and Tenet — turn on whether a purchase makes the cap reachable, which needs `max(owned, offered) >= 52.8`. Currency is farmed, so a purchase that does not reach cap is not worth making.

| Owned | Offered | gain |
|---|---|---|
| >= 58 | any | 0, drops out |
| 52.8 - 58 | any | 0.5 |
| < 52.8 | >= 52.8 | 1.0 |
| none | >= 52.8 | 0.8 |
| either | < 52.8 | 0.1 |

The vendor's card picks its best offer by gain, not by the highest percentage, and still shows at zero worth when nothing on offer helps.

## Ordering

Worth leads. Time only ever decides a cutoff, never the headline: a low-worth thing about to expire is still a low-worth thing.

Bands, best first. Within every band, order by worth, then by gain, then by time left.

Worth alone bands a suggestion. Gain filters — zero gain is gone — and breaks ties inside a band; it never demotes one, so a half-gain offer of a must-have is still a must-have.

Effort does not order anything. It is collected and stored, and it reads nowhere. Most of it was invented — vendor trips are near-free once the currency is banked, and no table is ever going to rate every Nightwave act honestly, so a cost signal that guesses is worse than none. A task the player does not want is turned off, not made expensive: that is what the per-activity `never` and `low` settings are for.

Only a deadline promotes. A window that merely rerolls what is on offer — a stall's 4-day rotation grid, where the vendor never leaves and no allowance goes unspent — takes nothing away when it fires, so it orders by time left inside its band and never jumps one. A daily or weekly reset, a trader leaving and a fissure closing all lose the opportunity, and promote. The provider that builds the window says which it made; nothing keys off a vendor id.

| Band | Holds |
|---|---|
| 1 | Useful or better with under 6 hours of a deadline — ahead of a must-have that still has days |
| 2 | Must-have and Want, whatever their window |
| 3 | Useful or better with under 24 hours of a deadline |
| 4 | Useful with over 24 hours, then Filler, then Junk |
| 5 | Everything set to `low`, in its own order below all four bands |

Anything at zero gain is not ordered at all — it is gone.

Bands govern the Tasks section, which has no sort control. Relics, Acquisition and Mastery are ordered by the control the player picked, so their providers' `order` stands and worth does not override a choice already made.

Every suggestion carries the worth of the best thing it pays that the player still needs. A vendor is one card for a whole stall, so it is worth its best offer: most stalls hold one rotating slot that ever matters, and Bird 3's archon shard is the whole reason to visit him.

Urgency is measured against the window's own length, not one fixed horizon. A 72-hour constant scored every daily and no weekly for four days in seven, which inverted the whole feed.

## Slices

Each is shippable alone, in order.

| # | Slice | Notes | Status |
|---|---|---|---|
| 9 | Build import to full step plan | | |
| 11 | Scannables: track and collect scannable things | Spec below | |

### Relic routes for Primes

Relics join the shared store as things to farm, each with where it drops. A Prime's plan page builds its farming route in code, not authored text: the relics its missing parts need, grouped by where they drop, with how many of each to farm solo to expect the part at its rarity. Vaulted and unvaulted relics come from data that updates itself from DE's sources, so a vault rotation changes the route with no edit. Prime effort (vaulted 8, unvaulted 5) gets revisited once routes exist.

### Wiki verification pass

Check every plan and store fact against the official wiki: part drop chances, recipes nobody flagged, `tradeable`, Market prices, and `Credits` totals, including the plans that state no build cost (Gauss, Saryn, Nidus, Khora, Chroma and the rest).

The same pass also runs two code-side sweeps:

- **Row tracking:** walk every warframe plan against the real item database and confirm every part, blueprint and foundry row resolves against the inventory rather than falling back to a manual tick.
- **Nested recipes:** `partDemand` sizes rows under a sub-assembly (Equinox's Aspects) from the full recipe tree. Confirm every other frame built from sub-assemblies reads right on its plan.

### Scannables

Possibly its own top-level feature, one band or tab per group.

- **Groups:** Somachords, Frame Fighter data, Cephalon fragments, the themed fragment sets (Eidolon, Fortuna, Glass, Ghoul, Albrecht, Duviri and the rest), lore cards, codex enemy and object scans, Simulacrum enemies, Simaris synthesis targets.
- **Progress:** fragments are the inventory's `LoreFragmentScans` (`Progress` and `Region`) against `reqScans` in `ExportCodex.json`, which also lists the ones never found. Enemies are the profile's codex scans (`codexProfile`) against `codexScanRequirements.json`. A group with no game data falls back to marking off by hand, or OCR as the other OCR features do.
- **Suggestions:** where to go for the most progress per run, with an ELI5 how-to, e.g. "take Helios with Investigator to X, pick up the Somachord by the air supply in the middle of the map".
- **Browse:** each group lists what is had and missing, and any item can be picked as the target, which steers the suggestions to it.
- **Later:** Captura scenes, decorations, every other collectible.

## Misc
- read the wiki for a brief farm snapshot per mod, the way `weapons.json` does for weapons, so the app answers it without the wiki.
- Deep/Temporal Archimedea should say whether you own the frames and weapons that week wants. Nothing in world state names them; `api.warframestat.us/pc/deepArchimedea` does, which means a new feed.
- Baro stock should flag what is new since his last visit. Needs visit history the app does not keep.
- estimate the time a farm costs, not just its difficulty band.
- Bird 3 and Yonta offer little once their permanent stock is excluded. Revisit whether "worth the trip" should include standing rotations.
- Steel Path Incursions are excluded from suggestions; they rotate constantly and read better in game.
- Amps are excluded from acquisition entirely by `NOT_A_WEAPON_PATH`, so the sweep never suggests one; they are modular gear bought with standing rather than a farm the resolver can route. Mastery levels them under Weapons. Revisit whether acquisition should route them.
- when looking at details for acquisition, i want to make sure isntructions there are nice and complete. so we'll do a pass on hydrating our data, distilling it down to the core facts, and how to present it prettily and succinctly. This is one of the key areas for "don't make me think" of the app. I want to click a frame, and know "oh, go to this planet, that mission, has x% drop rate per part", etc. (along of course with cost to just buy it when applicable, or instructions if it's a bounty, how to do it if its one of those weird boss battles that has prereqs, and so-on).
- For example, Kullervo. You have to run durivir experience, but in one of 3 specific mood spirals, and while there, you need to be collecting specific materials as well. and the fight with him, the player needs to know how to beat it. so making sure the player can go in, get it done, and knows where to get the extra resources, all up front, is really important. things like a map of duviri showing what they need (lots of options for this). other frames/weapons will all have this type of crap too, but totally different. Sure, some are simple "run this bounty over and over", but even then, there's probably suggestions on the best bounty to run.
- another idea...related to acquistion, what if there was an "I wanna just mindless farm resources" suggestions, for stuff that a bunch of frames or weapons use. so you could ge tin a grove grinding ores or fish or something, and know that later it was useful? Like we can caculate how much of every resource ever a person needs, could really give them "no specific goal but this ore is used the most in stuff you haven't built yet so go grind it, it'll be useful later"?
- need to know when to surface good alerts or invasions, in tasks. including event stuff like tennocon or devstream events.
- not sure when/where, but i have lots of incarnons that i've never used or built or unlocked. suggesting that would be good too, and most importantly, first getting the best weapon to put the incarnon on
- For tasks - have a "snooze" that mabye asks 1h 6h 24h that bumps it to the bottom just for that time frame?
- syndicate - can we detect which ones they're positive on, and suggest top mods to buy?
- normal Circuit: per week, a short farm synopsis for each of that week's Warframes and the order the community suggests running them in. The weeks rotate on a fixed cycle, so each one is captured once and reused from then on. Source is Pupsker's weekly update videos at https://www.youtube.com/@Pupsker, read as transcripts, newest first and working backwards until every week in the rotation has been seen.
- Relic packs and Aya: the first card of the relics band, always, the relic counterpart to Vosfor. The standing and Steel Essence packs show how many still-needed parts they could pay out that the player holds no relic for. Aya reads the current Prime Resurgence stock and suggests which relics to buy, if any, each with its reason. 