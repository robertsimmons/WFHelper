import type { NightwaveArt } from "./preferences.js";
import type { SuggestionCategory } from "../../types/suggest.js";

export interface BannerArt {
  url: string;
  /** CSS object-position; the band crops whatever falls outside it. */
  position: string;
  fit: "cover" | "contain";
}

function banner(url: string, position: string): BannerArt {
  return { url, position, fit: "cover" };
}

const DESCENDIA = banner(
  new URL("../../../assets/nextup/descendia.webp", import.meta.url).href,
  "50% 0%",
);

const NIGHTWAVE: Record<NightwaveArt, BannerArt> = {
  amir: banner(
    new URL("../../../assets/nextup/nightwave-amir.webp", import.meta.url).href,
    "50% 15%",
  ),
  nora: banner(
    new URL("../../../assets/nextup/nightwave-nora.webp", import.meta.url).href,
    "0% 20%",
  ),
};

const TASK_ART: Record<string, BannerArt> = {
  kahl: banner(new URL("../../../assets/nextup/kahl.webp", import.meta.url).href, "100% 0%"),
  deepArchimedea: banner(
    new URL("../../../assets/nextup/deep-archimedea.webp", import.meta.url).href,
    "100% 50%",
  ),
  temporalArchimedea: banner(
    new URL("../../../assets/nextup/temporal-archimedea.webp", import.meta.url).href,
    "100% 0%",
  ),
  descendiaNormal: DESCENDIA,
  descendiaSteelPath: DESCENDIA,
  dailyFocus: {
    url: new URL("../../../assets/nextup/daily-focus.webp", import.meta.url).href,
    position: "50% 50%",
    fit: "contain",
  },
};

/** Art for the tasks whose reward no item picture can stand for. */
export function bannerFor(
  id: string,
  category: SuggestionCategory,
  nightwave: NightwaveArt,
): BannerArt | null {
  if (category === "nightwave") return NIGHTWAVE[nightwave];
  return TASK_ART[id.replace(/^dailies:/, "")] ?? null;
}

/** The reward art sits clear of whatever the banner is anchored on. */
export function bannerAside(art: BannerArt | null): string {
  if (art?.position.startsWith("100%")) return "justify-start";
  if (art?.position.startsWith("0%")) return "justify-end";
  return "justify-center";
}
