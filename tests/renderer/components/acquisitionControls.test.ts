/// <reference types="node" />

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ACQUISITION_INCLUDES,
  ACQUISITION_INCLUDE_GROUPS,
} from "../../../src/lib/suggest/acquisition/kinds.js";

// Vitest has no Svelte plugin, so the component is read as source. Resolved
// from this file rather than the cwd, which in a worktree is the other checkout.
const ROW = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "src",
  "components",
  "nextup",
  "controls",
  "AcquisitionControls.svelte",
);

const row = (): string => fs.readFileSync(ROW, "utf8");

describe("AcquisitionControls", () => {
  it("draws the row from the shipped groups and names no membership itself", () => {
    expect(row()).toContain("{#each ACQUISITION_INCLUDE_GROUPS as group (group.id)}");
    for (const include of ACQUISITION_INCLUDES) {
      expect(row()).not.toContain(`"${include}"`);
    }
    for (const group of ACQUISITION_INCLUDE_GROUPS) {
      expect(row()).not.toContain(`"${group.id}"`);
    }
  });

  it("gives a group with one include a toggle and every other one a dropdown", () => {
    expect(row()).toContain("{@const plain = group.include}");
    expect(row()).toContain("{#if plain}");
    expect(row()).toContain("aria-pressed={selected.includes(plain)}");
    expect(row()).toContain('aria-haspopup="true"');
    expect(row()).toContain("aria-expanded={open === group.id}");
  });

  it("counts a dropdown against its own members, never against the whole row", () => {
    expect(row()).toContain("{count}/{group.members.length}");
    expect(row()).toContain(
      "group.members.filter((member) => selected.includes(member.include)).length",
    );
    // Only warframes is a plain toggle, so four buttons carry a count.
    expect(ACQUISITION_INCLUDE_GROUPS.filter((group) => group.include === null)).toHaveLength(4);
  });

  it("reads an empty selection as every kind rather than as none", () => {
    expect(row()).toContain("options.acquisitionKinds.length > 0");
    expect(row()).toContain("? options.acquisitionKinds");
    expect(row()).toContain(": ACQUISITION_INCLUDES");
  });

  it("stores the empty list at both ends, so no toggle can empty the section", () => {
    expect(row()).toContain(
      "const all = next.length === 0 || next.length === ACQUISITION_INCLUDES.length;",
    );
    expect(row()).toContain('setSuggestionOption("acquisitionKinds", all ? [] : next);');
  });

  it("offers one global clear for the whole row rather than one per dropdown", () => {
    expect(row()).toContain("function toggleAll()");
    expect(row()).toContain(
      'setSuggestionOption("acquisitionKinds", selected.length === 0 ? [] : [ACQUISITION_NONE]);',
    );
    const panel = row().slice(row().indexOf("data-acquisition-group-panel"));
    expect(panel).not.toContain("toggleAll");
  });

  it("labels the clear by what the click will do, so neither label can lie", () => {
    expect(row()).toContain('{$tr(selected.length === 0 ? "common.all" : "common.none")}');
  });

  it("draws the counts off a cleared selection as zeroes rather than as every box", () => {
    expect(row()).toContain("options.acquisitionKinds.includes(ACQUISITION_NONE)");
    expect(row()).toContain("      ? []");
    // The reserved include reaches the row by name, never spelled out.
    expect(row()).toContain("    ACQUISITION_NONE,");
  });

  it("keeps the sort control and all four modes it offers", () => {
    expect(row()).toContain("<SortControl");
    for (const mode of ["recommended:", "difficulty:", "tier:", "plat:"]) {
      expect(row()).toContain(mode);
    }
  });

  it("leaves a kind hook outside the dropdowns for the latency probe to click", () => {
    const toggle = row().slice(row().indexOf("{#if plain}"));
    expect(toggle.slice(0, toggle.indexOf("{:else}"))).toContain("data-acquisition-kind={plain}");
  });

  it("closes an open dropdown on Escape and on a click outside it", () => {
    expect(row()).toContain('if (event.key !== "Escape" || open === null) return;');
    expect(row()).toContain('target.closest("[data-acquisition-group]")');
    expect(row()).toContain("panel?.contains(target)");
  });
});
