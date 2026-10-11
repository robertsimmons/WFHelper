Scannables snapshot

Regenerate with `node suggest-docs/scannables/snapshot.mjs` (runs the app's own `buildCodexRows` + `missingScannables` through jiti). Full lists in `snapshot.json`.

Sources: `%APPDATA%\WFHelper\codex-scans.json` (profile scans, fetched 2026-10-09) and `%APPDATA%\WFHelper\api-helper\inventory.json` (`LoreFragmentScans`, 113 rows).

| Group | Missing / total | Location data on missing entries | Images | Wiki URL |
|---|---|---|---|---|
| objects (objects + plants) | 83 / 175 | none | all | none |
| somachords | 51 / 86 | 15 partial scans carry the region they were scanned in; 36 nothing | 1 of 51 | none |
| fragments | 161 / 179 | 125 wiki `planet` text; 36 nothing | 145 of 161 | 125 |
| frameFighter | 18 / 44 | none | all | none |

Fragment sub-sets (by type-path directory), missing / total: Cephalon classic 37/43, Fortuna (Solaris) 34/35, Prex cards 25/25, Eidolon 18/20, Ghoul 13/13, Corpus Relief 10/11, Duviri 10/10, Gas City 8/8, Albrecht 5/5, Duviri MITW 1/1, Revenant 0/3, Glass 0/5. Kuria and Zariman have no fragment entries in the lore section.

Location reality:
- Wiki `planet` exists only on fragments and is free text mixing planets, landscapes and tilesets ("Venus (Orb Vallis)", "Albrecht's Laboratories", "Those with Corpus Ship tile set", "Isleweaver"). It needs normalising before it can pick a node.
- Inventory `Region` is where the player scanned it, so it exists only for entries already scanned (fully or partially). It never locates a never-scanned entry.
- No source states a tileset or node for any fragment, Somachord, object or Frame Fighter card. Prex cards, Duviri fragments, all Somachords, objects and Frame Fighter need authored "where to go".
- `ExportCodex.json` is present at `node_modules/warframe-public-export-plus/ExportCodex.json` (sections objects, loreFragments, songs, fighterFrames; fields name, reqScans, icon, description, secret...). It has no location fields. It is not in the app's userData cache; `public-export-cache.json` holds only warframes/weapons/sentinels/recipes/resources/relics.
- 12 objects have no stated requirement (plants), so they read missing until first scan.
