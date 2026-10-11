# Landscape maps and pins

No source beats the wiki Map: JSON. It is the only one found with real coordinates; no community interactive map or GitHub marker repo turned up. Fetch with `curl "https://wiki.warframe.com/index.php?title=Map:<Region>&action=raw"` (plain JSON, no auth, no user-agent needed).

## Wiki Map: pages
Pages that exist (API `allpages`, namespace 2900): Map:Plains of Eidolon, Map:Orb Vallis, Map:Cambion Drift, Map:Duviri, Map:Madurai.

Format: `mapImage` (file on the wiki), `mapBounds` [[0,0],[4000,4000]], `coordinateOrder` "xy", `origin` "bottom-left", `categories[]` (id, name), `markers[]` ({ categoryId, position: [x, y], popup: { title, description, link }, id }). Base images: `PlainsofEidolon 4k Map.png`, `OrbVallis4kMap-min.png`, `CambianDrift4kMap.png`; Duviri's is in its `mapImage` field. The images are clean base maps; marker icons are drawn by the viewer. Wiki text is CC BY-SA (footer mentions CC BY); credit the wiki.

## Coverage per landscape
**Plains of Eidolon: covers the fish, but unnamed.** Category `thousand_year_fish` has 20 markers, all titled "Thousand-Year Fish" with no per-fish name. All 18 of our fish are covered once each marker is named. Naming comes from the wiki's lettered map (`ThousandYearFishPostNewWar.png`, post-New War, 2024-12) whose letters key to names on the Thousand-Year Fish page. Marker order in the JSON equals letter order A to T; I verified all 20 by fitting the lettered image to the 4k grid (x = 3148 + (px - 1084) * 2.63, y = 352 + (1270 - py) * 2.65, every marker within about 35 units). Two extra markers (P Ostron Patois, Q Scavenging Way of Life) are not in our 18; drop or keep unreferenced.

| Letter | Item | position [x, y] |
|---|---|---|
| A | Ancient History | [3148, 352] |
| B | The Unum | [3195, 1635] |
| C | Amps | [3042, 2032] |
| D | Life In Cetus | [3262, 2542] |
| E | Cetus | [3402, 3052] |
| F | The Quills of Cetus | [2378, 3112] |
| G | Plains Animals | [2288, 3400] |
| H | The Tower's Flesh | [1834, 3168] |
| I | Grineer Excavations | [1190, 3307] |
| J | Merchants of Cetus | [941, 3338] |
| K | Remnants of Orokin | [710, 2637] |
| L | The Ostrons | [1389, 2572] |
| M | The Grineer Tusks | [545, 2162] |
| N | Tools of Harvest | [638, 1104] |
| O | Ostron Artisans | [960, 698] |
| P | Ostron Patois (not ours) | [1322, 500] |
| Q | Scavenging Way of Life (not ours) | [1540, 1284] |
| R | Plains of Eidolon | [2236, 1903] |
| S | Harvesting The Tower | [1747, 1825] |
| T | Teralyst Eidolon | [951, 1438] |

Caves (C, D, Q, T) also appear as `cave` markers in the same file. Authoring needed: none for fish, beyond adding the letter-to-name table above. Eidolon lore fragments beyond the fish: no markers.

**Orb Vallis: partial.** 7 categories of "Mem Fragments" (Eudico, Legs, Little Duck, Rude Zuud, Smokefinger, The Business, Ticker; 5 each, 35 markers, titled "<Name>'s Mem Fragment n/5", some with a note like "Inside cave", linking to Fragments/Solaris United). These are the Solaris United conversation memory fragments, not the codex lore scans. There are no Somachord or Fortuna codex-object markers. Somachords: the wiki page Somachord Tones only has a spawn image (`OrbVallisSomachordSpawns.jpeg`, no coordinates; original tones are random, post-New War tones fixed with no coordinates). Authoring needed for every Orb Vallis Somachord and Fortuna lore scan.

**Cambion Drift: nothing scannable.** Categories are blinkpads, K-Drive races, Requiem obelisks, Mother boards and vaults. No fragments, tones or codex objects. Authoring needed for all Deimos lore on the Drift.

**Duviri: Somachords and fragments covered.** 10 named Somachord markers (Below The Thunder, Unbound, Drifter's Respite, Paragrimm Ascending, Perdition's Coils, Shadows And Summoning, He Who Waits, Into Madness, Eyes That Burn, Duviri Paradox; titles end in " Somachord"). Also 9 fragment groups of 9 markers each titled "<Area> Fragment N n" (Scholar's Landing, We are not what we were, Watcher's Island, Lake Veruna, The Galleria, The Doll Mausoleum, The Caves of Academe, Manipura Island, The Island of Lorn, The Bleeding Earth), plus owl puzzles, shawzin stages, fishing, cave entrances. Check whether our snapshot treats those as scannables; snapshot.json has no "Somachord" name, so tones may not be tracked yet. Match marker titles to snapshot names; authoring needed only for names that do not match.

## Other sources checked
- Wiki Thousand-Year Fish page: lettered maps `ThousandYearFishPostNewWar.png` (1288x1294) and `MapTYF_way.jpg` (2021x2021, pre-New War). No coordinates. Useful only as the letter key.
- Forum post, Orb Vallis 3000x3000 annotated map (caves, fishing, toroids, K-Drive): https://forums.warframe.com/topic/1029502-orb-vallis-map-high-res-caves-fishing-toroids-mining-k-drive-races-marked/ . Static image from 2018, pre-New War, no fragment data.
- Fandom wiki pages and the Fragments pages carry text descriptions only.

## Authoring fallback
Not needed for the fish. Hand-authoring from descriptions alone would be poor (descriptions are relative, "south-east coast", and several fish moved after New War); tracing from the lettered image reached about 35 units on the 4000 grid, which is under 1 percent of the map. For missing Orb Vallis and Cambion items, author on the same grid by reading position off the wiki 4k image and offering only region-level accuracy.
