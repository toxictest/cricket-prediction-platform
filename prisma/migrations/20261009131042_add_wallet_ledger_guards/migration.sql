-- =============================================================================
--  Wallet ledger guards
--
--  1. The ledger gains a signed amount convention, a balance_after snapshot,
--     a BalanceType enum, and two indexes (duplicate-reference guard and
--     per-user history). Prisma's generated DDL dropped and re-added
--     balance_type; this version converts it in place instead.
--  2. Every existing member gets a zero-balance wallet. New members get one
--     from provisionUser, in the same write as the user row.
--  3. CHECK constraints back the application rules at the database level.
-- =============================================================================

-- Precondition. The ledger has never been written by application code, so a
-- non-empty table means something unexpected happened. Stop before changing
-- its shape, because balance_after cannot be backfilled from nothing.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "transactions") THEN
    RAISE EXCEPTION 'transactions is not empty: backfill balance_after before applying add_wallet_ledger_guards';
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "BalanceType" AS ENUM ('DEPOSIT', 'WINNING');

-- AlterTable
ALTER TABLE "transactions"
  ALTER COLUMN "balance_type" TYPE "BalanceType" USING ("balance_type"::"BalanceType"),
  ADD COLUMN "balance_after" INTEGER NOT NULL;

-- CreateIndex
CREATE INDEX "transactions_user_id_created_at_idx" ON "transactions"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_user_id_type_reference_id_key" ON "transactions"("user_id", "type", "reference_id");

-- Backfill: a zero-balance wallet for every user that has none.
-- gen_random_uuid() is core in PostgreSQL 13+. Prisma treats ids as opaque
-- strings, so these ids do not need to be cuid-shaped.
INSERT INTO "wallets" ("id", "user_id", "deposit_balance", "winning_balance", "created_at", "updated_at")
SELECT gen_random_uuid()::text, u."id", 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "users" u
WHERE NOT EXISTS (SELECT 1 FROM "wallets" w WHERE w."user_id" = u."id");

-- CHECK constraints (not expressible in schema.prisma).
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_deposit_balance_non_negative" CHECK ("deposit_balance" >= 0);
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_winning_balance_non_negative" CHECK ("winning_balance" >= 0);
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_amount_non_zero" CHECK ("amount" <> 0);
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_balance_after_non_negative" CHECK ("balance_after" >= 0);
