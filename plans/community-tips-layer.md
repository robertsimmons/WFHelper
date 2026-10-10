# Community tips layer

Facts live in the plan (authored `plan-<slug>.json`, or the generated Prime plan). Community knowledge lives in one tips file per item. The plan page renders both.

## Data: `src/data/suggest/acquisitionTips/<slug>.json`

- Slug matches the plan's (`plan-khora.json` and `khora.json`); lookup is by `name`, like plans. Any item can have one, including relic Primes with no authored plan.
- Shape: `{ name, tips: Tip[], removed: Removed[] }`.
- `Tip`: `{ text, kind, consensus, anchor }`.
  - `kind`: `tactic` (how to run it), `gotcha` (a trap players learned), `gear` (frame, weapon, mod, booster pick), `sentiment` (worth it, realistic time, what people regret).
  - `consensus`: `unanimous` ("near-unanimous"), `common` ("named repeatedly", "several"), `some` ("a few"), `single` ("one person").
  - Tips render inside the step they are about, so the plan reads as one set of ELI5 instructions. `tactic`, `gotcha` and `gear` always carry an anchor to a group/row; only `sentiment` is plan-level.
  - `anchor`: null (sentiment only) or `{ route?: "afterQuest", group: PlanGroupType, place?: string, row?: string }`. Matched semantically, never by index: group type, then `place` substring, then row label. No match falls back to plan level; a tip is never dropped by a route change.
- Every tip has a stable `id` (slug-scoped, never reused).
- `Removed`: `{ id, text, reason, wiki }`, written only when Prune confirms a dispute. Nothing renders it; it stops the tip coming back.
- Disputes are fact-layer data in `acquisitionTips/disputes.json`: `{ item, tipId, claim, wiki, status: "open" | "confirmed" | "dismissed" }`, written by fact passes, never by the skill except to set `status`. An LLM's contradiction is a claim, never a verdict.
- An open dispute renders the same everywhere: the tip stays in its step with a "Wiki disagrees" marker; the cited fact and link sit behind a disclosure. Dismissed disputes render nothing and stop the same dispute being filed again.
- Text: one ELI5 imperative sentence, no em dash, no dates or "currently", no platinum route, acquisition only (no build or usage advice).

## Code

- `src/lib/suggest/acquisition/tips/`: `schema.ts`; `data.ts` (eager glob, `tipsFor(name)` returns live tips with their open dispute attached); `anchor.ts` (`placeTips(groups, tips)` returns per-group tips, the plan-level rest and sentiment, strongest first).
- `plan/resolve.ts`: `ResolvedGroup.tips`, `ResolvedPlan.tips` (unanchored), `ResolvedPlan.sentiment`; `PlanContext.tips` swaps the lookup. Store-built material groups take no item tips. Works the same on a generated plan; `plan/prime.ts` `generatedSteps()` lists the steps a generated plan can hold.
- Resource tips stay in `resources.json` `tips`, rendered on the material's farm group as today. Item tips files hold no material tips.
- `tips/validate.ts` (`validateTips`, `validateDisputes`) plus `tests/renderer/lib/suggest/acquisition/tips/validate.test.ts` over every file: name resolves to an authored plan, a relic Prime in the bundled relic table, or a store key; enums real; text non-empty, unique, no em dash, no year or "currently"; ids unique across `tips` and `removed`; every anchor matches a group (and row) in the item's plan; a generated Prime's anchor carries no `row`; `removed` entries carry reason and a wiki URL; no live tip repeats a removed text; a dispute names a live tip, unless confirmed, which names a removed one.

## Fact or tip

