import { REDUCED_MOTION } from "./rewardArt.js";

/** The card's own transition duration, so the flight belongs to the same set.
 *  Zero under reduced motion: Svelte 5 animates through the Web Animations API,
 *  which the stylesheet's reduced-motion rule cannot reach. */
export const FLIGHT_MS = REDUCED_MOTION ? 0 : 200;

/** The easing every transition in the feed already runs on. */
const EASING = "cubic-bezier(0.4, 0, 0.2, 1)";

/** Over the page, under the modal layer. */
const FLIGHT_Z = "900";

const MARKERS = ["data-suggestion-card", "data-suggestion-reward", "data-acquisition-pin"];

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CardFlight {
  /** Lands the copy on `target`, or fades it out where it stands when what it
   *  moved into is not on screen. */
  settle: (target: Element | null) => void;
}

const STILL: CardFlight = { settle: () => {} };

function box(node: Element): Box {
  const { left, top, width, height } = node.getBoundingClientRect();
  return { left, top, width, height };
}

/** The transform that lays a box sitting at `self` over `target`, measured from
 *  its own top left. */
function onto(self: Box, target: Box): string {
  const x = target.left - self.left;
  const y = target.top - self.top;
  return `translate(${x}px, ${y}px) scale(${target.width / self.width}, ${target.height / self.height})`;
}

function grow(node: Element, from: Box): void {
  const to = box(node);
  node.animate(
    [
      { transformOrigin: "top left", transform: onto(to, from), opacity: 0 },
      { transformOrigin: "top left", transform: "none", opacity: 1 },
    ],
    { duration: FLIGHT_MS, easing: EASING },
  );
}

/**
 * Takes a copy of the node onto a layer of its own, frozen where it stands, so
 * the grid reflows under it the moment the click lands rather than when the
 * flight ends.
 */
export function liftCard(node: Element | null | undefined): CardFlight {
  if (!node || FLIGHT_MS === 0) return STILL;
  const from = box(node);
  const copy = node.cloneNode(true) as HTMLElement;
  // The copy carries the card's buttons and its own tab stop with it, and a
  // copy still in flight must not answer a lookup for the real thing.
  copy.setAttribute("inert", "");
  for (const marker of MARKERS) copy.removeAttribute(marker);
  copy.style.position = "fixed";
  copy.style.left = `${from.left}px`;
  copy.style.top = `${from.top}px`;
  copy.style.width = `${from.width}px`;
  copy.style.height = `${from.height}px`;
  copy.style.margin = "0";
  copy.style.pointerEvents = "none";
  copy.style.transformOrigin = "top left";
  copy.style.zIndex = FLIGHT_Z;
  document.body.append(copy);
  return {
    settle(target: Element | null): void {
      const to = target ? box(target) : null;
      const run = copy.animate(
        [
          { transform: "none", opacity: 1 },
          { transform: to ? onto(from, to) : "none", opacity: 0 },
        ],
        { duration: FLIGHT_MS, easing: EASING, fill: "forwards" },
      );
      const clear = (): void => copy.remove();
      run.onfinish = clear;
      run.oncancel = clear;
      if (target) grow(target, from);
    },
  };
}

export function pinnedNode(uniqueName: string): Element | null {
  return document.querySelector(`[data-acquisition-pin=${JSON.stringify(uniqueName)}]`);
}

export function suggestionNode(uniqueName: string): Element | null {
  return document.querySelector(
    `[data-suggestion-card="acquisition"][data-suggestion-reward=${JSON.stringify(uniqueName)}]`,
  );
}
