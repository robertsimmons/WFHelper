/// <reference types="node" />

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { sectionNarrowed } from "../../../src/components/nextup/sectionFilters.js";
import {
  ACQUISITION_INCLUDES,
  ACQUISITION_NONE,
} from "../../../src/lib/suggest/acquisition/kinds.js";
import { DEFAULT_OPTIONS } from "../../../src/lib/suggest/preferences.js";
import {
  MASTERY_KINDS,
  RELIC_ERAS,
  SUGGESTION_SECTION_IDS,
  TASK_KINDS,
  type SuggestionOptions,
} from "../../../src/types/suggest.js";

// Vitest has no Svelte plugin, so both components are read as source. Resolved
// from this file rather than the cwd, which in a worktree is the other checkout.
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "src");

const view = (): string => fs.readFileSync(path.join(SRC, "views", "NextUpView.svelte"), "utf8");
const section = (): string =>
  fs.readFileSync(path.join(SRC, "components", "nextup", "SuggestionSection.svelte"), "utf8");

function options(overrides: Partial<SuggestionOptions>): SuggestionOptions {
  return { ...DEFAULT_OPTIONS, ...overrides };
}

describe("sectionNarrowed", () => {
  it("reads the shipped selection as narrowing nothing, section by section", () => {
    for (const id of SUGGESTION_SECTION_IDS) {
      expect(sectionNarrowed(id, DEFAULT_OPTIONS), id).toBe(false);
    }
  });

  it("reads an empty selection as every kind rather than as a narrowing", () => {
    expect(
      sectionNarrowed(
        "acquisition",
        options({ acquisitionKinds: [], masteryKinds: [], relicEras: [], taskKinds: [] }),
      ),
    ).toBe(false);
    expect(sectionNarrowed("tasks", options({ taskKinds: [] }))).toBe(false);
    expect(sectionNarrowed("relics", options({ relicEras: [] }))).toBe(false);
    expect(sectionNarrowed("mastery", options({ masteryKinds: [] }))).toBe(false);
  });

  it("sees a section narrowed to part of its list", () => {
    expect(sectionNarrowed("tasks", options({ taskKinds: [TASK_KINDS[0]] }))).toBe(true);
    expect(sectionNarrowed("relics", options({ relicEras: [RELIC_ERAS[0]] }))).toBe(true);
    expect(sectionNarrowed("mastery", options({ masteryKinds: [MASTERY_KINDS[0]] }))).toBe(true);
    expect(
      sectionNarrowed("acquisition", options({ acquisitionKinds: [ACQUISITION_INCLUDES[0]!] })),
    ).toBe(true);
  });

  it("sees the acquisition row turned off whole", () => {
    expect(sectionNarrowed("acquisition", options({ acquisitionKinds: [ACQUISITION_NONE] }))).toBe(
      true,
    );
  });

  it("answers for one section from its own controls only", () => {
    const narrowed = options({ taskKinds: [TASK_KINDS[0]] });
    expect(sectionNarrowed("relics", narrowed)).toBe(false);
    expect(sectionNarrowed("acquisition", narrowed)).toBe(false);
    expect(sectionNarrowed("mastery", narrowed)).toBe(false);
  });
});

describe("NextUpView", () => {
  it("keeps a section its own controls emptied, and drops one the world emptied", () => {
    expect(view()).toContain(
      "row.suggestions.length > 0 || sectionNarrowed(row.section.id, options)",
    );
  });

  it("falls back to the page-wide empty state only where nothing is drawn at all", () => {
    expect(view()).toContain("{#if shown.length === 0 && pinned.length === 0}");
  });
});

describe("SuggestionSection", () => {
  it("flags a section with no cards so the column can tell it apart", () => {
    expect(section()).toContain('data-section-empty={empty ? "" : undefined}');
  });

  it("splits the column between the sections drawing cards, never an empty one", () => {
    expect(section()).toContain(
      'kid.hasAttribute("data-suggestion-section") && !kid.hasAttribute("data-section-empty")',
    );
    expect(section()).toContain("kids.filter(grows).length");
    expect(section()).toContain("kids\n        .filter((kid) => !grows(kid))");
  });

  it("re-measures when a section empties without the column gaining a child", () => {
    expect(section()).toContain('attributeFilter: ["data-section-empty"]');
  });

  it("draws one line in place of the grid, with the header and controls above it", () => {
    expect(section()).toContain("{#if !collapsed && empty}");
    expect(section()).toContain("data-section-empty-note={id}");
    // The controls are the only way back out of an emptied section.
    expect(section()).toContain("{#if !collapsed}\n      <Controls />");
  });
});