- Stays in the plan: drop sources and rates, rotations, recipes, gates, vault state, extra reward sources (Circuit tiers), and any game rule that makes a run fail (Elite SO has no Khora parts; a scanned corpse gives no code).
- Moves to tips: what to bring, which node is fastest, squad behavior, booster stacking advice, bug workarounds, "the common wrong turn" framing, sentiment.
- Per field: `conditions` keep hard requirements, the rest become `gotcha`. `bonuses` keep extra sources, advice becomes `tactic` or `gear`. `disclosures` keep mechanics walkthroughs and alternative-route steps, strategy moves. `mode` keeps a hard constraint ("solo only"), else it becomes an anchored `tactic` and `mode` goes null. Row `note` and `meta` keep facts only.

## Rendering

- `src/components/nextup/plan/PlanTips.svelte`, shared by the plan page and the modal. Reuses the PlanGroup list and `<details>` markup.
- In `PlanGroup.svelte`, after conditions and bonuses: up to two `unanimous`/`common` tips inline with their own marker (`gotcha` in warning tone, others in accent), so a tip never reads as a `!` condition. The rest behind "more tips (N)".
- `AcquisitionPlanPage.svelte`: unanchored tips in a Tips block after the groups, same split. Sentiment in a collapsed "What players say" after that, above the currency ledger.
- `SuggestionDetailsModal.svelte`: one collapsed Tips disclosure under Routes, strongest first, sentiment last inside it.
- i18n keys: `nextUp.planTips`, `nextUp.planMoreTips`, `nextUp.planSentiment`, `nextUp.planTipDisputed`. No tips file renders nothing.

## Migration, per item (fan-out, 16 plans per agent)

Paths below are under `C:/src/personal/wfhelper-next-up/src/data/suggest/`. Exemplars, read before the first slug: `acquisitionTips/gauss.json` against `plan-gauss.json` and `wfhelper-research/done/gauss.md` (rich research), `acquisitionTips/wrath.json` (two groups sharing a place, disputes in `disputes.json`), `acquisitionTips/ash-prime.json` (a relic Prime whose plan file is gone).

1. Read the current `acquisitionPlans/plan-<slug>.json`, the pre-pass plan `git -C C:/src/personal/wfhelper-next-up show ea2e4f31:src/data/suggest/acquisitionPlans/plan-<slug>.json` (absent means the plan is newer), `C:/src/personal/wfhelper-research/done/<slug>.md` if it exists (most Primes have none), and `acquisitionTips/<slug>.json` if it exists (add to it, never drop from it).
2. Collect candidates: research "Tips" / "Tips people actually gave", "Gotchas", "Community sentiment"; from both plan versions, every `conditions`, `bonuses`, `disclosures`, `mode` and row `note`/`meta` line that is advice rather than fact (Fact or tip, above).
3. A tip about a curated store material (a `resources.json` entry with a `kind`: resources, Talents, standings, Aya) is not the item's: list it in your report under the resource name for the orchestrator to merge.
4. Dedupe: one tip per piece of advice, the most specific wording, the highest consensus seen.
5. Never drop a tip for being wrong: anything you think the wiki contradicts, or that describes patched behavior, stays and gets an entry appended to `acquisitionTips/disputes.json`: `{ item, tipId, claim, wiki, status: "open" }`, `claim` the wiki fact in one sentence, `wiki` a `https://wiki.warframe.com/w/` URL (a patch-note section anchor is fine). Re-read the file right before appending; other agents append too. Drop only exact duplicates, generic advice ("do bounties"), calendar dates, exploits, build or usage advice for the finished item, unrelated content met in the same mission (codex scans, Signa), and any platinum or player-trade route ("just buy it", "relics still trade").
6. Write `acquisitionTips/<slug>.json` as `{ name, tips, removed: [] }`, `name` exactly the plan's, tips strongest first. Per tip:
   - `id`: short kebab-case, unique in the file, never reused.
   - `text`: one ELI5 imperative sentence; no em dash, year, "currently" or platinum.
   - `kind`: `tactic`, `gotcha`, `gear` or `sentiment` (one or two sentiment tips at most).
   - `consensus`: near-unanimous or a highly upvoted correction is `unanimous`; "repeatedly", "several", "multiple" is `common`; "a few", or plan-only advice with no weight, is `some`; one person is `single`.
   - `anchor`: null for sentiment only. Otherwise `{ group }` with the step's group type, plus `place` (an upper-case substring of its place) whenever another group shares that type, plus `row` (a substring of one of its row labels) only when two groups also share the place (Wrath's two Pontis Tower bosses). `route: "afterQuest"` for a step in `afterQuest.groups`. A tip that fits no step is sentiment or not worth keeping.
   - Generated Primes anchor by `group` and `place` only, never `row`: `gate`, `farm` (Railjack caches), `currency` (Aya), `vendor` with `MAROO'S BAZAAR` (Varzia) or `BARO KI'TEER`, `fissure`, `foundry`.
