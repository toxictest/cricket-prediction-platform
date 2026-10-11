-- =============================================================================
--  Payment review support
--
--  1. Precondition first, so a bad state stops the migration before anything
--     changes.
--  2. Two indexes. The deposit queue is now a real workload: an admin filters
--     by status and pages through it, and a member's pending count is checked
--     before a new claim is accepted. PostgreSQL does not index foreign-key
--     columns on its own, so both access paths were sequential scans.
--  3. CHECK constraints backing the rule "a claim states a real rupee amount".
--     Same style as the wallet and ledger guards in 20261009131042.
-- =============================================================================

-- Precondition. Rows written by hand before this change could carry a zero or
-- negative amount, which no code path may create from here on. Refuse to add a
-- constraint that would silently be untrue, rather than failing later.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "payment_requests"
    WHERE "amount" <= 0 OR "tokens_to_credit" <= 0
  ) THEN
    RAISE EXCEPTION 'payment_requests holds non-positive amounts: clean them up before applying harden_payment_requests';
  END IF;
END $$;

-- CreateIndex
CREATE INDEX "payment_requests_user_id_created_at_idx" ON "payment_requests"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "payment_requests_status_created_at_idx" ON "payment_requests"("status", "created_at");

-- CheckConstraint
ALTER TABLE "payment_requests"
  ADD CONSTRAINT "payment_requests_amount_positive" CHECK ("amount" > 0);

-- CheckConstraint
ALTER TABLE "payment_requests"
  ADD CONSTRAINT "payment_requests_tokens_to_credit_positive" CHECK ("tokens_to_credit" > 0);
