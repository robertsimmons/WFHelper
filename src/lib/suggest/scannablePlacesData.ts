import placesJson from "../../data/scannables/places.json";
import { parsePlaces, type ScannablePlace } from "./scannablePlaces.js";

const ART_DIR = "../../../assets/scannables/";

const ART = import.meta.glob<string>("../../../assets/scannables/*", {
  eager: true,
  query: "?url",
  import: "default",
});

export const SCANNABLE_PLACES: readonly ScannablePlace[] = parsePlaces(placesJson);

export function placeArtUrl(art: string | null): string | null {
  return art ? (ART[`${ART_DIR}${art}`] ?? null) : null;
}
