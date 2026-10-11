import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { prisma } from "@/lib/prisma";
import {
  creditWinning,
  debitWinning,
  MIN_RETAINED_WINNING_TOKENS,
  minimumBalanceMessage,
  WalletError,
  getWallet,
} from "@/lib/wallet";
import { createWithdrawalRequest } from "@/lib/withdrawal";
import { provisionUser } from "@/lib/user";

/* ==========================================================================
   THE 100-TOKEN FLOOR, EVERYWHERE
   ==========================================================================

   The rule is one number in one file, and this suite is what keeps it that way.
   A member-visible sentence ("Minimum 100 tokens must remain in wallet"), the
   balance the member is shown as spendable, the check in `debitWinning` and the
   check in `applyMovement` are four places that could disagree, and a
   disagreement is a support ticket about money. So: the constant and the copy are
   pinned, the writer is pinned, and — the part a code review misses — no other
   module is allowed to touch a balance column at all.
   ========================================================================== */

const MESSAGE = "Minimum 100 tokens must remain in wallet";

const SRC = join(process.cwd(), "src");

function tsFiles(dir: string = SRC): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...tsFiles(full));
    else if (/\.(ts|tsx)$/.test(entry)) found.push(relative(SRC, full));
  }
  return found.sort();
}

const FILES = tsFiles();

