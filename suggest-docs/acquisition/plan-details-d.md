# Plan details: layout D

Reference: `proto/plan-details-v2.html`.

## Rules

- One component renders the details for the Acquisition modal, the pinned card's plan and the plan page: `AcquisitionBody` → `PlanSteps`. The plan page only adds controls (tick, take alt, open map).
- Everything renders from data: plan JSON, `resources.json`, shops, the crafting tree and inventory. No per-item code.
- Header: name, effort tag, copies tag (Warframes only: "2 copies", or "1 more: have one", "subsumed" or "Prime owned"). Wiki is always present, warframe.market when tradeable, and the Crafting tree link is always present (it opens the crafting tree screen).
- UI text is terse tags and imperatives, never sentences, and has no em dashes.

## Sections

- **Get blueprints:** market, vendor, quest and shop buys.
- **Farm:** drop missions, currencies and materials.
- **Build:** foundry lines, with build totals in their drawer.
- A section with nothing left vanishes. Done lines fold into one "N done" disclosure at the bottom.
- Farm groups by place: two or more things from the same place become one trip row (place, then a chip for each pickup). A single-source thing stays one line.
- Common materials (resources.json common tier) fold into one Basics chip line.
- Counts render as `have / need` with a bar. A balance the app can't read shows `need` only.
- Next mark: the first unfinished line in the plan gets a subtle highlight.
- Clicking any line opens its drawer: where, rates, notes, other spots, disclosures, tips, map and links. The main view carries none of these.
- An open-world resource (Plains, Vallis, Cambion, Duviri) gets a map button on its chip or line.

## Shops

- `src/data/suggest/shops/<key>.json`: vendor, place, currencies (1 or 2), and wares. Each ware has a name, the item it belongs to or `cosmetic`, a price per currency (a ware payable in either currency lists both), and qty.
- A plan references a shop by key. The plan carries only its own drop sources.
- One picker per shop, opened from the plan's Buy line and Farm line. It lists every ware, grouped by item, with cosmetics last.
  - One unit per checkbox ("Systems Blueprint #1", "#2").
  - Units the player lacks are pre-checked. Owned units show as owned, and looted counts as owned. Cosmetics start unchecked.
  - Check state is per shop and persisted, shared by every plan that uses the shop.
  - Totals: C = Crimson-only, E = Emerald-only, X = either. Short = max(shortC + shortE, C + E + X − balances), and the per-currency floors show only when that currency is short. The line reads "have N, need M, short K (~clears)" when a per-run yield is known.
  - An "Also: <items>" tag lists the other items farmed off the same shop.
  - The Buy line stays greyed until the balance covers the picks.

## Phases

1. Model: shops data, schema and validation; migrate every plan whose shop is shared or pity-currency; build the D step model in `planSteps.ts` with unit tests.
2. UI: rewrite `PlanSteps.svelte` to D, add `ShopPicker.svelte`, the header links and map buttons, and drop the parts tree from the main view (the Crafting tree link replaces it).
