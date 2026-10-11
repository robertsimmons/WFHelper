Scannables research brief

You research ONE scannable group for a Warframe helper app whose north star is ELI5 instructions: go here, do this, then that. The app will turn your file into cards that tell the player where to go for the most codex progress per run. The app links the wiki per item, so never re-teach it.

The group's missing items for this player are in `C:\src\personal\wfhelper-next-up\suggest-docs\scannables\snapshot.json` (find your group or `subset`). Cover every missing item by its exact name there. Read the group's completed items too only if it helps describe spawn rules.

Method

Follow the "Reddit access", "Fetching" and "Method" rules of `C:\Users\rober\.claude\skills\warframe-acquisition-research\SKILL.md` exactly (safereddit.com via plain curl, no user-agent header, one command per Bash call, save pages under `C:/Users/rober/.claude/robotron/scratch/wf/scannables-<slug>/`, check every fact against wiki.warframe.com, resolve rather than flag, write timeless). Its "Tips file" section does not apply: write no tips file.

Answer, per item: where it spawns (tileset, landscape, specific node or room), how it is found (random spawn point, fixed spot, behind a puzzle, dropped by an enemy, bought, given by a quest), how many scans complete it, and anything that hides or voids it (only spawns while incomplete, one per mission, needs a quest done, needs a scanner type). Per place: which planets or nodes host that tileset, the best mission type to run there (short, solo-friendly, lets you explore), and how many missing items one run can realistically yield. Gear that changes the math (Helios with Investigator, Synthesis or Codex Scanner, Loki, Ivara, Thief's Wit, Animal Instinct, Kavat Survival Instinct, Loot Detector) belongs in Gear with consensus weight.

Output template

```markdown
# <Group>

<One line: what these are and what completing them gives.>

**Pain level: <blunt>.** <Why, naming the real bottleneck.>

## Gates
<Quest, MR or standing gates, one per line. Nothing else.>

## Gear
<Frame, companion, scanner or mod that halves the hunt, with consensus weight.>

## Places
### <Place name>: <planets or nodes that host it>. Yield <N per run>.
- Best run: <node, planet, mission type, and why>.
1. <Go here. Do this specific thing.>
2. <Then this. Include the step people get wrong.>
- Items here: <exact names>.

## Items
| Item | Place | How to find it | Scans |
|---|---|---|---|

## Gotchas

## Community sentiment

**Sources:** <threads and wiki pages>
```

Drop sections with nothing real in them. Write only your output file. Return two lines: the file path and the single most useful finding, plus a line `unplaced: <N>` counting items you could not place.
