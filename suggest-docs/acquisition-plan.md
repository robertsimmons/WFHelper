# Acquisition — plan

Goal: the player opens Acquisition, the top of the list is the right thing to build, and one
click turns it into a numbered list of instructions they can follow without leaving the app.

Every kind — Warframe, weapon, sentinel, beast, Necramech, modular — runs through one resolver,
one card and one plan format. Kind changes the art and which filter group it sits under. Nothing
else.

## How we work this feature

Design is locked before production code, in three escalating steps.

1. **ASCII in chat.** Layout, what sits where, what each control does.
2. **Scratch HTML**, in the scratchpad, carrying real researched data for real items — clickable,
   several options side by side where a choice is open.
3. **Locked spec** — layout and the data schema behind it — then production code.

A phase does not start until the phase before it is locked. The schema falls out of the
prototype, so the prototype uses real data or it has proved nothing.

## Phase 1 — Prototype and lock

Seven items, chosen because each exercises a different step type. Research is done and lives in
the scratchpad as `research-*.json`, wiki facts plus a merged `community` block.

| Item | Exercises | Effort |
|---|---|---|
| Rhino | Boss drop plus a market blueprint, the baseline | 3 |
| Cyte-09 | Bounty tiers, rank gate, pity purchase on the row | 5 |
| Helios | Dojo research chain with intermediate crafts to flatten | 5 |
| MOA | Modular head parts bought with syndicate standing | 6 |
| Hound | Nemesis drops plus modular assembly | 6 |
| Mesa Prime | Relics, refinement per goal, vaulted, currency chain | 7 |
| Kullervo | Duviri spiral moods, in-run gathering, a fight with a method | 7 |

Remaining deliverables: the plan page, card and Working-on band as clickable HTML on that data,
and the step schema they are driven from.

## Phase 2 — Research pipeline

Per item the research produces: best route and why, condition or cycle requirements,
prerequisites, resource farm spots, effort 1–10, and any gotcha. Drop tables and part sources are
already machine-derived from `overframeItems.json` and are not re-researched.

- **The wiki is right.** Every fact — route, drop rate, prerequisite, condition — comes from it
  and is never overruled.
- Batches of ~5, **grouped by shared farm route**, not alphabetically. Items that share a source
  share a wiki fetch and come out consistent by construction.
- Every batch gets the same effort rubric with named anchor items, so 1–10 means one thing across
  the whole set.
- An unresearched item still gets a plan from the drop table alone, marked as having no community
  notes. Unknown never reads as bad.

Fan-out is one agent per batch.

### Community sources

Community material supplies **effort, recommended mode and tips**, never facts. It lands in its
own `community` block so the two layers stay separable: `painLevel`, `recommendedMode`,
`preferredRoute`, `timeEstimate`, `traps`, `tips`.

- Reddit and `forums.warframe.com` refuse our fetcher. Rob supplies Reddit summaries as markdown;
  the batch reads them from disk.
- YouTube is reachable. `python C:/Users/rober/.claude/scratch/wf-yt/wf_yt.py "<query>" --videos 2
  --comments 30` writes one digest of transcripts plus top-scored comments. Transcripts mangle
  proper nouns, so they carry method only; the comments carry the corrections. Guide videos skew
  to mods and builds, so this earns its keep on fights and routes rather than shopping lists.
- A community claim that contradicts the wiki goes in `conflicts` with both readings and which one
  the app shows. It never overwrites the wiki field. Where both are true at once — Kullervo's
  Steel Path pays more *and* is a trap — the wiki number is the fact and the community position is
  the recommendation.
- A claim the wiki disproves goes to `discarded` with the reason.

### Effort

One flat number per item, 1-10. It is a rough signal, not a computation: it is never derived from
the player's state, their clan, or which need surfaced the item. Where a goal changes the job
enough to matter — owning a Hound against gilding every Model — rate the mastery job, since that
is what acquisition is for.

## Phase 3 — Scope

Acquisition currently sweeps Warframes, Archwing suits and weapons. Everything else masterable is
absent. Add, in two waves:

- **Wave 1**, ordinary recipes needing no new step type: sentinels, Necramechs, beast companions
  (Kubrow, Kavat, Predasite, Vulpaphyla).
- **Wave 2**, modular, needing a "pick three parts" step and a standing-cost line: MOA, Hound,
  amps, K-Drives.

### Filter row

Five grouped dropdowns replace the flat checkbox row. Warframes is a plain toggle; the rest open
a multi-checkbox and carry their own selected count.

```
[ Warframes ]  [ Weapons 2/3 v ]  [ Companions 0/4 v ]  [ Archwing 0/3 v ]  [ Other 1/3 v ]
                   +--------------+
                   | [x] Primary  |
                   | [x] Secondary|
                   | [ ] Melee    |
                   +--------------+
```

| Button | Contains |
|---|---|
| **Warframes** | no dropdown |
| **Weapons** | Primary · Secondary · Melee |
| **Companions** | Sentinels · Sentinel weapons · Beasts (Kubrow, Kavat, Predasite, Vulpaphyla) · Robotics (MOA, Hound) |
| **Archwing** | Archwing suits · Arch-gun · Arch-melee |
| **Other** | Necramechs · Amps · K-Drives |

Sentinel weapons sit with the pet rather than with the weapons: Helios and Deconstructor are
farmed in the same place.

Railjack armaments are excluded today. Whether they carry mastery decides whether they join
Other; confirm against the item database in phase 1.

## Phase 4 — Card and sort

`Recommended` sorts by, in order:

