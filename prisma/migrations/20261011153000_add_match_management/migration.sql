-- =============================================================================
--  Match management and live scoring
--
--  The tables existed since the schema change; this migration makes them safe to
--  write from more than one place at once, which is what an admin console plus a
--  score feed actually is.
--
--  1. Precondition — the shape CHECKs below are only added if existing rows
--     already agree, and the migration says so rather than installing a
--     constraint that is untrue on the next INSERT.
--  2. Indexes. `(status, start_time)` backs "what is live, what is next", which
--     both the public list and the deposit QR lookup ask. `(start_time)` backs the
--     paged archive in either direction. `external_id` is unique so a feed can be
--     re-run for one fixture without creating a second match.
--  3. CHECKs. A team cannot play itself; a title and a QR cannot be blank
--     whitespace; a score must read `runs/wickets` and an over `overs.0-5`; a
--     version is positive. The service refuses all of these first — the database
--     is the backstop for rows written by anything else, including `psql` during
--     an incident.
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "matches"
    WHERE length(btrim("title")) = 0
       OR length(btrim("team_a")) = 0
       OR length(btrim("team_b")) = 0
       OR lower(btrim("team_a")) = lower(btrim("team_b"))
       OR ("qr_code_url" IS NOT NULL AND length(btrim("qr_code_url")) = 0)
  ) THEN
    RAISE EXCEPTION 'matches holds blank titles or teams, a team paired with itself, or an empty qr_code_url: clean those rows up before applying add_match_management';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "live_scores"
    WHERE "team_a_score" !~ '^[0-9]{1,4}/[0-9]{1,2}$'
       OR "team_b_score" !~ '^[0-9]{1,4}/[0-9]{1,2}$'
       OR "current_over" !~ '^[0-9]{1,2}\.[0-5]$'
  ) THEN
    RAISE EXCEPTION 'live_scores holds a score or over that is not in the canonical shape (e.g. "182/4" and "16.3"): normalise those rows before applying add_match_management';
  END IF;
END $$;

-- AlterTable
ALTER TABLE "matches" ADD COLUMN     "external_id" TEXT;

-- AlterTable
ALTER TABLE "live_scores" ADD COLUMN  "version" INTEGER NOT NULL DEFAULT 1,
                            ADD COLUMN  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE UNIQUE INDEX "matches_external_id_key" ON "matches"("external_id");

-- CreateIndex
CREATE INDEX "matches_status_start_time_idx" ON "matches"("status", "start_time");

-- CreateIndex
CREATE INDEX "matches_start_time_idx" ON "matches"("start_time");

-- CreateConstraint
ALTER TABLE "matches"
  ADD CONSTRAINT "matches_title_not_blank" CHECK (length(btrim("title")) > 0);

ALTER TABLE "matches"
  ADD CONSTRAINT "matches_teams_present" CHECK (length(btrim("team_a")) > 0 AND length(btrim("team_b")) > 0);

ALTER TABLE "matches"
  ADD CONSTRAINT "matches_teams_differ" CHECK (lower(btrim("team_a")) <> lower(btrim("team_b")));

ALTER TABLE "matches"
  ADD CONSTRAINT "matches_qr_url_not_blank" CHECK ("qr_code_url" IS NULL OR length(btrim("qr_code_url")) > 0);

-- CreateConstraint
ALTER TABLE "live_scores"
  ADD CONSTRAINT "live_scores_team_a_score_shape" CHECK ("team_a_score" ~ '^[0-9]{1,4}/[0-9]{1,2}$');

ALTER TABLE "live_scores"
  ADD CONSTRAINT "live_scores_team_b_score_shape" CHECK ("team_b_score" ~ '^[0-9]{1,4}/[0-9]{1,2}$');

ALTER TABLE "live_scores"
  ADD CONSTRAINT "live_scores_current_over_shape" CHECK ("current_over" ~ '^[0-9]{1,2}\.[0-5]$');

ALTER TABLE "live_scores"
  ADD CONSTRAINT "live_scores_version_positive" CHECK ("version" > 0);
