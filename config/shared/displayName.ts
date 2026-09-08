import { stripGameTokens } from "./gameMarkup";

export function sanitizeDisplayName(name: string | null | undefined): string {
  const raw = String(name || "").trim();
  // If the marker is the entire name, keep it rather than render blank.
  return stripGameTokens(raw) || raw;
}

// Language keys end in `Name`; drop it to avoid labels such as "Archon Crystal Green Name".
export function fallbackNameFromUniqueName(uniqueName: string | null | undefined): string {
  if (!uniqueName) return "Unknown";
  const raw = String(uniqueName);
  const segments = raw.split("/");
  let last = segments[segments.length - 1] || "Unknown";
  if (/\/Lotus\/Language\//i.test(raw)) {
    last = last.replace(/Name$/, "");
  }
  const name = last.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  return sanitizeDisplayName(name);
}
