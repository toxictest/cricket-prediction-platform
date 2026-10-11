import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { provisionUser } from "@/lib/user";
import { hashAdminPassword } from "@/lib/admin-password";
import { WalletError, getWallet, MAX_BALANCE } from "@/lib/wallet";
import {
  MAX_PAGE_SIZE,
  MAX_PAYMENT_AMOUNT,
  MAX_PENDING_PER_MEMBER,
  MAX_REVIEW_NOTE_LENGTH,
  MIN_PAYMENT_AMOUNT,
  PaymentError,
  approvePaymentRequest,
  createPaymentRequest,
  getActivePaymentQr,
  listPaymentRequests,
  rejectPaymentRequest,
} from "@/lib/payment";

/**
 * Payment service tests.
 *
 * The rules that matter here are the ones a real deployment is judged on: one
 * UTR buys tokens once, a claim can be reviewed once, and the balance change and
 * the claim's status either both happen or neither does. Everything except the
 * input-validation block runs against PostgreSQL and skips itself when the
 * database is unreachable.
 *
 * Fixtures use a per-run prefix and are removed afterwards.
 */

const RUN = `pm${Date.now()}`;
const createdUserIds: string[] = [];
const createdAdminIds: string[] = [];
const createdMatchIds: string[] = [];
let sequence = 0;

/**
 * Probed at MODULE LOAD (see provisioning.test.ts for why this is not in beforeAll).
 */
const db = await prisma
  .$queryRaw`SELECT 1`
  .then(() => true)
  .catch(() => {
    console.warn("\n  ⚠ PostgreSQL unreachable — skipping payment service tests.\n");
    return false;
  });

/**
 * `getActivePaymentQr` has no filter of its own: it looks for the newest match
 * with a QR. So the selection tests only make sense on a queue nobody else has
 * written to. Rather than deleting other people's fixtures, they skip.
 */
const matchesTableEmpty =
  db &&
  (await prisma.match
    .count()
    .then((count) => count === 0)
    .catch(() => false));

let passwordHash = "";
beforeAll(async () => {
  passwordHash = await hashAdminPassword("test-only-admin-password-1");
});

afterAll(async () => {
  if (!db) return;
  // payment_requests RESTRICT on users; transactions and reviews go first.
  await prisma.transaction.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.paymentRequest.deleteMany({ where: { userId: { in: createdUserIds } } });
  if (createdMatchIds.length > 0) {
    await prisma.match.deleteMany({ where: { id: { in: createdMatchIds } } });
  }
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  if (createdAdminIds.length > 0) {
    await prisma.adminUser.deleteMany({ where: { id: { in: createdAdminIds } } });
  }
});

/* ==========================================================================
   FIXTURES
   ========================================================================== */

async function newMember(label: string): Promise<string> {
  sequence += 1;
  const { user } = await provisionUser({
    googleId: `${RUN}_${label}_${sequence}`,
    name: `Payer ${label}`,
    email: `${RUN}.${label}.${sequence}@example.test`,
  });
  createdUserIds.push(user.id);
  return user.id;
}

async function newReviewer() {
  const admin = await prisma.adminUser.create({
    data: {
      email: `${RUN}-${randomUUID().slice(0, 8)}@example.test`,
      passwordHash,
      name: "Payment Reviewer",
      roles: ["PAYMENT_ADMIN"],
    },
    select: { id: true },
  });
  createdAdminIds.push(admin.id);
  return admin;
}

/** A claim already in the table, bypassing the service. */
async function seedPayment(
  userId: string,
  options: {
    amount?: number;
    tokens?: number;
    status?: "PENDING" | "APPROVED" | "REJECTED";
    utr?: string;
  } = {},
) {
  sequence += 1;
  const amount = options.amount ?? 500;
  return prisma.paymentRequest.create({
    data: {
      userId,
      amount,
      tokensToCredit: options.tokens ?? amount,
      utrNumber: options.utr ?? `${RUN}-UTR-${sequence}`,
      screenshotUrl: "private://payment-test-fixture",
      status: options.status ?? "PENDING",
    },
    select: { id: true, amount: true, tokensToCredit: true },
  });
}

async function newPayment(
  userId: string,
  amount = 500,
  utr?: string,
): Promise<{ id: string }> {
  sequence += 1;
  return createPaymentRequest(userId, {
    amount,
    utrNumber: utr ?? `${RUN}-NEW-${sequence}`,
    screenshotUrl: "https://storage.example.test/proof/x.png",
  });
}

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

