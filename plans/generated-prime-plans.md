# Generated Prime plans

A Prime whose parts drop from relics gets its plan built at runtime from live data. Vaulting only changes where the relics come from. Platinum is never a plan group or route; the card's trade path (`paths.ts` `platCost`, `sort.ts` `platFor`: wfm link, set plat, plat for the missing parts, the lesser one sorts) is untouched.

## Settled (Rob)

- Vault state comes from the live drop tables (`services/dropData.ts`, drops.warframestat.us): a relic with no rows is vaulted; Railjack derelict-cache relics are the ones whose every row is a `(Caches)` place. The bundled @wfcd flag answers until the tables load. Each refresh re-sends the relic DB.
- Effort is 8 when any part needs Varzia (vaulted-only relics); cache-only parts stay 5; otherwise 5.
- Per-Prime extras live in `src/data/suggest/primeOverrides/<slug>.json`: gates, badges, and an effort only with a stated reason. No tips, conditions, bonuses or disclosures; community tips get their own layer.
- Primes that are not relic-shaped (Galariak, Sagek, War, Gotva, Venari Prime) keep full authored plans.
- Precedence: an authored `plan-*.json` always wins; generation only fills a Prime with no file. Ash Prime is migrated; the other relic Prime files go in the tips migration.

## Live inputs

- Vault state per relic: `relicService.getRelicDatabase` stamps each group with `dropping: "missions" | "caches" | "none" | null` from `dropData.relicDropRows()` and restamps whenever `dropTablesRevision()` moves. `null` is tables not loaded, and `vaulted` stays the @wfcd flag then; otherwise `vaulted` is `dropping === "none"`. Requiem relics keep the bundled flag (Kuva Siphons list only "Requiem Eterna"). `caches: { region, chance }[]` holds the best chance per region ("Pluto Proxima").
- Push: a drop-table refresh that changed anything broadcasts `relic-db-updated`; the renderer re-pulls `getRelicDatabase` if it holds one (`src/lib/rendererEvents.ts`).
- Part to relic: one index per `relicDb`, memoized by identity, keyed by `componentUniqueNameAliases` with a name fallback.
- Recipe, build credits, times and materials: `buildCraftingTree` over the item DB.
- Varzia and Baro stock: `traderRelics(trader, db, now)` (`src/lib/suggest/traderRelics.ts`), shared with `relicPacks.ts`.

## Generator: `src/lib/suggest/acquisition/plan/prime.ts`

`generatePrimePlan(target, { itemDb, relicDb, world, now, overrides? })`. Null when the item is not a Prime, has no known part plan, there is no relic DB, or no part has any relic.

Per part: `open` (some relic drops from missions), `caches` (only cache relics), `vaulted` (only `none`), `unknown` (no relic, or no vault state anywhere).

Groups, in order:

- `gate`: override gates, then "Mastery Rank N" when MR is above 2 (AUTHORING's rule; MR 1-2 stays in the foundry meta). Place "MASTERY RANK" alone, "QUESTS" with override gates.
- `farm` "RAILJACK DERELICT CACHES": one "<Relic> relic" row per cache relic of a `caches` part, noting the parts it pays and each region's chance.
- `currency` Aya, `ref: "Aya"`, place from the store, qty the summed Aya price when every price is known: only when the Varzia group lists relics.
- `vendor` "MAROO'S BAZAAR, MARS" / Varzia: a row per vaulted relic she stocks now. A vaulted part neither she nor Baro stocks gets a part row and `live: waiting`. No world read: every vaulted relic is a row and `live` "Varzia's stock unknown".
- `vendor` "BARO KI'TEER": the vaulted relics he stocks, with Ducat and credit prices.
- `fissure` "ANY VOID FISSURE": a row per part with the relics of its current pool, rarity and best refinement, a bottleneck meta, a condition per non-open part, "Vault status is from bundled data until the drop tables load." while that holds, and an "also in vaulted relics" disclosure.
- `foundry`, with `materials` from the recipe; a material the store does not name is listed bare.

Plan fields: `effort` from the rule above unless the override states one; `badges` lead with "vault status unknown" (info) when any part is unknown, then "vaulted" or "relics from Railjack caches" (warn) or "MR N" (info), then the override's; `source: "relics"`; one `chosen` route, "Void Fissures" or "Varzia relics, as <name>".

Trader rotation timing is the live Varzia fact's job (`facts.ts` `varziaFact`, which matches the group's relic rows against her shelf), never generated text, so a memoized plan does not go stale.

## Wiring

- `plan/data.ts` `planFor(target, live)`: authored file first, then the generator, memoized per (itemDb, relicDb, name, each trader's active window). `ratingOf(plan, player)` rates either.
- `acquisition/index.ts` takes `plan`, `planDone` and `rating` off `planFor`; the sweep passes no world, since rating and route lead never read trader stock. `sources.ts` files a rated Prime with no authored file under `relics`.
- `plan/index.ts` `resolvePlanFor` uses `planFor`; `PlanContext` carries `relicDb`, which `NextUpView.svelte` passes.
- `SuggestionCard.svelte`: a Prime with no sweep rating is unrated, never `planRating(name)`.

## Unknown, never guessed

- No relic DB: no generated plan; the card is unrated and the plat path still renders.
- A part with no relic: a fissure row "no known relic drops it", never left out.
- No recipe: the foundry row "recipe unknown", no materials.

## Later

- Migration (`plans/community-tips-layer.md`, step 8): diff each `plan-*-prime.json` against its generated plan, move leftover gates and badges into `primeOverrides/` and leftover advice into `acquisitionTips/`, then delete the file.
