# Plan schema

One `plan-<slug>.json` per item. The prototype renderer reads these; nothing is hand-written HTML.

```
{
  name, kind, tier, effort,                  effort 1-10, tier S..D or null
  tradeable,                                 true | false | "blueprints only" | null
  progress:  { have, need, unit }            unit: "parts", "Models", "relics"
  badges:    [ { text, tone } ]              tone: circuit | info | warn
  prices:    [ { label, amount, money } ]    money true only for real-money bundles
  groups:    [ Group ]
}
```

A `Group` is one trip: a place plus an activity. Its rows are what that trip yields.

```
{
  type,          gate | farm | bounty | boss | vendor | relics | fissure
                 | currency | research | foundry | craft
  place,         "FOSSA, VENUS" — the destination, or the system for a non-travel step
  sub,           the specific spot inside it: "Temple of Profit" — null when none
  activity,      "Assassination, Jackal" — what you do there; null when place says it
  meta,          right-aligned: run count, time estimate, cost, build hours
  mode,          community recommendation: "solo, normal" — null when none
  live,          { state, text } — null when nothing is time-gated
  skip,          { reason } when this group is already satisfied — null otherwise
  earns,         { currency, amount } for a group that banks a currency — null otherwise
  spends,     [ { currency, amount } ] for every group that consumes one — [] otherwise
  map,           resource-map location key, or null
  rows:       [ Row ]
  conditions: [ string ]     renders as ! , always visible
  bonuses:    [ string ]     renders as + , always visible
  disclosures:[ { title, body } ]   renders as > , collapsed
}
```

```
Row { qty, label, note, alt, done }
```

- `qty` null for a single item, `"150"` or `"1,200"` for a quantity.
- `note` right-aligned fact: a drop rate, a currency cost, what a head part unlocks.
- `alt` the pity purchase or second source for this row alone: `"or 20,000 standing at Amir"`.
- `done` true when inventory already covers it. Done rows render struck through in the
  prototype rather than vanishing, so the layout can be judged with them present.

## Availability, skipping and currency

`live.state` is one of three.

- `open` — go now.
- `blocked` — a window the player is outside of. It states when it opens and never disappears,
  because the work still has to happen: `{ state: "blocked", text: "Sorrow in 2h 47m" }`.
- `waiting` — a clock is running and there is nothing to do until it ends: a build cooking, dojo
  research, a vendor rotation. Distinct from `blocked`, where the player could act if the window
  were right.

One world-state value splits groups in opposite directions. Under an Anger spiral, Kullervo's Hold
is open (Anger, Sorrow or Fear) while Archarbor is blocked (Joy, Envy or Sorrow). The plan must
resolve each group against the same value independently.

`skip` marks a group the player has already satisfied by other means, dojo research an
established clan finished years ago being the usual case. It renders dimmed with its reason, not
deleted, so the plan still reads as complete.

`earns` and `spends` name the same currency on two groups. The farm banks it, the vendor consumes
it, and the pair is what keeps "42 Bane" honest as rows are ticked instead of being hand-summed
into a `meta` string.

## Resources

Farm locations live in `resources.json`, keyed by resource name, never inside an item's research.

```
"Rubedo": { harvestable, map, best: { place, sub, activity, how, meta }, alternates: [ … ] }
```

A plan's material group is generated from that table, so the same resource is researched once and
every item that needs it renders identically.

An entry leads with **which mission to run** and also says **how it drops there** — `how` on each
source: destructibles, a named enemy, mining, fishing, a plant, or several at once. The mission is
what the player picks; the mechanism is what they do once they are in it, and both are facts we
hold.

Two mechanisms in the same mission are one answer, not a conflict. Argon Crystal comes from Void
deposits *and* Void enemies, so its entry says the Void and lists both.

`harvestable` and `map` are for resources where a spot on a map is genuinely the answer: mining
nodes, fishing, plants.

## Rules the data must already satisfy

The renderer is dumb. Every decision below happens when the plan is authored.

- **Order is the order to do it in.** Whatever unblocks the longest timer comes first, with only
  the gathering that timer needs ahead of it. Currency groups precede whatever spends them.
- **Combine.** Two requirements from one source are one row. Two parts from one node are one
  group. A material gathered where the player already is joins that group.
- **Flatten.** An intermediate craft becomes gather rows, then a craft row. Never a nested group.
- **Pick, do not list.** The best relic, the best node. Alternatives go in a disclosure.
- **No route chooser.** One plan, the farm. A shortcut is a badge, a price, or a row `alt`.
- **Resolve derived facts.** `Circuit in 3w`, not `Circuit week 2`. Where the prototype cannot
  compute one, hard-code a plausible value and it will be wired later.