7. Strip the moved content from the plan with Edit, keeping its formatting; set `mode` null when its text moved; change no fact. A fact that looks wrong goes in the report, not the plan.
8. Relic Primes (`plan-*-prime.json` whose parts drop from relics; Galariak, Sagek, War, Gotva and Venari Prime keep their plans and follow steps 1-7):
   1. Do steps 1-6 from both plan versions first; the generated plan carries no advice.
   2. Diff the plan against what `generatePrimePlan` emits (`plans/generated-prime-plans.md`, Groups and Plan fields). Move only what it cannot derive into `primeOverrides/<slug>.json` `{ name, gates?, badges?, effort? }`: gates other than Mastery Rank (quests, syndicate ranks with `rank`); badges other than "vaulted", "relics from Railjack caches", "MR N" and "vault status unknown"; an effort that differs from the rule (8 when any part needs Varzia, else 5) only as `{ value, reason }`. No conditions, bonuses, disclosures or tips in an override; with nothing left over, write no override.
   3. Delete `acquisitionPlans/plan-<slug>.json`. Relic lists, rarities, recipe, materials, routes and vault conditions go with it; the generator derives them.
9. `pnpm --dir C:/src/personal/wfhelper-next-up exec prettier --write <your files>`, then `pnpm --dir C:/src/personal/wfhelper-next-up exec vitest run tests/renderer/lib/suggest/acquisition/plan/validate.test.ts tests/renderer/lib/suggest/acquisition/plan/prime.test.ts tests/renderer/lib/suggest/acquisition/tips`; fix your own failures.
10. Report one line per slug: `<slug>: ok, N tips, M disputes` plus `, override` and `, plan deleted` where they apply; then the store-material tips under each resource name; then suspect facts.

Boundaries: only your slugs' plan, tips and override files, and your own entries in `disputes.json`. No git, no edits to `resources.json`, code or tests, no subagents.

## Generated Primes

- `generatePrimePlan` output picks up tips through the same `tipsFor(name)` and anchors by group type (`fissure`, `vendor`, `currency`), which survive vault-state changes.
- `primeOverrides/<slug>.json` hold no tips; their `bonuses`/`conditions` are facts only. `plans/generated-prime-plans.md`: the migration writes leftover tips to `acquisitionTips/`, not overrides.

## Docs and skill

- `warframe-acquisition-research/SKILL.md`: the subagent also writes `C:/src/personal/wfhelper-next-up/src/data/suggest/acquisitionTips/<slug>.json`, additively (read it first, add new tips, raise consensus on new evidence, never delete, never re-add a `removed` text). Its write boundary names both files. An item with no plan yet gets no tips file; a Tips backfill mode writes it from `done/<slug>.md` once the plan ships. A Prune mode works the open disputes in `disputes.json`: it re-checks each against the wiki and Reddit, then either confirms (moves the tip to `removed`, sets the dispute `confirmed`) or rejects (sets `dismissed`).
- `AUTHORING.md`: Tips and Gotchas supply only hard requirements as conditions; never write tips into a plan; never edit `acquisitionTips/`.
- `VERIFY.md`: fact passes never touch `acquisitionTips/`. A fact that seems to contradict a tip becomes an open entry in `acquisitionTips/disputes.json` (skip it if a dismissed entry for that tip and claim exists).
