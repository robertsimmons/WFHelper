/** Names the providers resolved that the worth ladder has no place for. A
 *  coverage gap has to be visible rather than scoring as something middling, and
 *  live reward names cannot be enumerated ahead of time, so the only honest
 *  count is what the feed has actually seen this session. */
const seen = new Set<string>();

/** A session cannot be allowed to grow this without bound; well past the ~40
 *  names the shipped curated tables can produce on their own. */
const LIMIT = 500;

export function noteUnplaced(key: string): void {
  if (!key || seen.size >= LIMIT) return;
  seen.add(key);
}

/** Every unplaced name the feed has resolved, in the order it first saw them. */
export function unplacedNames(): string[] {
  return [...seen];
}

export function unplacedCount(): number {
  return seen.size;
}

export function clearUnplacedForTest(): void {
  seen.clear();
}
