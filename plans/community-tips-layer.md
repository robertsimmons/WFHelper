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

- `src/lib/suggest/acquisition/tips/schema.ts`, `data.ts` (eager glob like `plan/data.ts`, `tipsFor(name)`), `anchor.ts` (`placeTips(plan, tips)` returns per-group tips plus the plan-level rest).
- `plan/resolve.ts`: `ResolvedGroup.tips`, `ResolvedPlan.tips` (unanchored), `ResolvedPlan.sentiment`. Works the same on a generated plan. Lands after the generated-Prime work, which owns `plan/*` now.
- Resource tips stay in `resources.json` `tips`, rendered on the material's farm group as today. Item tips files hold no material tips.
- `tips/validate.ts` plus `tests/renderer/lib/suggest/acquisition/tips/validate.test.ts` over every file: name resolves to an authored plan, a generated Prime from the fixture DBs, or a store key; enums real; text non-empty, unique, no em dash; every anchor matches a group (and row) in the item's plan; `removed` entries carry reason and a wiki URL; no live tip repeats a removed text.

## Fact or tip

- Stays in the plan: drop sources and rates, rotations, recipes, gates, vault state, extra reward sources (Circuit tiers), and any game rule that makes a run fail (Elite SO has no Khora parts; a scanned corpse gives no code).
- Moves to tips: what to bring, which node is fastest, squad behavior, booster stacking advice, bug workarounds, "the common wrong turn" framing, sentiment.
- Per field: `conditions` keep hard requirements, the rest become `gotcha`. `bonuses` keep extra sources, advice becomes `tactic` or `gear`. `disclosures` keep mechanics walkthroughs and alternative-route steps, strategy moves. `mode` keeps a hard constraint ("solo only"), else it becomes an anchored `tactic` and `mode` goes null. Row `note` and `meta` keep facts only.

## Rendering

- `src/components/nextup/plan/PlanTips.svelte`, shared by the plan page and the modal. Reuses the PlanGroup list and `<details>` markup.
- In `PlanGroup.svelte`, after conditions and bonuses: up to two `unanimous`/`common` tips inline with their own marker (`gotcha` in warning tone, others in accent), so a tip never reads as a `!` condition. The rest behind "more tips (N)".
- `AcquisitionPlanPage.svelte`: unanchored tips in a Tips block after the groups, same split. Sentiment in a collapsed "What players say" after that, above the currency ledger.
- `SuggestionDetailsModal.svelte`: one collapsed Tips disclosure under Routes, strongest first, sentiment last inside it.
- i18n keys: `nextUp.planTips`, `nextUp.planMoreTips`, `nextUp.planSentiment`. No tips file renders nothing.

## Migration, per item (fan-out, 16 plans per agent)

1. Read the current plan, `git -C C:/src/personal/wfhelper-next-up show ea2e4f31:src/data/suggest/acquisitionPlans/plan-<slug>.json` (absent means the plan is newer), and `C:/src/personal/wfhelper-research/done/<slug>.md` if it exists (most Primes have none).
2. Collect candidates: research Tips / "Tips people actually gave", Gotchas, Community sentiment (one or two `sentiment` tips); tip content from both plans' conditions, bonuses, disclosures, mode and notes.
3. A tip about a curated store material is not the item's: list it in your report under the resource name for the orchestrator to merge.
4. Dedupe: one tip per piece of advice, the most specific wording, the highest consensus seen. Plan-only tips with no weight are `some`.
5. Never drop a tip for being wrong: anything you think the wiki contradicts, or that describes patched behavior, stays and gets an open dispute in `disputes.json` with the wiki fact and URL. Drop only exact duplicates, generic advice ("do bounties") and calendar dates.
6. Set `kind`, `consensus`, `anchor` (required for every non-sentiment tip: the step or material it is about; a tip that fits no step is either sentiment or not worth keeping). Write `acquisitionTips/<slug>.json`.
7. Strip the moved content from the plan; change no fact. A fact that looks wrong goes in the report, not the plan.
8. `prettier --write` your files, run the plan and tips validate tests, fix your own failures.
9. Report one line per slug: `<slug>: ok, N tips, M removed`, then the store-material tips.

Relic Primes: migrate their tips from the current and pre-pass Prime plans before the generated-Prime pass deletes those files.

## Generated Primes

- `generatePrimePlan` output picks up tips through the same `tipsFor(name)` and anchors by group type (`fissure`, `vendor`, `currency`), which survive vault-state changes.
- `primeOverrides/<slug>.json` hold no tips; their `bonuses`/`conditions` are facts only. `plans/generated-prime-plans.md`: the migration writes leftover tips to `acquisitionTips/`, not overrides.

## Docs and skill

- `warframe-acquisition-research/SKILL.md`: the subagent also writes `C:/src/personal/wfhelper-next-up/src/data/suggest/acquisitionTips/<slug>.json`, additively (read it first, add new tips, raise consensus on new evidence, never delete, never re-add a `removed` text). Its write boundary names both files. A Prune mode works the open disputes in `disputes.json`: it re-checks each against the wiki and Reddit, then either confirms (moves the tip to `removed`, sets the dispute `confirmed`) or rejects (sets `dismissed`).
- `AUTHORING.md`: Tips and Gotchas supply only hard requirements as conditions; never write tips into a plan; never edit `acquisitionTips/`.
- `VERIFY.md`: fact passes never touch `acquisitionTips/`. A fact that seems to contradict a tip becomes an open entry in `acquisitionTips/disputes.json` (skip it if a dismissed entry for that tip and claim exists).
