import { apiGet, apiGetWithEtag, type EtagResult } from "../lib/api";
import type { LiveScorePayload, MatchPage, MatchStatus, MatchView } from "../types/api";

export type MatchFilter = {
  status?: MatchStatus;
  limit?: number;
  cursor?: string | null;
  order?: "asc" | "desc";
};

function query(filter: MatchFilter): Record<string, string | number> {
  const params: Record<string, string | number> = { limit: filter.limit ?? 25 };
  if (filter.status) params.status = filter.status;
  if (filter.cursor) params.cursor = filter.cursor;
  if (filter.order) params.order = filter.order;
  return params;
}

/**
 * `GET /api/matches` — public, so it works before sign-in, which is what lets the
 * home screen show fixtures to a visitor.
 */
export function listMatches(filter: MatchFilter = {}): Promise<MatchPage> {
  return apiGet<MatchPage>("/api/matches", { params: query(filter) });
}

export function getMatch(id: string): Promise<MatchView> {
  return apiGet<MatchView>(`/api/matches/${encodeURIComponent(id)}`);
}

/**
 * `GET /api/matches/[id]/score`, conditionally. The server answers 304 when the
 * scoreboard has not moved, and the caller keeps the data it already has.
 */
export function getLiveScore(id: string, etag: string | null): Promise<EtagResult<LiveScorePayload>> {
  return apiGetWithEtag<LiveScorePayload>(`/api/matches/${encodeURIComponent(id)}/score`, etag);
}

export function listLiveMatches(): Promise<MatchPage> {
  return apiGet<MatchPage>("/api/matches/live");
}
