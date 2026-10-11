import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { provisionUser } from "@/lib/user";
import {
  MAX_BALANCE,
  MIN_RETAINED_WINNING_TOKENS,
  WalletError,
  creditDeposit,
  creditWinning,
  debitWinning,
  getTransactionHistory,
  getWallet,
} from "@/lib/wallet";

/**
 * Wallet service tests.
 *
 * Input-validation tests run without a database. Everything else runs against
 * PostgreSQL and skips itself when the database is unreachable. Fixtures use a
 * per-run prefix and are removed afterwards.
 */

const RUN = `wl${Date.now()}`;
const createdUserIds: string[] = [];
let sequence = 0;

/**
 * Probed at MODULE LOAD (see provisioning.test.ts for why this is not in beforeAll).
 */
const dbAvailable: boolean = await prisma
  .$queryRaw`SELECT 1`
  .then(() => true)
  .catch(() => {
    console.warn("\n  ⚠ PostgreSQL unreachable — skipping DB-backed wallet tests.\n");
    return false;
  });

afterAll(async () => {
  if (!dbAvailable || createdUserIds.length === 0) return;
  // Ledger rows and payments reference users with RESTRICT, so they go first.
  // Wallets cascade from users.
  await prisma.transaction.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.paymentRequest.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

/* ==========================================================================
   FIXTURES
   ========================================================================== */

async function newMember(label: string): Promise<string> {
  sequence += 1;
  const { user } = await provisionUser({
    googleId: `${RUN}_${label}_${sequence}`,
    name: `Wallet ${label}`,
    email: `${RUN}.${label}.${sequence}@example.test`,
  });
  createdUserIds.push(user.id);
  return user.id;
}

async function payment(
  userId: string,
  tokens: number,
  status: "PENDING" | "APPROVED" | "REJECTED" = "APPROVED",
): Promise<string> {
  sequence += 1;
  const row = await prisma.paymentRequest.create({
    data: {
      userId,
      amount: tokens,
      tokensToCredit: tokens,
      utrNumber: `${RUN}_utr_${sequence}`,
      screenshotUrl: "private://wallet-test-fixture",
      status,
    },
    select: { id: true },
  });
  return row.id;
}

/** Runs the promise and returns its rejection. Fails the test if it resolves. */
async function rejectionOf(promise: Promise<unknown>): Promise<WalletError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof WalletError) return error;
    throw error;
  }
  throw new Error("expected the wallet operation to be rejected");
}

/* ==========================================================================
   VALIDATION (no database needed)
   ========================================================================== */