describe("the number itself", () => {
  it("is 100, declared once", () => {
    expect(MIN_RETAINED_WINNING_TOKENS).toBe(100);
    expect(minimumBalanceMessage()).toBe(MESSAGE);

    const declared = FILES.filter((file) =>
      /export const MIN_RETAINED_WINNING_TOKENS/.test(readFileSync(join(SRC, file), "utf8")),
    );
    expect(declared).toEqual([join("lib", "wallet.ts")]);
  });

  it("is never written as a bare 100 next to a balance rule", () => {
    // Anything that enforces or explains the floor must read the constant, so
    // changing the policy is one edit and not a hunt for stray literals.
    const offenders: string[] = [];
    for (const file of FILES) {
      const source = readFileSync(join(SRC, file), "utf8");
      for (const line of source.split("\n")) {
        if (/100/.test(line) && /remain|retained|minimum balance|MINIMUM/i.test(line) && !/MIN_RETAINED_WINNING_TOKENS/.test(line)) {
          // Doc comments quoting the sentence are allowed; code is not.
          if (/^\s*(\/\/|\*|\/\*|["'`])/.test(line.trim()) === false && !line.includes("//")) {
            offenders.push(`${file}: ${line.trim()}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("one writer for every balance", () => {
  it("keeps balance arithmetic inside the wallet service", () => {
    const writers: string[] = [];
    for (const file of FILES) {
      if (file === join("lib", "wallet.ts")) continue;
      const source = readFileSync(join(SRC, file), "utf8");
      if (/(depositBalance|winningBalance)\s*:\s*\{/.test(source) || /prisma\.wallet\.(update|updateMany|create)/.test(source)) {
        writers.push(file);
      }
    }
    expect(writers).toEqual([]);

    // Provisioning does create the row, through the relation, and with zeros — the
    // one thing that is not arithmetic, and so not a way around the rules above.
    const userSource = readFileSync(join(SRC, "lib", "user.ts"), "utf8");
    expect(userSource).toMatch(/wallet:\s*\{\s*create:\s*\{\s*depositBalance:\s*0,\s*winningBalance:\s*0\s*\}/);
  });

  it("refuses to let a route write a wallet directly", () => {
    const offenders = FILES.filter(
      (file) =>
        file.startsWith(join("app", "api")) &&
        /prisma\.wallet|tx\.wallet\.update|prisma\.transaction\.create/.test(readFileSync(join(SRC, file), "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("enforces the floor in the writer, not only in one caller", () => {
    const source = readFileSync(join(SRC, "lib", "wallet.ts"), "utf8");
    const writer = source.slice(source.indexOf("async function applyMovement"));
    expect(writer).toMatch(/current \+ movement\.delta < MIN_RETAINED_WINNING_TOKENS/);
    expect(writer).toMatch(/MINIMUM_BALANCE/);
    // Deposits are never debited, and the writer says so rather than trusting callers.
    expect(writer).toMatch(/A deposit balance is never debited/);
  });
});

describe("the read side agrees with the write side", () => {
  it("reports withdrawable balance as the balance minus the retained floor", () => {
    const source = readFileSync(join(SRC, "lib", "wallet.ts"), "utf8");
    expect(source).toMatch(/withdrawableBalance:\s*Math\.max\(0,\s*wallet\.winningBalance - MIN_RETAINED_WINNING_TOKENS\)/);
  });

  it("the payout rule is the same constant, not a second number", () => {
    const withdrawal = readFileSync(join(SRC, "lib", "withdrawal.ts"), "utf8");
    expect(withdrawal).toMatch(/import\s*\{[\s\S]*?MIN_RETAINED_WINNING_TOKENS[\s\S]*?\} from "@\/lib\/wallet"/);
    expect(withdrawal).not.toMatch(/const MIN[A-Z_]*\s*=\s*100/);
    // And it debits through the wallet service, so it inherits every rule there.
    expect(withdrawal).toMatch(/await debitWinning\(/);
  });
});

/* ==========================================================================
   BEHAVIOUR, AGAINST PostgreSQL WHENEVER IT IS THERE
   ========================================================================== */

const dbAvailable: boolean = await prisma
  .$queryRaw`SELECT 1`
  .then(() => true)
  .catch(() => {
    console.warn("\n  ⚠ PostgreSQL unreachable — skipping the minimum-balance behaviour tests.\n");
    return false;
  });

const run = `minbal-${Date.now()}`;
const createdUserIds: string[] = [];
let userId = "";

beforeAll(async () => {
  if (!dbAvailable) return;
  // `provisionUser` is the only writer of a new member row, and it is what creates
  // the wallet — inserting a user by hand here would test a state the product
  // cannot reach (a member with no wallet).
  const { user } = await provisionUser({
    googleId: `${run}-${randomUUID().slice(0, 8)}`,
    email: `${run}@example.test`,
    name: "Minimum Balance Probe",
    image: null,
  });
  userId = user.id;
  createdUserIds.push(user.id);
  await creditWinning(user.id, 250, `${run}-seed`, "seeded for the floor probe");
});

afterAll(async () => {
  if (!dbAvailable) return;
  await prisma.transaction.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.wallet.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.withdrawalRequest.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe.skipIf(!dbAvailable)("the floor, on a real wallet", () => {
  it("lets a debit land exactly on the floor", async () => {
    const result = await debitWinning(userId, 150, `${run}-to-floor`);
    expect(result.balances).toMatchObject({ winningBalance: 100 });
    const wallet = await getWallet(userId);
    expect(wallet.withdrawableBalance).toBe(0);
  });

  it("refuses one token more, with the exact member-facing sentence", async () => {
    const error = await debitWinning(userId, 1, `${run}-one-too-many`).catch((e) => e);
    expect(error).toBeInstanceOf(WalletError);
    expect((error as WalletError).code).toBe("MINIMUM_BALANCE");
    expect((error as WalletError).message).toBe(MESSAGE);
  });

  it("refuses a payout request that would break the floor, and files nothing", async () => {
    const before = await getWallet(userId);
    const error = await createWithdrawalRequest(userId, {
      amount: 999,
      upiId: "probe@okhdfcbank",
    }).catch((e) => e);
    expect((error as Error).message).toBe(MESSAGE);
    const after = await getWallet(userId);
    expect(after.winningBalance).toBe(before.winningBalance);
    expect(await prisma.withdrawalRequest.count({ where: { userId } })).toBe(0);
  });

  it("refuses to let a debit disguise itself as a credit", async () => {
    // The floor now lives in the writer as well as in `debitWinning`, so the last
    // way around it was to arrive as a credit with a negative amount. `assertAmount`
    // refuses that before anything is touched.
    for (const bad of [-50, 0, 1.5, Number.MAX_SAFE_INTEGER]) {
      const credit = await creditWinning(userId, bad, `${run}-bad-${bad}`).catch((error) => error);
      expect((credit as WalletError).code, `creditWinning(${bad})`).toBe("VALIDATION_ERROR");

      const debit = await debitWinning(userId, bad, `${run}-bad-debit-${bad}`).catch((error) => error);
      expect((debit as WalletError).code, `debitWinning(${bad})`).toBe("VALIDATION_ERROR");
    }

    const wallet = await getWallet(userId);
    expect(wallet.winningBalance).toBe(100);
    expect(
      await prisma.transaction.count({ where: { userId, referenceId: { startsWith: `${run}-bad` } } }),
    ).toBe(0);
  });
});