/**
 * Creates one fixture match. `tag` lands in the QR url, so a test can tell which
 * row the service picked without comparing ids.
 */
async function newMatch(options: {
  status: "UPCOMING" | "LIVE" | "COMPLETED";
  tag: string;
  qr?: string | null;
  minutesFromNow: number;
}) {
  const match = await prisma.match.create({
    data: {
      title: `${RUN} ${options.tag}`,
      teamA: "Alpha",
      teamB: "Bravo",
      startTime: minutesFromNow(options.minutesFromNow),
      status: options.status,
      qrCodeUrl:
        options.qr === undefined
          ? `https://qr.example.test/${RUN}/${options.tag}.png`
          : options.qr,
    },
    select: { id: true },
  });
  createdMatchIds.push(match.id);
  return match.id;
}

/** A domain failure carries an HTTP status and a machine code. */
type DomainError = Error & { code: string; status: number };

/** Runs the promise and returns its rejection. Fails the test if it resolves. */
async function rejectionOf(promise: Promise<unknown>): Promise<DomainError> {
  try {
    await promise;
  } catch (error) {
    // A review can be refused by the payment state machine or by the wallet
    // service it delegates to. Both are expected failures here.
    if (error instanceof PaymentError || error instanceof WalletError) return error;
    throw error;
  }
  throw new Error("expected the payment operation to be rejected");
}

/* ==========================================================================
   VALIDATION (no database needed)
   ========================================================================== */

describe("claim validation", () => {
  it.each([0, -100, 12.5, Number.NaN, MIN_PAYMENT_AMOUNT - 1, MAX_PAYMENT_AMOUNT + 1, MAX_BALANCE])(
    "rejects the invalid amount %s",
    async (amount) => {
      const error = await rejectionOf(
        createPaymentRequest("no-such-user", {
          amount,
          utrNumber: "123456789012",
          screenshotUrl: "https://storage.example.test/a.png",
        }),
      );
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.status).toBe(400);
    },
  );

  it("rejects a UTR that is too short, too long, or has odd characters", async () => {
    const base = { amount: 100, screenshotUrl: "https://storage.example.test/a.png" };
    expect((await rejectionOf(createPaymentRequest("u", { ...base, utrNumber: " 12 34 " }))).code).toBe(
      "VALIDATION_ERROR",
    );
    expect((await rejectionOf(createPaymentRequest("u", { ...base, utrNumber: "x".repeat(33) }))).code).toBe(
      "VALIDATION_ERROR",
    );
    expect(
      (await rejectionOf(createPaymentRequest("u", { ...base, utrNumber: "12345 67890!" }))).code,
    ).toBe("VALIDATION_ERROR");
  });

  it.each([
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "not a url",
    "https://user:pass@storage.example.test/a.png",
    "http://127.0.0.1:8080/a.png",
    "http://localhost/a.png",
    "http://169.254.169.254/latest/meta-data",
    "http://10.0.0.5/a.png",
    "http://[::1]/a.png",
  ])("rejects the unusable screenshot link %s", async (screenshotUrl) => {
    const error = await rejectionOf(
      createPaymentRequest("no-such-user", {
        amount: 100,
        utrNumber: "123456789012",
        screenshotUrl,
      }),
    );
    expect(error.code).toBe("VALIDATION_ERROR");
  });
});

/* ==========================================================================
   DATABASE: MEMBER FILES A CLAIM
   ========================================================================== */