describe("input validation", () => {
  it.each([0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_BALANCE + 1])(
    "rejects the invalid amount %s before touching the database",
    async (amount) => {
      const error = await rejectionOf(creditWinning("no-such-user", amount, "ref"));
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.status).toBe(400);
    },
  );

  it("rejects an empty or oversized reference", async () => {
    expect((await rejectionOf(debitWinning("u", 10, "   "))).code).toBe("VALIDATION_ERROR");
    expect((await rejectionOf(creditWinning("u", 10, "x".repeat(65)))).code).toBe(
      "VALIDATION_ERROR",
    );
  });

  it("requires a payment reference for deposits", async () => {
    const error = await rejectionOf(creditDeposit("u", 10, "  "));
    expect(error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an oversized description", async () => {
    const error = await rejectionOf(creditWinning("u", 10, null, "d".repeat(201)));
    expect(error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a bad page size and a malformed cursor", async () => {
    expect((await rejectionOf(getTransactionHistory("u", { limit: 0 }))).code).toBe(
      "VALIDATION_ERROR",
    );
    expect((await rejectionOf(getTransactionHistory("u", { limit: 101 }))).code).toBe(
      "VALIDATION_ERROR",
    );
    expect((await rejectionOf(getTransactionHistory("u", { cursor: "%%%" }))).code).toBe(
      "VALIDATION_ERROR",
    );
  });
});

/* ==========================================================================
   PROVISIONING AND READS
   ========================================================================== */

describe.skipIf(!dbAvailable)("wallet provisioning", () => {
  it("creates a zero-balance wallet in the same write as a new member", async () => {
    const userId = await newMember("prov");
    const wallet = await prisma.wallet.findUnique({
      where: { userId },
      select: { depositBalance: true, winningBalance: true },
    });
    expect(wallet).toEqual({ depositBalance: 0, winningBalance: 0 });
  });

  it("keeps exactly one wallet when the same member signs in again", async () => {
    const { user, created } = await provisionUser({
      googleId: `${RUN}_prov_again`,
      name: "Again",
      email: `${RUN}.prov.again@example.test`,
    });
    createdUserIds.push(user.id);
    expect(created).toBe(true);

    const second = await provisionUser({
      googleId: `${RUN}_prov_again`,
      name: "Again",
      email: `${RUN}.prov.again@example.test`,
    });
    expect(second.created).toBe(false);

    const count = await prisma.wallet.count({ where: { userId: user.id } });
    expect(count).toBe(1);
  });

  it("rolls the user back when the wallet insert fails", async () => {
    // Fail only the wallet insert for this marker member, via a temporary trigger.
    const marker = `${RUN}_forced_wallet_failure`;
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION wallet_test_fail_marker() RETURNS trigger AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM users u WHERE u.id = NEW.user_id AND u.google_id = '${marker}') THEN
          RAISE EXCEPTION 'simulated wallet failure';
        END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER wallet_test_fail_marker_trg BEFORE INSERT ON wallets
        FOR EACH ROW EXECUTE FUNCTION wallet_test_fail_marker()
    `);

    try {
      await expect(
        provisionUser({
          googleId: marker,
          name: "Doomed",
          email: `${RUN}.doomed@example.test`,
        }),
      ).rejects.toThrow(/simulated wallet failure/);

      const leftover = await prisma.user.count({ where: { googleId: marker } });
      expect(leftover).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS wallet_test_fail_marker_trg ON wallets`,
      );
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS wallet_test_fail_marker()`);
    }
  });
});

describe.skipIf(!dbAvailable)("getWallet", () => {
  it("reports zero balances for a new member", async () => {
    const userId = await newMember("zero");
    expect(await getWallet(userId)).toEqual({
      depositBalance: 0,
      winningBalance: 0,
      total: 0,
      withdrawableBalance: 0,
    });
  });

  it("throws WALLET_NOT_FOUND for an unknown member", async () => {
    const error = await rejectionOf(getWallet(`${RUN}-no-such-member`));
    expect(error.code).toBe("WALLET_NOT_FOUND");
    expect(error.status).toBe(404);
  });
});

/* ==========================================================================
   DEPOSITS
   ========================================================================== */

describe.skipIf(!dbAvailable)("creditDeposit", () => {
  it("credits the deposit balance once for an approved payment", async () => {
    const userId = await newMember("dep_ok");
    const paymentId = await payment(userId, 500);

    const result = await creditDeposit(userId, 500, paymentId, "UPI deposit");

    expect(result.balances).toMatchObject({ depositBalance: 500, winningBalance: 0, total: 500 });
    expect(result.entry).toMatchObject({
      type: "DEPOSIT",
      balanceType: "DEPOSIT",
      amount: 500,
      balanceAfter: 500,
      referenceId: paymentId,
      description: "UPI deposit",
    });
  });

  it("rejects a second credit for the same payment and leaves balances unchanged", async () => {
    const userId = await newMember("dep_dup");
    const paymentId = await payment(userId, 200);
    await creditDeposit(userId, 200, paymentId);

    const error = await rejectionOf(creditDeposit(userId, 200, paymentId));
    expect(error.code).toBe("DUPLICATE_REFERENCE");
    expect(error.status).toBe(409);
    expect((await getWallet(userId)).depositBalance).toBe(200);
  });

  it("rejects a payment that is not approved", async () => {
    const userId = await newMember("dep_pending");
    const paymentId = await payment(userId, 300, "PENDING");

    const error = await rejectionOf(creditDeposit(userId, 300, paymentId));
    expect(error.code).toBe("PAYMENT_NOT_APPROVED");
    expect((await getWallet(userId)).depositBalance).toBe(0);
  });

  it("rejects an amount that differs from the payment's tokensToCredit", async () => {
    const userId = await newMember("dep_mismatch");
    const paymentId = await payment(userId, 300);

    const error = await rejectionOf(creditDeposit(userId, 350, paymentId));
    expect(error.code).toBe("PAYMENT_MISMATCH");
    expect((await getWallet(userId)).depositBalance).toBe(0);
  });

  it("does not let a member credit another member's payment", async () => {
    const owner = await newMember("dep_owner");
    const other = await newMember("dep_other");
    const paymentId = await payment(owner, 400);

    const error = await rejectionOf(creditDeposit(other, 400, paymentId));
    expect(error.code).toBe("PAYMENT_NOT_FOUND");
    expect((await getWallet(owner)).depositBalance).toBe(0);
    expect((await getWallet(other)).depositBalance).toBe(0);
  });
});

/* ==========================================================================
   WINNINGS, WITHDRAWALS, AND THE MINIMUM RULE
   ========================================================================== */

describe.skipIf(!dbAvailable)("winnings and withdrawals", () => {
  it("winnings increase only the winning balance", async () => {
    const userId = await newMember("win_ok");

    const result = await creditWinning(userId, 250, "match_win_1", "Match 1 winnings");

    expect(result.balances).toMatchObject({
      depositBalance: 0,
      winningBalance: 250,
      total: 250,
      withdrawableBalance: 150,
    });
    expect(result.entry).toMatchObject({
      type: "WINNING",
      balanceType: "WINNING",
      amount: 250,
      balanceAfter: 250,
      referenceId: "match_win_1",
    });
  });

  it("rejects a second award with the same reference", async () => {
    const userId = await newMember("win_dup");
    await creditWinning(userId, 90, "match_dup");

    const error = await rejectionOf(creditWinning(userId, 90, "match_dup"));
    expect(error.code).toBe("DUPLICATE_REFERENCE");
    expect((await getWallet(userId)).winningBalance).toBe(90);
  });

  it("rejects a debit that would leave fewer than 100 winning tokens, with the exact message", async () => {
    const userId = await newMember("min_reject");
    await creditWinning(userId, 250, "min_seed");

    const error = await rejectionOf(debitWinning(userId, 151, "wd_too_big"));

    expect(MIN_RETAINED_WINNING_TOKENS).toBe(100);
    expect(error.code).toBe("MINIMUM_BALANCE");
    expect(error.status).toBe(422);
    expect(error.message).toBe("Minimum 100 tokens must remain in wallet");
    expect((await getWallet(userId)).winningBalance).toBe(250);
  });

  it("allows a debit that leaves exactly 100 winning tokens", async () => {
    const userId = await newMember("min_exact");
    await creditWinning(userId, 250, "min_exact_seed");

    const result = await debitWinning(userId, 150, "wd_exact", "Withdrawal");

    expect(result.balances).toMatchObject({ winningBalance: 100, withdrawableBalance: 0 });
    expect(result.entry).toMatchObject({
      type: "WITHDRAWAL",
      balanceType: "WINNING",
      amount: -150,
      balanceAfter: 100,
      referenceId: "wd_exact",
    });
  });

  it("rejects any further debit once the minimum is reached", async () => {
    const userId = await newMember("min_floor");
    await creditWinning(userId, 100, "floor_seed");

    const error = await rejectionOf(debitWinning(userId, 1, "wd_floor"));
    expect(error.code).toBe("MINIMUM_BALANCE");
    expect(error.message).toBe("Minimum 100 tokens must remain in wallet");
  });

  it("rejects a withdrawal from a member with no winnings", async () => {
    const userId = await newMember("min_empty");

    const error = await rejectionOf(debitWinning(userId, 1, "wd_empty"));
    expect(error.code).toBe("MINIMUM_BALANCE");
    expect((await getWallet(userId)).winningBalance).toBe(0);
  });

  it("applies the minimum to the winning balance, not to the total", async () => {
    const userId = await newMember("min_total");
    await creditDeposit(userId, 1000, await payment(userId, 1000), "Big deposit");
    await creditWinning(userId, 120, "min_total_seed");

    // Total is 1120, but the winning balance would drop to 90.
    const error = await rejectionOf(debitWinning(userId, 30, "wd_total"));
    expect(error.code).toBe("MINIMUM_BALANCE");
  });

  it("a withdrawal never touches the deposit balance", async () => {
    const userId = await newMember("wd_deposit");
    await creditDeposit(userId, 500, await payment(userId, 500));
    await creditWinning(userId, 300, "wd_deposit_seed");

    const result = await debitWinning(userId, 200, "wd_deposit_ok");

    expect(result.balances).toMatchObject({ depositBalance: 500, winningBalance: 100, total: 600 });
  });
});

/* ==========================================================================
   HISTORY
   ========================================================================== */

describe.skipIf(!dbAvailable)("getTransactionHistory", () => {
  it("returns every entry newest first across keyset pages, with no gaps or repeats", async () => {
    const userId = await newMember("history");
    for (let i = 1; i <= 5; i += 1) {
      await creditWinning(userId, i, `hist_${i}`);
    }

    const seen: { id: string; createdAt: Date }[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await getTransactionHistory(userId, { limit: 2, cursor });
      seen.push(...page.items.map((item) => ({ id: item.id, createdAt: item.createdAt })));
      cursor = page.nextCursor;
      pages += 1;
      expect(pages).toBeLessThanOrEqual(5);
    } while (cursor);

    expect(pages).toBe(3);
    expect(seen).toHaveLength(5);
    expect(new Set(seen.map((entry) => entry.id)).size).toBe(5);

    // Newest first. Rows with the same timestamp may come in any order.
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i - 1].createdAt.getTime()).toBeGreaterThanOrEqual(
        seen[i].createdAt.getTime(),
      );
    }
  });

  it("returns an empty page for a member with no ledger rows", async () => {
    const userId = await newMember("history_empty");
    expect(await getTransactionHistory(userId)).toEqual({ items: [], nextCursor: null });
  });
});

/* ==========================================================================
   INVARIANTS AND CONCURRENCY
   ========================================================================== */

describe.skipIf(!dbAvailable)("ledger invariants and concurrency", () => {
  it("ledger sums equal the cached balances after mixed activity", async () => {
    const userId = await newMember("reconcile");
    await creditDeposit(userId, 700, await payment(userId, 700));
    await creditWinning(userId, 400, "rec_win_1");
    await creditWinning(userId, 80, "rec_win_2");
    await debitWinning(userId, 300, "rec_wd_1");

    const wallet = await getWallet(userId);
    const rows = await prisma.transaction.findMany({
      where: { userId },
      select: { amount: true, balanceType: true },
    });
    const sumOf = (balanceType: "DEPOSIT" | "WINNING") =>
      rows
        .filter((row) => row.balanceType === balanceType)
        .reduce((total, row) => total + row.amount, 0);

    expect(sumOf("DEPOSIT")).toBe(wallet.depositBalance);
    expect(sumOf("WINNING")).toBe(wallet.winningBalance);
    expect(wallet.winningBalance).toBe(180);
  });

  it(
    "concurrent withdrawals cannot take the winning balance below the minimum",
    async () => {
      const userId = await newMember("race_debit");
      await creditWinning(userId, 1000, "race_seed");

      const attempts = await Promise.allSettled(
        Array.from({ length: 25 }, (_, i) => debitWinning(userId, 100, `race_wd_${i}`)),
      );

      const fulfilled = attempts.filter((a) => a.status === "fulfilled");
      const rejected = attempts.filter(
        (a): a is PromiseRejectedResult => a.status === "rejected",
      );

      // 1000 - 9 * 100 = 100, the minimum. A tenth withdrawal would drop below it.
      expect(fulfilled).toHaveLength(9);
      expect(rejected).toHaveLength(16);
      for (const failure of rejected) {
        expect(failure.reason).toBeInstanceOf(WalletError);
        expect((failure.reason as WalletError).code).toBe("MINIMUM_BALANCE");
      }

      const wallet = await getWallet(userId);
      expect(wallet.winningBalance).toBe(MIN_RETAINED_WINNING_TOKENS);

      const withdrawals = await prisma.transaction.count({
        where: { userId, type: "WITHDRAWAL" },
      });
      expect(withdrawals).toBe(9);
    },
    30_000,
  );

  it("concurrent credits on one wallet are all applied", async () => {
    const userId = await newMember("race_credit");

    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => creditWinning(userId, 10, `race_cr_${i}`)),
    );

    expect(results).toHaveLength(20);
    expect((await getWallet(userId)).winningBalance).toBe(200);
    expect(await prisma.transaction.count({ where: { userId } })).toBe(20);
  }, 30_000);

  it("a caller's transaction rolls back the wallet change with it", async () => {
    const userId = await newMember("caller_rb");
    await creditWinning(userId, 500, "caller_seed");

    await expect(
      prisma.$transaction(async (tx) => {
        await creditWinning(userId, 50, "caller_rb_1", null, { tx });
        throw new Error("rollback requested by caller");
      }),
    ).rejects.toThrow("rollback requested by caller");

    expect((await getWallet(userId)).winningBalance).toBe(500);
    expect(
      await prisma.transaction.count({ where: { userId, referenceId: "caller_rb_1" } }),
    ).toBe(0);
  });

  it("joins a caller's transaction and commits with it", async () => {
    const userId = await newMember("caller_ok");

    await prisma.$transaction(async (tx) => {
      await creditWinning(userId, 40, "caller_ok_1", null, { tx });
    });

    expect((await getWallet(userId)).winningBalance).toBe(40);
  });

  it("refuses a credit that would push a balance past the limit", async () => {
    const userId = await newMember("limit");
    await creditWinning(userId, MAX_BALANCE, "limit_fill");

    const error = await rejectionOf(creditWinning(userId, 1, "limit_over"));
    expect(error.code).toBe("BALANCE_LIMIT");
    expect(error.status).toBe(422);
    expect((await getWallet(userId)).winningBalance).toBe(MAX_BALANCE);
  });
});
