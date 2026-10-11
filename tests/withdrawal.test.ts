import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { provisionUser } from "@/lib/user";
import { hashAdminPassword } from "@/lib/admin-password";
import {
  MIN_RETAINED_WINNING_TOKENS,
  WalletError,
  creditWinning,
  getWallet,
  minimumBalanceMessage,
} from "@/lib/wallet";
import {
  MAX_PENDING_PER_MEMBER,
  WithdrawalError,
  approveWithdrawalRequest,
  createWithdrawalRequest,
  listMyWithdrawals,
  listWithdrawalRequests,
  normalizeUpiId,
  rejectWithdrawalRequest,
} from "@/lib/withdrawal";

/**
 * Withdrawal service tests.
 *
 * A payout is the one place this platform takes money out, so the properties
 * under test are the expensive ones: the balance is cut exactly when the
 * request is filed, a refused request returns exactly what was taken, no request
 * can be reviewed twice, and a refund can never mint tokens.
 *
 * Everything except the validation block runs against PostgreSQL and skips
 * itself when the database is unreachable. Fixtures use a per-run prefix and are
 * removed afterwards.
 */

const RUN = `wd${Date.now()}`;
const createdUserIds: string[] = [];
const createdAdminIds: string[] = [];
let sequence = 0;

const db = await prisma
  .$queryRaw`SELECT 1`
  .then(() => true)
  .catch(() => {
    console.warn("\n  ⚠ PostgreSQL unreachable — skipping withdrawal service tests.\n");
    return false;
  });

let passwordHash = "";
beforeAll(async () => {
  passwordHash = await hashAdminPassword("test-only-admin-password-1");
});

afterAll(async () => {
  if (!db) return;
  // withdrawal_requests and transactions RESTRICT/CASCADE on users; ledger rows
  // first so a user delete can never be blocked by a leftover entry.
  await prisma.transaction.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.withdrawalRequest.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.wallet.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  if (createdAdminIds.length > 0) {
    await prisma.adminUser.deleteMany({ where: { id: { in: createdAdminIds } } });
  }
});

/* ==========================================================================
   FIXTURES
   ========================================================================== */

async function newMember(label: string, winning = 0): Promise<string> {
  sequence += 1;
  const { user } = await provisionUser({
    googleId: `${RUN}_${label}_${sequence}`,
    name: `Member ${label}`,
    email: `${RUN}.${label}.${sequence}@example.test`,
  });
  createdUserIds.push(user.id);
  if (winning > 0) {
    await creditWinning(user.id, winning, `${RUN}-seed-${sequence}`, "test opening balance");
  }
  return user.id;
}

async function newReviewer() {
  const admin = await prisma.adminUser.create({
    data: {
      email: `${RUN}-${randomUUID().slice(0, 8)}@example.test`,
      passwordHash,
      name: "Payout Reviewer",
      roles: ["PAYMENT_ADMIN"],
    },
    select: { id: true, name: true },
  });
  createdAdminIds.push(admin.id);
  return admin;
}

const upiFor = (tag: string) => `${tag}${sequence}@upiBank`;

type DomainError = WithdrawalError | WalletError;

async function rejectionOf(promise: Promise<unknown>): Promise<DomainError> {
  try {
    await promise;
  } catch (error) {
    // A payout can be refused by the withdrawal state machine or by the wallet
    // service it delegates to. Both are expected failures here.
    if (error instanceof WithdrawalError || error instanceof WalletError) return error;
    throw error;
  }
  throw new Error("expected the withdrawal operation to be rejected");
}

/** The ledger rows for one request, which is how a debit and its refund are checked together. */
function ledgerFor(userId: string, referenceId: string) {
  return prisma.transaction.findMany({
    where: { userId, referenceId },
    orderBy: { createdAt: "asc" },
    select: { type: true, amount: true, balanceType: true, balanceAfter: true },
  });
}

/* ==========================================================================
   VALIDATION (no database needed)
   ========================================================================== */

