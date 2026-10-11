-- =============================================================================
--  Payout queue support
--
--  A withdrawal is different from a deposit claim in one important way: the
--  tokens leave the wallet when the request is filed, not when it is approved.
--  That makes the payout queue a balance-sensitive workload, so both read paths
--  need indexes and the amount needs a database-level floor.
--
--  1. Precondition first, so a bad state stops the migration before anything
--     changes.
--  2. Indexes. `withdrawal_requests(user_id, created_at)` backs a member's own
--     history and the pending-count check; `(status, created_at)` backs the
--     review queue's filter and ordering. PostgreSQL does not index foreign-key
--     columns on its own, so both were sequential scans.
--  3. CHECK. A zero or negative payout request is nonsense, and it would also
--     give `refundWinning` a debit row to match against in the wrong direction.
--     Same style as `harden_payment_requests`.
--
--  The refund rule itself ("only what was cut can come back") lives in the
--  ledger: it needs the WITHDRAWAL row, which this table does not have.
-- =============================================================================

-- Precondition. Rows written by hand before this change could carry a zero or
-- negative amount. Refuse to add a constraint that would already be untrue
-- rather than failing later.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "withdrawal_requests" WHERE "amount" <= 0
  ) THEN
    RAISE EXCEPTION 'withdrawal_requests holds non-positive amounts: clean them up before applying harden_withdrawal_requests';
  END IF;
END $$;

-- CreateIndex
CREATE INDEX "withdrawal_requests_user_id_created_at_idx" ON "withdrawal_requests"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "withdrawal_requests_status_created_at_idx" ON "withdrawal_requests"("status", "created_at");

-- CheckConstraint
ALTER TABLE "withdrawal_requests"
  ADD CONSTRAINT "withdrawal_requests_amount_positive" CHECK ("amount" > 0);
