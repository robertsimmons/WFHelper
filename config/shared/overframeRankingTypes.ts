/** Shape of src/data/suggest/rankings.json, which the runtime refresh mirrors. */

export interface OverframeRankingRow {
  id: number;
  name: string | null;
  slug: string | null;
  category: string;
  categoryId: number;
  averageScore: number;
  votes: number;
}

export interface OverframeRankings {
  fetchedAt: string;
  categories: Record<string, string>;
  items: Record<string, OverframeRankingRow>;
}
