import type { NightwaveArt } from "./preferences.js";
import type { SuggestionCategory } from "../../types/suggest.js";

interface BannerArt {
  url: string;
  /** CSS object-position; the band crops whatever falls outside it. */
  position: string;
  fit: "cover" | "contain";
  /** Overrides the side `bannerAside` infers, for art whose subject does not
   *  sit on the edge the anchor pulls towards. */
  aside?: "start" | "end" | "center";
  /** Px of picture hung off one edge and cropped. The art is a hair narrower
   *  than the band it covers, so `position` alone can move nothing: widening it
   *  slides the subject sideways (positive keeps the left edge, negative the
   *  right) and overflows the fixed height, which is what gives `position`'s y
   *  something to pan over. */
  widen?: number;
}

function banner(
  url: string,
  position: string,
  aside?: BannerArt["aside"],
  widen?: number,
): BannerArt {
  return {
    url,
    position,
    fit: "cover",
    ...(aside ? { aside } : {}),
    ...(widen ? { widen } : {}),
  };
}

/** What the portraits whose subject sat under the reward art needed to clear it. */
const NUDGE_RIGHT = 30;

const DESCENDIA = banner(
  new URL("../../../assets/nextup/descendia.webp", import.meta.url).href,
  "50% 0%",
);

const NIGHTWAVE: Record<NightwaveArt, BannerArt> = {
  // Taller than the band, so the crop is vertical only and the face keeps the
  // right half of every width.
  amir: banner(
    new URL("../../../assets/nextup/nightwave-amir.webp", import.meta.url).href,
    "50% 15%",
    "start",
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
  archonHunt: banner(
    new URL("../../../assets/nextup/archon-hunt.webp", import.meta.url).href,
    "100% 50%",
  ),
  netracells: banner(
    new URL("../../../assets/nextup/netracells.webp", import.meta.url).href,
    "0% 50%",
  ),
  bird3: banner(new URL("../../../assets/nextup/bird3.webp", import.meta.url).href, "100% 50%"),
  simaris: banner(new URL("../../../assets/nextup/simaris.webp", import.meta.url).href, "50% 50%"),
  sortie: banner(new URL("../../../assets/nextup/sortie.webp", import.meta.url).href, "0% 50%"),
  // Closed in on the lit console along the bottom, which is this banner's
  // subject the way a vendor's portrait is theirs.
  syndicateStanding: banner(
    new URL("../../../assets/nextup/syndicate-standing.webp", import.meta.url).href,
    "50% 100%",
    undefined,
    110,
  ),
  steelPathHonors: banner(
    new URL("../../../assets/nextup/steel-path-honors.webp", import.meta.url).href,
    "100% 50%",
  ),
  ayatanHunt: banner(
    new URL("../../../assets/nextup/ayatan-hunt.webp", import.meta.url).href,
    "100% 50%",
    undefined,
    NUDGE_RIGHT,
  ),
  calendar1999: banner(
    new URL("../../../assets/nextup/calendar-1999.webp", import.meta.url).href,
    "0% 50%",
    "start",
    NUDGE_RIGHT,
  ),
  codaWeapons: banner(
    new URL("../../../assets/nextup/coda-weapons.webp", import.meta.url).href,
    "0% 50%",
  ),
  tenetMelee: banner(
    new URL("../../../assets/nextup/tenet-melee.webp", import.meta.url).href,
    "100% 50%",
  ),
  baro: banner(new URL("../../../assets/nextup/baro.webp", import.meta.url).href, "100% 50%"),
  darvo: banner(new URL("../../../assets/nextup/darvo.webp", import.meta.url).href, "0% 50%"),
  clem: banner(new URL("../../../assets/nextup/clem.webp", import.meta.url).href, "100% 50%"),
  acrithis: banner(
    new URL("../../../assets/nextup/acrithis.webp", import.meta.url).href,
    "100% 50%",
    undefined,
    NUDGE_RIGHT,
  ),
  yonta: banner(
    new URL("../../../assets/nextup/yonta.webp", import.meta.url).href,
    "100% 50%",
    undefined,
    NUDGE_RIGHT,
  ),
  palladino: banner(
    new URL("../../../assets/nextup/palladino.webp", import.meta.url).href,
    "100% 50%",
    undefined,
    NUDGE_RIGHT,
  ),
  varzia: banner(new URL("../../../assets/nextup/varzia.webp", import.meta.url).href, "100% 30%"),
};

/** The Cred shop is Nora's too, and its provider files those cards under the
 *  vendor category rather than her own. */
const NIGHTWAVE_SHOP = /^nightwave:/;

/** Art for the tasks whose reward no item picture can stand for. */
export function bannerFor(
  id: string,
  category: SuggestionCategory,
  nightwave: NightwaveArt,
): BannerArt | null {
  if (category === "nightwave" || NIGHTWAVE_SHOP.test(id)) return NIGHTWAVE[nightwave];
  // The table is keyed by tracker task id; every provider prefixes its own name.
  return TASK_ART[id.replace(/^[^:]+:/, "")] ?? null;
}

/** The reward art sits clear of whatever the banner is anchored on. */
export function bannerAside(art: BannerArt | null): string {
  if (art?.aside) return `justify-${art.aside}`;
  if (art?.position.startsWith("100%")) return "justify-start";
  if (art?.position.startsWith("0%")) return "justify-end";
  return "justify-center";
}
