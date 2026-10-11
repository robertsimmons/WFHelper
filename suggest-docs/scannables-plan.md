# Scannables places band

The Next Up scans section's non-Simulacrum view: one card per place, ranked by how much codex progress one run there gives.

## Rules

- **Filter:** the scans switcher is Simulacrum, All, Somachords, Fragments, Prex, Frame Fighter, Objects. All is the default non-Simulacrum view. A filter decides which groups count toward a place; a place with nothing left under the filter drops.
- **Groups:** `somachords`, `fragments` (lore fragments minus Prex), `prex` (lore fragments under the Prex cards type path), `frameFighter`, `objects` (objects and plants).
- **Missing:** `missingScannables` as today. Completed items drop after the next refresh.
- **Place:** an authored entry in `src/data/scannables/places.json`. Kinds: `landscape`, `planet`, `tileset`, `stop` (no mission needed), `drop` (kill or bounty drop).
- **Pool:** a place lists its items in pools. A pool's expected scans per run is `min(cap ?? Infinity, sum over missing items of min(remaining, perItem))`. A place's yield is the sum over its pools, counting only filtered groups.
- **Rank:** stops first, then yield descending, then fixed spots before random rolls, then fewer left.
- **Unplaced:** a missing item no place lists goes on a final "No known source" card. Nothing is hidden.
- **No prose:** facts render as chips, counts and short labels. Steps are terse imperatives, modal only.

## Data

`places.json` is an array of:

```ts
interface ScannablePlace {
  id: string;                // kebab-case
  name: string;              // "Plains of Eidolon"
  kind: "landscape" | "planet" | "tileset" | "stop" | "drop";
  art: string | null;        // assets/scannables/<art>.webp key
  mapKey: string | null;     // shared map key, e.g. "plains-of-eidolon"
  run: string;               // card label, <= 32 chars: "Capture · any Jupiter node"
  gear: string[];            // chip labels: "Helios + Investigator"
  steps: string[];           // modal only, each <= 60 chars
  gates: string[];           // "Nova Rank 30", "The New War"
  fixed: boolean;            // fixed spots (true) or random rolls (false)
  wiki: string | null;
  pools: { group: Group; types: string[]; perItem: number; cap: number | null }[];
}
```

`types` are codex type paths. Map pins follow the shared map format in `src/data/maps/pins/scannables-<mapKey>.json`: `{ id, position: [x, y], kind, label, refs, note }` on the wiki's 4000x4000 bottom-left grid, `refs` the codex type paths.

## Card

```
┌────────────────────────────┐
│ [place art]                │
│ Plains of Eidolon          │
├────────────────────────────┤
│ 27 left · ~26 per run      │
│ Free roam from Cetus       │
│ [Helios + Investigator]    │
│ [Fish 18] [Obj 8] [Soma 1] │
│ wiki                  ▸    │
└────────────────────────────┘
```

Click opens a modal: gates, steps, then every missing item as a tile grouped by group, with scans and wiki link. The pinned map joins the modal top when the shared MapView lands.

## Files

- `src/data/scannables/places.json`, `assets/scannables/*.webp`, `src/data/maps/pins/scannables-*.json`: authored from `suggest-docs/scannables/research/`.
- `src/lib/suggest/scannablePlaces.ts`: the pure engine `(missing, places, groups) => ScannablePlaceCard[]`.
- `tests/renderer/lib/suggest/scannablePlaces.test.ts`.