describe.skipIf(!db)("filing a claim", () => {
  it("stores the claim as PENDING with the token figure the server computed", async () => {
    const userId = await newMember("file");
    const receipt = await newPayment(userId, 750);

    const row = await prisma.paymentRequest.findUniqueOrThrow({
      where: { id: receipt.id },
      select: {
        userId: true,
        amount: true,
        tokensToCredit: true,
        status: true,
        reviewedById: true,
        reviewNote: true,
      },
    });

    expect(row.userId).toBe(userId);
    expect(row.amount).toBe(750);
    // 1 rupee = 1 token, and the member never chose this number.
    expect(row.tokensToCredit).toBe(750);
    expect(row.status).toBe("PENDING");
    expect(row.reviewedById).toBeNull();
    expect(row.reviewNote).toBeNull();
  });

  it("changes no balance while the claim is pending", async () => {
    const userId = await newMember("nofunds");
    await newPayment(userId, 5_000);
    expect(await getWallet(userId)).toMatchObject({
      depositBalance: 0,
      winningBalance: 0,
      total: 0,
    });
    expect(await prisma.transaction.count({ where: { userId } })).toBe(0);
  });

  it("normalises the UTR so spacing and case cannot dodge the uniqueness rule", async () => {
    const userId = await newMember("utr");
    await createPaymentRequest(userId, {
      amount: 200,
      utrNumber: `  ${RUN}-utr-1  `,
      screenshotUrl: "https://storage.example.test/a.png",
    });

    const stored = await prisma.paymentRequest.findFirstOrThrow({
      where: { userId },
      select: { utrNumber: true },
    });
    expect(stored.utrNumber).toBe(`${RUN}-UTR-1`.toUpperCase());

    // Same reference, different casing: still a duplicate.
    const error = await rejectionOf(
      createPaymentRequest(userId, {
        amount: 200,
        utrNumber: `${RUN}-UTR-1`.toLowerCase(),
        screenshotUrl: "https://storage.example.test/b.png",
      }),
    );
    expect(error.code).toBe("DUPLICATE_UTR");
    expect(error.status).toBe(409);
  });

  it("refuses a UTR that another member already used, without saying whose it was", async () => {
    const first = await newMember("dup-a");
    const second = await newMember("dup-b");
    // Stored upper-cased, so the assertion has to use the normalised form.
    const utr = `${RUN}-SHARED-UTR`.toUpperCase();

    await newPayment(first, 300, utr);
    const error = await rejectionOf(newPayment(second, 300, utr));

    expect(error.code).toBe("DUPLICATE_UTR");
    expect(error.message).not.toContain(first);
    expect(await prisma.paymentRequest.count({ where: { utrNumber: utr } })).toBe(1);
  });

  it("caps how many claims one member can leave unreviewed", async () => {
    const userId = await newMember("cap");
    for (let i = 0; i < MAX_PENDING_PER_MEMBER; i += 1) {
      await newPayment(userId, 100 + i);
    }

    const error = await rejectionOf(newPayment(userId, 999));
    expect(error.code).toBe("TOO_MANY_PENDING");
    expect(error.status).toBe(429);

    // Approving one frees exactly one slot.
    const [oldest] = await prisma.paymentRequest.findMany({
      where: { userId, status: "PENDING" },
      orderBy: { createdAt: "asc" },
      take: 1,
      select: { id: true },
    });
    const reviewer = await newReviewer();
    await approvePaymentRequest(oldest.id, reviewer.id);

    await expect(newPayment(userId, 400)).resolves.toMatchObject({ status: "PENDING" });
    expect(await prisma.paymentRequest.count({ where: { userId, status: "PENDING" } })).toBe(
      MAX_PENDING_PER_MEMBER,
    );
  });
});

/* ==========================================================================
   DATABASE: APPROVE
   ========================================================================== */

