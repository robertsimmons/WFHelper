/// <reference types="node" />

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Vitest has no Svelte plugin, so the component is read as source. Resolved
// from this file rather than the cwd, which in a worktree is the other checkout.
const CARD = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "src",
  "components",
  "nextup",
  "SuggestionCard.svelte",
);

const card = (): string => fs.readFileSync(CARD, "utf8");

describe("SuggestionCard acquisition face", () => {
  it("draws ten fixed segments so two meters read against each other", () => {
    expect(card()).toContain("const EFFORT_STEPS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];");
    expect(card()).toContain("{#each EFFORT_STEPS as step (step)}");
    expect(card()).toContain("h-1 flex-1 rounded-[1px]");
  });

  it("leaves an unrated meter empty rather than lighting anything", () => {
    expect(card()).toContain("effort !== null && step <= effort");
    expect(card()).toContain("EFFORT_TRACK");
  });

  it("puts no number and no word on the meter", () => {
    const meter = card().slice(card().indexOf('<span class="flex flex-1 gap-[2px]"'));
    expect(meter.slice(0, meter.indexOf("</span>"))).not.toMatch(/>\s*\{?\w/);
  });

  it("takes its colours from the effort tokens, never a raw hex", () => {
    for (const token of ["--effort-light", "--effort-fair", "--effort-heavy", "--effort-grim"]) {
      expect(card()).toContain(`bg-[color:var(${token})]`);
    }
  });

  it("reads ready in the success colour and counts in the unit it is given", () => {
    expect(card()).toContain("read.ready ? 'text-success' : 'text-text-primary'");
    expect(card()).toContain("read.unitKey ? $tr(read.unitKey)");
  });

  it("hangs the badge in the art band, under the tier and over the art", () => {
    expect(card()).toContain("{#if badge}");
    expect(card()).toContain("absolute bottom-1 right-1 z-[2]");
    expect(card()).toContain("{badge.text}");
  });

  it("tones the badge off the plan rather than off one fixed colour", () => {
    expect(card()).toContain("const BADGE_TONE: Record<PlanBadgeTone, string>");
    for (const tone of ["circuit: ", "info: ", "warn: "]) {
      expect(card()).toContain(tone);
    }
    expect(card()).toContain("{BADGE_TONE[badge.tone]}");
  });

  it("offers Work on this only once a handler is passed", () => {
    expect(card()).toContain("{#if onWorkOnThis}");
    expect(card()).toContain("onclick={clickWorkOnThis}");
  });

  it("leaves the handler's own behaviour to whoever passes it", () => {
    expect(card()).not.toMatch(/\bpin(ned|Store)?\b/i);
  });

  it("keeps every addition behind the acquisition face", () => {
    // A Tasks, Relics or Mastery card has no acquisition target, so the read is
    // null, the face is false, and the body renders the rows it always did.
    expect(card()).toContain("const target = $derived(details?.acquisition ?? null);");
    expect(card()).toContain("$derived(target !== null || suppliedRead != null)");
    expect(card()).toContain("{#if acquisitionFace}");
    expect(card()).toContain("{#if read}");
  });

  it("still draws the bar and the run counter for a card with no face", () => {
    expect(card()).toContain(
      'class="mt-auto grid h-6 grid-cols-[minmax(0,1fr)_2.25rem_1.5rem] items-center gap-x-2"',
    );
    expect(card()).toContain('<div class="h-full rounded-full bg-accent"');
    expect(card()).toContain("{progress.current}/{progress.required}");
  });

  it("adds nothing to the props every section already passes", () => {
    for (const optional of ["partsRead?:", "effort?:", "badge?:", "onWorkOnThis?:"]) {
      expect(card()).toContain(optional);
    }
  });
});