1. **Closest to ready** — foundry would take it now, then every blueprint in hand and only raw
   materials short, then one band per blueprint still to find.
2. **Overframe score.** The tier letter is that score rounded, so one key covers both the letter
   and the position inside its band.
3. **Effort**, 1–10.

Card gains a progress read — `4 of 5 parts`, or `Ready to build` — and an effort meter: ten
segments, green through red, fixed position, no number and no word. An unrated item shows an
empty meter and sorts last, as an unknown tier does.

```
+------------------------------------------+
|                                    [ B ] |
|            ( art band )                  |
|  RHINO                        CIRCUIT 3w |
+------------------------------------------+
|  2 of 4 parts             Jackal, Fossa  |
|  ###-------                              |
|  [ Work on this ]             [ Details ]|
+------------------------------------------+
```

### Modular gear

Mastery for modular gear comes from the head part alone: Model for Hound and MOA, Prism for an
Amp, Strike for a Zaw, Chamber for a Kitgun, Board for a K-Drive, Subspecies for a Predasite or
Vulpaphyla. Other components are stats and looks. Gilding gates the mastery everywhere except
K-Drives, and rank 30 matters twice, once to qualify for gilding and once after. Banked mastery
survives selling, and rebuilding the same head part earns nothing.

One card per gear type, progress reading `1 of 4 Models`. Details name every head part still
needed, what each one unlocks, and where to start.

## Phase 5 — Pin

Card gains **Work on this**. Pinned items form a band at the top of the Next Up feed, above
Tasks, one compact card each with a step counter. Soft cap of three. Unpinning and completing
both return the item to the normal list.

## Phase 6 — Plan page

A full page, reached by clicking a pinned card. Item art, name, tier, and two buttons: **Refresh
from inventory** and **Show crafting tree**.

Prices sit under the name, never as a step: in-game Market credits and platinum, the
warframe.market player price, and any real-money bundle. Only the real-money entry gets a
distinct treatment, so what costs money and what costs time separate at a glance.

Steps group under the trip that does them. A group is a place plus an activity; its rows are what
that trip yields.

```
  ( art )  RHINO                            [ B ]  ###-------
           35,000 cr blueprint  ·  375 p built  ·  Circuit in 3w

  FOSSA, VENUS   Assassination, Jackal            ~8 runs, solo
    [ ] Neuroptics                                       38.7%
    [x] Chassis                                          38.7%
    [ ] Systems                                          22.6%
    !  Fossa showing high level is a Nightmare or Invasion overlay
    +  also clears the Venus Junction task
    >  how to beat the Jackal
```

`!` is a condition or trap, always visible. `+` is a bonus the trip also earns. `>` is a
disclosure holding depth that would otherwise be cut: a fight walkthrough, the alternative
relics, why public squads go wrong.

Step types, each with one fixed render: buy, research, farm a node, run a bounty, crack relics,
hunt a nemesis, finish a quest, start a build, wait.

- **There is one plan, and it is the farm.** No route chooser. A shortcut is an annotation:
  Circuit availability is a badge, market and player prices sit at the top, and a pity-currency
  purchase reads on the row it covers — `[ ] Neuroptics 13.3% or 20,000 standing at Amir`.
- **Steps combine.** Two parts from one node is one group. A material that drops where the player
  is already going joins that group rather than starting its own. Two requirements sharing a
  source become one row.
- **Nested crafts are flattened**, never nested. An intermediate craft becomes gather rows, then a
  craft row, in the order they must happen. The crafting tree stays behind its button for anyone
  who wants that view.
- **Conditions live on the group.** Cycle, spiral mood, Steel Path, relic refinement, bounty tier
  and stage. A gate — quest, clan research, syndicate rank — comes first and greys out the rest.
- **Ordering starts the long pole first.** Whatever unblocks a multi-day timer comes early, with
  only the gathering that timer actually needs ahead of it. Foundry builds run in parallel, so the
  page orders by critical path rather than by list order.
- **Currency is its own group**, sorted ahead of whatever spends it. Aya, Kullervo's Bane and
  syndicate standing each expand into how to earn them, with their own conditions and tips.
- **Pick the best option, do not list options.** The best relic for a part, the best node for a
  resource. Alternatives go behind `>`.
- **Done rows vanish**, recomputed against inventory on open and on refresh. Manual tick for what
  inventory cannot see.

### Derived facts

Anywhere a fact can be resolved against world state or inventory, the resolved form is what
renders. `Circuit in 3w`, not `Circuit week 2`. `Sorrow now, 47m left`, or `Joy now, Fear in
1h 12m`, not a list of which moods work.

The same applies to whether a matching fissure is up, whether the bounty holding a part is on the
board this rotation, whether Varzia's current stock includes this item and when it next rotates,
days to afford a standing cost at the player's daily cap, what the foundry already has cooking,
how many of the needed relics are already held, and whether a node currently carries a Nightmare
or Invasion overlay.

### Maps

Built for from the start, dark until the map phase lands. Every harvestable resource points at
the map for its location, so one map serves every item that farms there and the set stays small.

A resource-farm group carries a map link whether or not the map exists yet; an absent one renders
disabled. The app can list every location a plan references that has no map, so the map phase
starts from a work list rather than a survey.

## Phase 7 — Research fan-out

Every remaining item, batched as phase 2 established, in Overframe score order so the top of the
list is covered first.

## Later

- Maps themselves — the open-world resource spots and Duviri first, in reference order.
- A time estimate on a step where the community states a real one.
- "I just want to farm something useful" — the aggregate of every material every unbuilt item
  needs, which the part plans already compute.