describe.skipIf(!db)("approving a claim", () => {
  it("credits the deposit balance, stamps the reviewer and writes one ledger row", async () => {
    const userId = await newMember("approve");
    const reviewer = await newReviewer();
    const claim = await newPayment(userId, 1_200);

    const result = await approvePaymentRequest(claim.id, reviewer.id, "verified in statement");

    expect(result.payment.status).toBe("APPROVED");
    expect(result.payment.reviewedBy?.id).toBe(reviewer.id);
    expect(result.payment.reviewNote).toBe("verified in statement");
    expect(result.wallet).toMatchObject({
      depositBalance: 1_200,
      winningBalance: 0,
      total: 1_200,
    });

    if (!result.transaction) {
      throw new Error("an approval must return the ledger row it wrote");
    }
    expect(result.transaction).toMatchObject({
      type: "DEPOSIT",
      balanceType: "DEPOSIT",
      amount: 1_200,
      balanceAfter: 1_200,
      referenceId: claim.id,
    });

    const ledgerRow = await prisma.transaction.findFirstOrThrow({
      where: { referenceId: claim.id, type: "DEPOSIT" },
      select: { userId: true, description: true },
    });
    expect(ledgerRow.userId).toBe(userId);
    expect(ledgerRow.description).toContain("Deposit approved (UTR ");

    // The cached balance and the ledger agree, which is what reconciliation checks.
    const ledger = await prisma.transaction.aggregate({
      where: { userId, type: "DEPOSIT" },
      _sum: { amount: true },
    });
    expect(ledger._sum.amount).toBe(1_200);
  });

  it("credits the reviewed token figure, so a partial approval is possible", async () => {
    const userId = await newMember("partial");
    const reviewer = await newReviewer();
    // Member claims ₹1000; the reviewer finds only ₹900 in the statement.
    const claim = await seedPayment(userId, { amount: 1_000, tokens: 900 });

    const result = await approvePaymentRequest(claim.id, reviewer.id);
    expect(result.wallet?.depositBalance).toBe(900);
    if (!result.transaction) {
      throw new Error("an approval must return the ledger row it wrote");
    }
    expect(result.transaction.amount).toBe(900);
  });

  it("leaves the winning balance alone, so a deposit can never be withdrawn", async () => {
    const userId = await newMember("winning-untouched");
    const reviewer = await newReviewer();
    const claim = await seedPayment(userId, { amount: 250, status: "PENDING" });
    await approvePaymentRequest(claim.id, reviewer.id);
    expect((await getWallet(userId)).winningBalance).toBe(0);
  });

  it("refuses a second approval and does not credit twice", async () => {
    const userId = await newMember("twice");
    const reviewer = await newReviewer();
    const claim = await newPayment(userId, 600);

    await approvePaymentRequest(claim.id, reviewer.id);
    const error = await rejectionOf(approvePaymentRequest(claim.id, reviewer.id));

    expect(error.code).toBe("NOT_PENDING");
    expect(error.status).toBe(409);
    expect(error.message).toContain("APPROVED");
    expect((await getWallet(userId)).depositBalance).toBe(600);
    expect(await prisma.transaction.count({ where: { userId, type: "DEPOSIT" } })).toBe(1);
  });

  it("credits once when two reviewers approve at the same moment", async () => {
    const userId = await newMember("race");
    const [first, second] = await Promise.all([newReviewer(), newReviewer()]);
    const claim = await newPayment(userId, 850);

    const settled = await Promise.allSettled([
      approvePaymentRequest(claim.id, first.id),
      approvePaymentRequest(claim.id, second.id),
    ]);

    const fulfilled = settled.filter((outcome) => outcome.status === "fulfilled");
    const rejected = settled.filter((outcome) => outcome.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(PaymentError);

    expect((await getWallet(userId)).depositBalance).toBe(850);
    expect(await prisma.transaction.count({ where: { userId, type: "DEPOSIT" } })).toBe(1);
  });

  it("refuses to approve a claim that was rejected", async () => {
    const userId = await newMember("rejected");
    const reviewer = await newReviewer();
    const claim = await newPayment(userId, 400);
    await rejectPaymentRequest(claim.id, reviewer.id, "UTR not found in our account");

    const error = await rejectionOf(approvePaymentRequest(claim.id, reviewer.id));
    expect(error.code).toBe("NOT_PENDING");
    expect((await getWallet(userId)).depositBalance).toBe(0);
  });

  it("returns 404 for a claim that does not exist and for a blank id", async () => {
    const reviewer = await newReviewer();
    expect((await rejectionOf(approvePaymentRequest("does-not-exist", reviewer.id))).code).toBe(
      "PAYMENT_NOT_FOUND",
    );
    expect((await rejectionOf(approvePaymentRequest("   ", reviewer.id))).code).toBe(
      "VALIDATION_ERROR",
    );
  });

  it("rolls the status back when the member has no wallet, so the claim stays approvable", async () => {
    const userId = await newMember("no-wallet");
    const reviewer = await newReviewer();
    const claim = await newPayment(userId, 700);

    // Simulates a member created before the wallet backfill.
    await prisma.wallet.delete({ where: { userId } });

    const error = await rejectionOf(approvePaymentRequest(claim.id, reviewer.id));
    expect(error.code).toBe("WALLET_NOT_FOUND");

    const after = await prisma.paymentRequest.findUniqueOrThrow({
      where: { id: claim.id },
      select: { status: true, reviewedById: true },
    });
    expect(after.status).toBe("PENDING");
    expect(after.reviewedById).toBeNull();

    // Put the wallet back and the same claim approves cleanly: nothing was half-applied.
    await prisma.wallet.create({ data: { userId, depositBalance: 0, winningBalance: 0 } });
    await expect(approvePaymentRequest(claim.id, reviewer.id)).resolves.toMatchObject({
      payment: { status: "APPROVED" },
    });
    expect((await getWallet(userId)).depositBalance).toBe(700);
  });
});

/* ==========================================================================
   DATABASE: REJECT
   ========================================================================== */

describe.skipIf(!db)("rejecting a claim", () => {
  it("stores the note and the reviewer, and moves no money", async () => {
    const userId = await newMember("reject");
    const reviewer = await newReviewer();
    const claim = await newPayment(userId, 300);

    const result = await rejectPaymentRequest(claim.id, reviewer.id, "  amount does not match  ");
    expect(result.payment.status).toBe("REJECTED");
    expect(result.payment.reviewNote).toBe("amount does not match");
    expect(result.payment.reviewedBy?.id).toBe(reviewer.id);
    expect(result.wallet).toBeUndefined();

    expect((await getWallet(userId)).total).toBe(0);
    expect(await prisma.transaction.count({ where: { userId } })).toBe(0);
  });

  it("requires a reason, so a member is never left with an unexplained rejection", async () => {
    const userId = await newMember("reject-note");
    const reviewer = await newReviewer();
    const claim = await newPayment(userId, 300);

    for (const reviewNote of ["", "   ", "ab", "x".repeat(MAX_REVIEW_NOTE_LENGTH + 1)]) {
      const error = await rejectionOf(rejectPaymentRequest(claim.id, reviewer.id, reviewNote));
      expect(error.code).toBe("VALIDATION_ERROR");
    }
    const missing = await rejectionOf(
      rejectPaymentRequest(claim.id, reviewer.id, undefined as unknown as string),
    );
    expect(missing.code).toBe("VALIDATION_ERROR");

    expect((await getWallet(userId)).total).toBe(0);
  });

  it("refuses a second review in either direction", async () => {
    const userId = await newMember("reject-twice");
    const reviewer = await newReviewer();
    const claim = await newPayment(userId, 300);

    await rejectPaymentRequest(claim.id, reviewer.id, "duplicate reference");
    expect((await rejectionOf(rejectPaymentRequest(claim.id, reviewer.id, "again"))).code).toBe(
      "NOT_PENDING",
    );

    const other = await newMember("approve-then-reject");
    const approved = await newPayment(other, 300);
    await approvePaymentRequest(approved.id, reviewer.id);
    const error = await rejectionOf(rejectPaymentRequest(approved.id, reviewer.id, "too late"));
    expect(error.code).toBe("NOT_PENDING");
    expect(error.message).toContain("APPROVED");
  });

  it("returns 404 for a claim that does not exist", async () => {
    const reviewer = await newReviewer();
    expect((await rejectionOf(rejectPaymentRequest("missing-id", reviewer.id, "no such claim"))).code).toBe(
      "PAYMENT_NOT_FOUND",
    );
  });
});

/* ==========================================================================
   DATABASE: THE QUEUE
   ========================================================================== */

describe.skipIf(!db)("the review queue", () => {
  it("filters, pages newest first, and reports the queue totals", async () => {
    const userId = await newMember("queue");
    const reviewer = await newReviewer();
    for (let i = 0; i < 4; i += 1) await newPayment(userId, 100 + i);

    const oldest = await prisma.paymentRequest.findFirstOrThrow({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    await rejectPaymentRequest(oldest.id, reviewer.id, "reference not in our account");

    const all = await listPaymentRequests({ userId, limit: MAX_PAGE_SIZE });
    expect(all.items).toHaveLength(4);
    expect(all.nextCursor).toBeNull();
    expect(all.counts).toEqual({ PENDING: 3, APPROVED: 0, REJECTED: 1 });

    const stamps = all.items.map((item) => item.createdAt.getTime());
    expect([...stamps].sort((a, b) => b - a)).toEqual(stamps);

    // Row shape: the member behind the claim, the proof link, and nothing secret.
    const first = all.items[0];
    expect(first.user).toMatchObject({ id: userId });
    expect(first.user.email).toContain(RUN);
    expect(first.screenshotUrl).toContain("storage.example.test");
    expect(first.amount).toBe(103);
    expect(first.status).toBe("PENDING");
    expect("passwordHash" in (first.user as Record<string, unknown>)).toBe(false);

    // The status filter narrows the rows, and the header counts stay queue-wide.
    const pending = await listPaymentRequests({ userId, status: "PENDING", limit: MAX_PAGE_SIZE });
    expect(pending.items).toHaveLength(3);
    expect(pending.items.every((item) => item.status === "PENDING")).toBe(true);
    expect(pending.counts).toEqual({ PENDING: 3, APPROVED: 0, REJECTED: 1 });

    // Keyset paging: two pages, every row once, the reviewed row last with its reviewer.
    const page1 = await listPaymentRequests({ userId, limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(typeof page1.nextCursor).toBe("string");

    const page2 = await listPaymentRequests({
      userId,
      limit: 2,
      cursor: page1.nextCursor,
    });
    expect(page2.items).toHaveLength(2);
    expect(page2.nextCursor).toBeNull();

    const seen = [...page1.items, ...page2.items].map((item) => item.id).sort();
    expect(seen).toEqual(all.items.map((item) => item.id).sort());

    const reviewed = page2.items.find((item) => item.reviewedBy !== null);
    expect(reviewed?.status).toBe("REJECTED");
    expect(Object.keys(reviewed?.reviewedBy ?? {}).sort()).toEqual(["email", "id", "name"]);
  });

  it("rejects a bad limit or cursor instead of quietly defaulting", async () => {
    for (const limit of [0, -1, 1.5, 101]) {
      const error = await rejectionOf(listPaymentRequests({ limit }));
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.message).toContain("1 to 100");
    }

    const cursor = await rejectionOf(listPaymentRequests({ cursor: "not-a-cursor" }));
    expect(cursor.code).toBe("VALIDATION_ERROR");
    expect(cursor.status).toBe(400);
  });
});

/* ==========================================================================
   DATABASE: WHICH QR TO SHOW
   ========================================================================== */

describe.skipIf(!db || !matchesTableEmpty)("the payment QR", () => {
  async function clearFixtures(): Promise<void> {
    await prisma.match.deleteMany({ where: { id: { in: createdMatchIds } } });
    createdMatchIds.length = 0;
  }

  it("prefers the newest LIVE match over a later upcoming one", async () => {
    await clearFixtures();
    await newMatch({ status: "UPCOMING", tag: "upcoming", minutesFromNow: 60 });
    await newMatch({ status: "LIVE", tag: "live-older", minutesFromNow: -120 });
    await newMatch({ status: "LIVE", tag: "live-newer", minutesFromNow: -5 });

    const qr = await getActivePaymentQr();
    expect(qr.qrCodeUrl).toBe(`https://qr.example.test/${RUN}/live-newer.png`);
    expect(qr.status).toBe("LIVE");
    expect(qr.title).toBe(`${RUN} live-newer`);
    expect(qr.teamA).toBe("Alpha");
    expect(qr.teamB).toBe("Bravo");
    expect(qr.matchId).toBeTypeOf("string");
  });

  it("falls back to the newest UPCOMING match once nothing is live", async () => {
    await clearFixtures();
    await newMatch({ status: "UPCOMING", tag: "soon", minutesFromNow: 30 });
    await newMatch({ status: "UPCOMING", tag: "later", minutesFromNow: 300 });

    const qr = await getActivePaymentQr();
    expect(qr.qrCodeUrl).toBe(`https://qr.example.test/${RUN}/later.png`);
    expect(qr.status).toBe("UPCOMING");
  });

  it("skips a match whose QR was cleared, and ignores finished matches", async () => {
    await clearFixtures();
    await newMatch({ status: "LIVE", tag: "blank", qr: "   ", minutesFromNow: -1 });
    await newMatch({ status: "LIVE", tag: "null-qr", qr: null, minutesFromNow: -2 });
    await newMatch({ status: "COMPLETED", tag: "finished", minutesFromNow: -900 });
    await newMatch({ status: "UPCOMING", tag: "usable", minutesFromNow: 45 });

    const qr = await getActivePaymentQr();
    expect(qr.qrCodeUrl).toBe(`https://qr.example.test/${RUN}/usable.png`);
  });

  it("reports 404 when nothing has a QR, so the UI can hide the panel", async () => {
    await clearFixtures();
    await newMatch({ status: "LIVE", tag: "no-qr", qr: null, minutesFromNow: -1 });

    const error = await rejectionOf(getActivePaymentQr());
    expect(error.code).toBe("NO_ACTIVE_QR");
    expect(error.status).toBe(404);
  });
});