describe("payout validation", () => {
  it.each([0, -100, 12.5, Number.NaN, Number.POSITIVE_INFINITY, "400"])(
    "rejects the invalid amount %s",
    async (amount) => {
      const error = await rejectionOf(
        createWithdrawalRequest("no-such-user", {
          amount: amount as number,
          upiId: "member@bank",
        }),
      );
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.status).toBe(400);
    },
  );

  it.each([
    "",
    "   ",
    "no-at-sign",
    "a@bank", // local part too short to be a VPA
    "ab@b", // handle too short to identify a bank
    "ab@1234", // a handle is letters only
    "ab@bank@again",
    "ab@@bank",
    "a b@bank",
    "ab@bank!com",
    "x".repeat(321),
  ])("rejects the VPA %o", async (upiId) => {
    const error = await rejectionOf(
      createWithdrawalRequest("no-such-user", { amount: 100, upiId }),
    );
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.status).toBe(400);
  });

  it("trims and lower-cases a VPA, because it is the destination of a real transfer", () => {
    expect(normalizeUpiId("  Rahul.Sharma@YBL  ")).toBe("rahul.sharma@ybl");
    expect(() => normalizeUpiId("a@b")).toThrow(WithdrawalError);
  });

  it("rejects a payout reference the shape rules will not accept", async () => {
    const error = await rejectionOf(approveWithdrawalRequest("some-id", "admin-id", "!!"));
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.message).toMatch(/adminUtr/);
  });

  it("requires a reason when refusing, so the member knows what to fix", async () => {
    for (const reviewNote of ["", "  ", "ab", "x".repeat(501)]) {
      const error = await rejectionOf(rejectWithdrawalRequest("some-id", "admin-id", reviewNote));
      expect(error.code).toBe("VALIDATION_ERROR");
    }
  });

  it("refuses to file, approve or refuse while money features are off", async () => {
    const previous = process.env.MONEY_MODE;
    process.env.MONEY_MODE = "false";
    try {
      for (const attempt of [
        createWithdrawalRequest("no-such-user", { amount: 100, upiId: "ab@bank" }),
        approveWithdrawalRequest("some-id", "admin-id"),
        rejectWithdrawalRequest("some-id", "admin-id", "not verified"),
      ]) {
        const error = await rejectionOf(attempt);
        expect(error.code).toBe("PAYMENTS_DISABLED");
        expect(error.status).toBe(503);
      }
    } finally {
      if (previous === undefined) delete process.env.MONEY_MODE;
      else process.env.MONEY_MODE = previous;
    }
  });
});

/* ==========================================================================
   AGAINST POSTGRESQL
   ========================================================================== */

describe.skipIf(!db)("payouts against PostgreSQL", () => {
  it("cuts the winning balance and files the request in the same step", async () => {
    const userId = await newMember("cut");
    const before = await getWallet(userId);
    expect(before.winningBalance).toBe(0);

    await creditWinning(userId, 1000, `${RUN}-cut-1`, "final win");
    const receipt = await createWithdrawalRequest(userId, {
      amount: 400,
      upiId: upiFor("cut"),
    });

    expect(receipt.status).toBe("PENDING");
    expect(receipt.amount).toBe(400);
    expect(receipt.upiId).toBe(upiFor("cut").toLowerCase());
    expect(receipt.wallet.winningBalance).toBe(600);
    expect(receipt.wallet.withdrawableBalance).toBe(500);

    const row = await prisma.withdrawalRequest.findUniqueOrThrow({ where: { id: receipt.id } });
    expect(row).toMatchObject({
      userId,
      amount: 400,
      status: "PENDING",
      adminUtr: null,
      reviewNote: null,
      reviewedById: null,
    });

    // The request and its debit reference each other, which is what makes a
    // double approval and a double refund impossible.
    const [entry] = await ledgerFor(userId, receipt.id);
    expect(entry).toEqual({
      type: "WITHDRAWAL",
      amount: -400,
      balanceType: "WINNING",
      balanceAfter: 600,
    });

    // A deposit balance is never touched by a payout.
    const after = await getWallet(userId);
    expect(after.depositBalance).toBe(before.depositBalance);
    expect(after.winningBalance).toBe(600);
  });

  it("refuses to leave fewer than 100 tokens, and leaves no orphan request behind", async () => {
    const userId = await newMember("floor");
    await creditWinning(userId, 250, `${RUN}-floor-1`, "semifinal win");

    const error = await rejectionOf(
      createWithdrawalRequest(userId, { amount: 200, upiId: upiFor("floor") }),
    );
    expect(error.code).toBe("MINIMUM_BALANCE");
    expect(error.message).toBe(minimumBalanceMessage());
    expect(error.message).toBe("Minimum 100 tokens must remain in wallet");
    expect(error.status).toBe(422);

    // The rollback has to be complete: no claim waiting for an approve, no
    // half-written ledger row.
    expect(await prisma.withdrawalRequest.count({ where: { userId } })).toBe(0);
    expect(await prisma.transaction.count({ where: { userId, type: "WITHDRAWAL" } })).toBe(0);
    expect(await getWallet(userId)).toMatchObject({ winningBalance: 250 });
  });

  it("treats an amount larger than the balance as the same failure", async () => {
    const userId = await newMember("overshoot");
    await creditWinning(userId, 50, `${RUN}-over-1`, "small win");

    const error = await rejectionOf(
      createWithdrawalRequest(userId, { amount: 5_000, upiId: upiFor("overshoot") }),
    );
    expect(error.code).toBe("MINIMUM_BALANCE");
    expect(await prisma.withdrawalRequest.count({ where: { userId } })).toBe(0);
  });

  it("lets a member withdraw down to exactly the floor, and then nothing more", async () => {
    const userId = await newMember("exact");
    await creditWinning(userId, 300, `${RUN}-exact-1`, "consistent winning");

    const receipt = await createWithdrawalRequest(userId, {
      amount: 200,
      upiId: upiFor("exact"),
    });
    expect(receipt.wallet.winningBalance).toBe(MIN_RETAINED_WINNING_TOKENS);
    expect(receipt.wallet.withdrawableBalance).toBe(0);

    const error = await rejectionOf(
      createWithdrawalRequest(userId, { amount: 1, upiId: upiFor("exact2") }),
    );
    expect(error.code).toBe("MINIMUM_BALANCE");
  });

  it("files nothing when the member has no wallet row", async () => {
    const userId = await newMember("no-wallet");
    await prisma.wallet.deleteMany({ where: { userId } });

    const error = await rejectionOf(
      createWithdrawalRequest(userId, { amount: 100, upiId: upiFor("nowallet") }),
    );
    expect(error.code).toBe("WALLET_NOT_FOUND");
    expect(error.status).toBe(404);
    expect(await prisma.withdrawalRequest.count({ where: { userId } })).toBe(0);
  });

  it("cannot let two requests filed at once spend the same tokens", async () => {
    const userId = await newMember("race");
    await creditWinning(userId, 500, `${RUN}-race-1`, "tournament win");

    const results = await Promise.allSettled([
      createWithdrawalRequest(userId, { amount: 400, upiId: upiFor("raceA") }),
      createWithdrawalRequest(userId, { amount: 400, upiId: upiFor("raceB") }),
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // One debit of 400 on a balance of 500: 100 left, exactly the floor.
    const wallet = await getWallet(userId);
    expect(wallet.winningBalance).toBe(100);
    expect(await prisma.withdrawalRequest.count({ where: { userId } })).toBe(1);
    expect(await prisma.transaction.count({ where: { userId, type: "WITHDRAWAL" } })).toBe(1);
  });

  it("caps how many payouts one member can have waiting", async () => {
    const userId = await newMember("cap");
    await creditWinning(userId, 10_000, `${RUN}-cap-1`, "series win");

    for (let index = 0; index < MAX_PENDING_PER_MEMBER; index += 1) {
      await createWithdrawalRequest(userId, { amount: 100, upiId: `cap${index}@bank` });
    }

    const error = await rejectionOf(
      createWithdrawalRequest(userId, { amount: 100, upiId: "cap6@bank" }),
    );
    expect(error.code).toBe("TOO_MANY_PENDING");
    expect(error.status).toBe(429);
    expect(await prisma.withdrawalRequest.count({ where: { userId } })).toBe(
      MAX_PENDING_PER_MEMBER,
    );

    // Clearing one slot frees it up again — the cap is on *waiting* requests.
    const [oldest] = await prisma.withdrawalRequest.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
      take: 1,
    });
    const reviewer = await newReviewer();
    await approveWithdrawalRequest(oldest!.id, reviewer.id, "payout-ref-1");
    await expect(
      createWithdrawalRequest(userId, { amount: 100, upiId: "cap6@bank" }),
    ).resolves.toMatchObject({ status: "PENDING" });
  });

  it("gives the member their own history, newest first, without reviewer identities", async () => {
    const userId = await newMember("mine");
    await creditWinning(userId, 5_000, `${RUN}-mine-1`, "many small wins");
    for (let index = 0; index < 4; index += 1) {
      await createWithdrawalRequest(userId, { amount: 100 + index, upiId: `mine${index}@bank` });
    }

    const page = await listMyWithdrawals(userId, { limit: 3 });
    expect(page.items).toHaveLength(3);
    expect(page.nextCursor).toBeTruthy();

    const rest = await listMyWithdrawals(userId, { limit: 3, cursor: page.nextCursor });
    expect(rest.items).toHaveLength(1);
    expect(rest.nextCursor).toBeNull();

    const all = [...page.items, ...rest.items];
    expect(all.map((item) => item.amount).sort((a, b) => b - a)).toEqual([103, 102, 101, 100]);
    // Newest first. Rows filed inside the same millisecond tie on createdAt, so
    // the order is asserted on the timestamp, not on which row won the tie.
    const times = all.map((item) => item.createdAt.getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);

    // No other member's rows, and no admin columns or user object: this list is
    // what a member may see.
    expect(page.items.every((item) => item.upiId.startsWith("mine"))).toBe(true);
    expect(Object.keys(page.items[0]!).sort()).toEqual(
      [
        "adminUtr",
        "amount",
        "createdAt",
        "id",
        "reviewNote",
        "status",
        "updatedAt",
        "upiId",
      ].sort(),
    );

    const pendingOnly = await listMyWithdrawals(userId, { status: "PENDING" });
    expect(pendingOnly.items).toHaveLength(4);
    const approvedOnly = await listMyWithdrawals(userId, { status: "APPROVED" });
    expect(approvedOnly.items).toHaveLength(0);
  });

  it("rejects a bad limit or cursor on either list", async () => {
    const userId = await newMember("paging");
    for (const filters of [{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { cursor: "not-a-cursor" }]) {
      const error = await rejectionOf(listMyWithdrawals(userId, filters));
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.status).toBe(400);
    }
  });

  it("shows the reviewer who is asking what the queue holds, and nothing secret", async () => {
    const userId = await newMember("queue");
    const reviewer = await newReviewer();
    await creditWinning(userId, 1_000, `${RUN}-queue-1`, "playoff win");
    const receipt = await createWithdrawalRequest(userId, {
      amount: 300,
      upiId: upiFor("queue"),
    });
    await approveWithdrawalRequest(receipt.id, reviewer.id, "912345678901");

    const queue = await listWithdrawalRequests({ userId, limit: 10 });
    expect(queue.counts.APPROVED).toBe(1);
    expect(queue.counts.PENDING).toBe(0);
    const item = queue.items[0]!;
    expect(item).toMatchObject({
      id: receipt.id,
      amount: 300,
      status: "APPROVED",
      adminUtr: "912345678901",
      user: { id: userId, referralCode: expect.any(String) },
      reviewedBy: { id: reviewer.id, name: "Payout Reviewer" },
    });

    // The queue never carries an admin's password hash or session token.
    expect(JSON.stringify(queue)).not.toMatch(/passwordHash|token/i);

    // A filter the queue does not know is refused rather than ignored.
    const all = await listWithdrawalRequests({ status: "PENDING" });
    expect(all.items.some((row) => row.id === receipt.id)).toBe(false);
  });

  it("marks a payout as paid without moving a single token", async () => {
    const userId = await newMember("approve");
    const reviewer = await newReviewer();
    await creditWinning(userId, 900, `${RUN}-approve-1`, "group-stage win");
    const receipt = await createWithdrawalRequest(userId, {
      amount: 500,
      upiId: upiFor("approve"),
    });
    expect(await getWallet(userId)).toMatchObject({ winningBalance: 400 });

    // The reference is canonicalised exactly like an inbound UTR, so the same
    // string typed two ways still matches the bank statement.
    const result = await approveWithdrawalRequest(receipt.id, reviewer.id, " payout-2026-0001 ");
    expect(result.withdrawal.status).toBe("APPROVED");
    expect(result.withdrawal.adminUtr).toBe("PAYOUT-2026-0001");
    expect(result.withdrawal.reviewedBy?.id).toBe(reviewer.id);

    // The whole point of cutting at request time: approval is a status change.
    expect(await getWallet(userId)).toMatchObject({ winningBalance: 400 });
    expect(await prisma.transaction.count({ where: { userId, referenceId: receipt.id } })).toBe(1);

    // ...and it needs no reference at all, since a P2P UPI payout often has none.
    const second = await createWithdrawalRequest(userId, {
      amount: 100,
      upiId: upiFor("approve2"),
    });
    await expect(approveWithdrawalRequest(second.id, reviewer.id)).resolves.toMatchObject({
      withdrawal: { status: "APPROVED", adminUtr: null },
    });
  });

  it("refuses to review a request twice", async () => {
    const userId = await newMember("twice");
    const reviewer = await newReviewer();
    await creditWinning(userId, 1_000, `${RUN}-twice-1`, "league win");
    const receipt = await createWithdrawalRequest(userId, {
      amount: 600,
      upiId: upiFor("twice"),
    });
    await approveWithdrawalRequest(receipt.id, reviewer.id, "payout-ref-2");

    const again = await rejectionOf(approveWithdrawalRequest(receipt.id, reviewer.id, "payout-ref-3"));
    expect(again.code).toBe("NOT_PENDING");
    expect(again.status).toBe(409);
    expect(await getWallet(userId)).toMatchObject({ winningBalance: 400 });

    const rejectedAfterApproval = await rejectionOf(
      rejectWithdrawalRequest(receipt.id, reviewer.id, "too late to change my mind"),
    );
    expect(rejectedAfterApproval.code).toBe("NOT_PENDING");
    // A paid payout is not clawed back by the reject endpoint.
    expect(await getWallet(userId)).toMatchObject({ winningBalance: 400 });
    expect(await prisma.transaction.count({ where: { userId, referenceId: receipt.id } })).toBe(1);
  });

  it("returns exactly what a refused request took", async () => {
    const userId = await newMember("refund");
    const reviewer = await newReviewer();
    await creditWinning(userId, 1_200, `${RUN}-refund-1`, "quarter-final win");
    const receipt = await createWithdrawalRequest(userId, {
      amount: 700,
      upiId: upiFor("refund"),
    });
    expect(await getWallet(userId)).toMatchObject({ winningBalance: 500 });

    const result = await rejectWithdrawalRequest(receipt.id, reviewer.id, "  UPI ID did not match the name  ");
    expect(result.withdrawal).toMatchObject({
      id: receipt.id,
      status: "REJECTED",
      reviewNote: "UPI ID did not match the name",
      reviewedBy: { name: "Payout Reviewer" },
    });
    // The reviewer's id is not echoed back to a member-facing projection.
    expect(result.withdrawal.user.id).toBe(userId);
    expect(result.wallet).toMatchObject({ winningBalance: 1_200 });
    expect(result.transaction).toMatchObject({
      type: "REFUND",
      amount: 700,
      balanceType: "WINNING",
      balanceAfter: 1_200,
    });

    const entries = await ledgerFor(userId, receipt.id);
    expect(entries.map((entry) => entry.amount)).toEqual([-700, 700]);
    // Net effect on the wallet: zero. That is the only honest outcome of a
    // request that was filed and then refused.
    expect(entries.reduce((sum, entry) => sum + entry.amount, 0)).toBe(0);
    expect(await getWallet(userId)).toMatchObject({ winningBalance: 1_200 });

    // The refunded tokens are usable again, under a new request.
    await expect(
      createWithdrawalRequest(userId, { amount: 700, upiId: upiFor("refund2") }),
    ).resolves.toMatchObject({ wallet: { winningBalance: 500 } });
  });

  it("cannot refund the same request twice", async () => {
    const userId = await newMember("double-refund");
    const reviewer = await newReviewer();
    await creditWinning(userId, 800, `${RUN}-double-1`, "third-place win");
    const receipt = await createWithdrawalRequest(userId, {
      amount: 400,
      upiId: upiFor("double"),
    });

    await rejectWithdrawalRequest(receipt.id, reviewer.id, "document unreadable");
    const again = await rejectionOf(
      rejectWithdrawalRequest(receipt.id, reviewer.id, "document unreadable"),
    );
    expect(again.code).toBe("NOT_PENDING");

    // 800 in, 400 out, 400 back. Anything else and the balance was minted.
    expect(await getWallet(userId)).toMatchObject({ winningBalance: 800 });
    const entries = await ledgerFor(userId, receipt.id);
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.type)).toEqual(["WITHDRAWAL", "REFUND"]);
  });

  it("refuses a refund that does not match its own debit, and leaves the request PENDING", async () => {
    const userId = await newMember("tamper");
    const reviewer = await newReviewer();
    await creditWinning(userId, 1_000, `${RUN}-tamper-1`, "clean win");
    const receipt = await createWithdrawalRequest(userId, {
      amount: 300,
      upiId: upiFor("tamper"),
    });

    // What an INSERT/UPDATE outside this service, or a bad migration, could
    // leave behind: a request row claiming more than the ledger cut.
    await prisma.withdrawalRequest.update({ where: { id: receipt.id }, data: { amount: 900 } });

    const error = await rejectionOf(
      rejectWithdrawalRequest(receipt.id, reviewer.id, "trying to double-dip"),
    );
    expect(error.code).toBe("REFUND_NOT_MATCHED");
    expect(error.status).toBe(422);
    expect(error.message).toMatch(/only 300 can be returned/);

    // Refused loudly, with the state a human can still fix.
    const row = await prisma.withdrawalRequest.findUniqueOrThrow({ where: { id: receipt.id } });
    expect(row.status).toBe("PENDING");
    expect(row.reviewedById).toBeNull();
    expect(await getWallet(userId)).toMatchObject({ winningBalance: 700 });
    expect(await prisma.transaction.count({ where: { userId, type: "REFUND" } })).toBe(0);
  });

  it("handles an unknown or blank request id", async () => {
    const reviewer = await newReviewer();
    for (const id of ["", "   ", randomUUID(), "x".repeat(65)]) {
      const approve = await rejectionOf(approveWithdrawalRequest(id, reviewer.id));
      expect(approve.code).toBe(id.trim().length === 0 || id.length > 64 ? "VALIDATION_ERROR" : "WITHDRAWAL_NOT_FOUND");
    }
    const missing = await rejectionOf(rejectWithdrawalRequest(randomUUID(), reviewer.id, "no such request"));
    expect(missing.code).toBe("WITHDRAWAL_NOT_FOUND");
    expect(missing.status).toBe(404);
  });

  it("leaves the wallet and the ledger reconciled after every path", async () => {
    const userId = await newMember("reconcile");
    const reviewer = await newReviewer();
    await creditWinning(userId, 5_000, `${RUN}-recon-1`, "season total");
    const first = await createWithdrawalRequest(userId, { amount: 1_000, upiId: "r1@bank" });
    const second = await createWithdrawalRequest(userId, { amount: 500, upiId: "r2@bank" });
    const third = await createWithdrawalRequest(userId, { amount: 250, upiId: "r3@bank" });
    await approveWithdrawalRequest(first.id, reviewer.id, "payout-r1-2026");
    await rejectWithdrawalRequest(second.id, reviewer.id, "wrong VPA");

    // winningBalance == winnings + refunds - withdrawals (the amount a payout cut).
    const ledger = await prisma.transaction.findMany({
      where: { userId, balanceType: "WINNING" },
      select: { type: true, amount: true },
    });
    const sum = ledger.reduce((total, row) => total + row.amount, 0);
    const wallet = await getWallet(userId);
    expect(wallet.winningBalance).toBe(sum);

    // Every request that is REJECTED has exactly one debit and one refund; every
    // APPROVED one has a debit and nothing else.
    const statuses = await prisma.withdrawalRequest.findMany({
      where: { id: { in: [first.id, second.id, third.id] } },
      select: { id: true, status: true },
    });
    expect(statuses.map((row) => row.status).sort()).toEqual(["APPROVED", "PENDING", "REJECTED"]);
    for (const row of statuses) {
      const entries = await ledgerFor(userId, row.id);
      const net = entries.reduce((total, entry) => total + entry.amount, 0);
      if (row.status === "REJECTED") expect(net).toBe(0);
      else expect(entries.map((entry) => entry.type)).toEqual(["WITHDRAWAL"]);
    }
  });
});
