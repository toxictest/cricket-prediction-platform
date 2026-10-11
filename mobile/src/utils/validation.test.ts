import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  MINIMUM_BALANCE_MESSAGE,
  MIN_RETAINED_TOKENS,
  MONEY_RULES,
  canonicaliseReference,
  normaliseUpiId,
  validateDepositAmount,
  validateReference,
  validateScreenshotUrl,
  validateUpiId,
  validateWithdrawalAmount,
  withdrawableFrom,
} from "./validation";

/*
 * These tests exist for one reason: the app's rules are a *copy* of the backend's, and a
 * copy needs a witness. Each value is asserted against the number written in the platform
 * repository, with the file named — so when someone changes `MAX_REFERENCE_LENGTH` there,
 * this suite fails here, and the fix is obvious instead of "why did the server refuse a
 * 40-character UTR that my form accepted".
 *
 * The UTR maximum is not hypothetical. This app used to allow 64 because the route's own
 * field does, while `src/lib/bank-reference.ts` caps every reference at 32 — a mismatch
 * that survived review and would have been found by a member, at the worst moment.
 */

const APP_ROOT = join(__dirname, "..", "..");

const rupees = (n: number) => `₹${n}`;
const tokens = (n: number) => `${n} tokens`;

describe("the mirrored numbers", () => {
  it("match the backend's constants, as read from that source", () => {
    // __dirname is mobile/src/utils, so the repository root is three levels up: mobile/ is a
    // directory inside the platform repo, not a sibling of it. Getting this wrong does not
    // fail the suite — every read returns null and the cross-checks skip silently, which is
    // exactly how a witness stops witnessing. Hence the assertion below that they ran.
    const platform = join(__dirname, "..", "..", "..");
    const read = (rel: string) => {
      try {
        return readFileSync(join(platform, rel), "utf8");
      } catch {
        return null;
      }
    };

    const expectations: { file: string; pattern: RegExp; value: number | string }[] = [
      {
        file: "src/lib/payment.ts",
        pattern: /export const MIN_PAYMENT_AMOUNT = (\d+);/,
        value: MONEY_RULES.depositMinAmount,
      },
      {
        file: "src/lib/payment.ts",
        pattern: /export const MAX_PAYMENT_AMOUNT = ([\d_]+);/,
        value: MONEY_RULES.depositMaxAmount,
      },
      {
        file: "src/lib/bank-reference.ts",
        pattern: /export const MIN_REFERENCE_LENGTH = (\d+);/,
        value: MONEY_RULES.referenceMinLength,
      },
      {
        file: "src/lib/bank-reference.ts",
        pattern: /export const MAX_REFERENCE_LENGTH = (\d+);/,
        value: MONEY_RULES.referenceMaxLength,
      },
      {
        file: "src/lib/withdrawal.ts",
        pattern: /const MAX_UPI_ID_LENGTH = (\d+);/,
        value: MONEY_RULES.upiIdMaxLength,
      },
      {
        file: "src/lib/wallet.ts",
        pattern: /export const MIN_RETAINED_WINNING_TOKENS = (\d+);/,
        value: MIN_RETAINED_TOKENS,
      },
      {
        file: "src/lib/withdrawal.ts",
        pattern: /export const MAX_PENDING_PER_MEMBER = (\d+);/,
        value: MONEY_RULES.maxOpenClaims,
      },
    ];

    const skipped: string[] = [];
    const mismatches: string[] = [];
    let checked = 0;
    for (const { file, pattern, value } of expectations) {
      const source = read(file);
      // Run from inside `mobile/` on its own, the backend is not necessarily next door.
      if (source === null) {
        skipped.push(file);
        continue;
      }
      const found = source.match(pattern)?.[1]?.replace(/_/g, "");
      if (found !== undefined) checked += 1;
      if (found === undefined) {
        mismatches.push(`${file}: pattern not found (${pattern.source})`);
      } else if (Number(found) !== Number(value)) {
        mismatches.push(`${file}: ${found} vs app's ${value}`);
      }
    }

    expect(mismatches).toEqual([]);
    // And the check cannot pass by finding nothing: if the backend sources are unreachable,
    // that is a failure of this test's own assumptions, not a reason to call it green.
    expect(skipped, `backend sources unreachable from ${platform}`).toEqual([]);
    expect(checked).toBe(expectations.length);
  });

  it("keeps the retained-floor sentence identical to the server's", () => {
    expect(MINIMUM_BALANCE_MESSAGE).toBe("Minimum 100 tokens must remain in wallet");
    expect(MONEY_RULES.retainedTokens).toBe(100);
  });
});

describe("validateReference — a bank reference", () => {
  const emptyHint = "needed";

  it("accepts a normal UTR and canonicalises it the way the server does", () => {
    expect(validateReference("421900123456", "UTR", emptyHint).error).toBeNull();
    expect(validateReference(" utr-12 34 ", "UTR", emptyHint)).toEqual({
      value: "UTR-1234",
      error: null,
    });
    expect(canonicaliseReference("  ab 12-CD \n")).toBe("AB12-CD");
  });

  it("measures length after canonicalisation, so padding cannot smuggle an short one through", () => {
    expect(validateReference("1234567", "UTR", emptyHint).error).toContain("8 to 32");
    expect(validateReference(" 12 34 56 78 ", "UTR", emptyHint).error).toBeNull();
  });

  it("refuses 33 characters — the maximum is the service's 32, not the route's 64", () => {
    const tooLong = "U".repeat(33);
    expect(validateReference(tooLong, "UTR", emptyHint).error).toContain("8 to 32");
    expect(validateReference("U".repeat(32), "UTR", emptyHint).error).toBeNull();
  });

  it("rejects characters the server would reject", () => {
    expect(validateReference("UTR_12345678", "UTR", emptyHint).error).toContain("letters, digits and hyphens");
    expect(validateReference("UTR.12345678", "UTR", emptyHint).error).toContain("letters, digits and hyphens");
    // Slash and space are the shapes that come from copying a bank statement.
    expect(validateReference("UTR/12345678", "UTR", emptyHint).error).toContain("letters, digits and hyphens");
  });

  it("says the empty thing is empty rather than malformed", () => {
    expect(validateReference("   ", "UTR", emptyHint).error).toBe(emptyHint);
  });
});

describe("validateUpiId — name@bank", () => {
  it("accepts the ordinary shape and lower-cases it", () => {
    expect(validateUpiId("Ramesh@OKHDFCBANK")).toBeNull();
    expect(normaliseUpiId("  Ramesh@OKHDFCBANK ")).toBe("ramesh@okhdfcbank");
  });

  it("requires exactly one @", () => {
    expect(validateUpiId("ramesh")).toBe("A UPI id is exactly name@bank — one @, nothing after the handle.");
    expect(validateUpiId("ra@me@sh")).toContain("one @");
  });

  it("enforces both sides' minimums, matching the 2..256 and 2..64 bounds", () => {
    expect(validateUpiId("r@okhdfcbank")).toBe("The part before the @ is too short.");
    expect(validateUpiId("ra@o")).toBe("The bank handle after the @ is too short.");
    expect(validateUpiId("ra@okhdfcbank")).toBeNull();
  });

  it("enforces both sides' maximums and the whole-string cap", () => {
    expect(validateUpiId(`${"a".repeat(257)}@bank`)).toBe("The part before the @ is too long.");
    expect(validateUpiId(`a1@${"b".repeat(65)}`)).toBe("The bank handle after the @ is too long.");
    // The longest handle that still fits the 320-character whole: 256 + "@" + 63.
    expect(validateUpiId(`${"a".repeat(256)}@${"b".repeat(63)}`)).toBeNull();
    // 256 + 1 + 64 = 321. Each part is inside its own cap and the whole is not, which is
    // the case a field-by-field check would miss — the backend caps the string too.
    expect(validateUpiId(`${"a".repeat(256)}@${"b".repeat(64)}`)).toBe("That is too long to be a UPI id.");
  });

  it("leaves an untouched field to the placeholder", () => {
    expect(validateUpiId("")).toBe("Your UPI id, like name@okhdfcbank.");
  });
});

describe("validateDepositAmount", () => {
  it("takes whole rupees inside the cap", () => {
    expect(validateDepositAmount("500", rupees)).toEqual({ value: 500, error: null });
    expect(validateDepositAmount(" 500 ", rupees).value).toBe(500);
    expect(validateDepositAmount(String(MONEY_RULES.depositMaxAmount), rupees).error).toBeNull();
  });

  it("refuses decimals, zero, negatives and the over-cap", () => {
    expect(validateDepositAmount("10.5", rupees).error).toBe("Amounts are whole rupees, no decimals.");
    expect(validateDepositAmount("0", rupees).error).toContain("Between");
    expect(validateDepositAmount("-500", rupees).error).toBeTruthy();
    expect(validateDepositAmount(String(MONEY_RULES.depositMaxAmount + 1), rupees).error).toContain("Between");
  });

  it("does not accept the junk a keyboard can produce", () => {
    expect(validateDepositAmount("abc", rupees).error).toBe("Amounts are whole rupees, no decimals.");
    expect(validateDepositAmount("1e3", rupees).error).toBe("Amounts are whole rupees, no decimals.");
    expect(validateDepositAmount("", rupees).error).toBe("Enter the amount you paid.");
  });

  it("quotes the money bounds through the app's own formatter", () => {
    expect(validateDepositAmount("0", rupees).error).toBe("Between ₹1 and ₹100000.");
  });
});

describe("validateWithdrawalAmount — the retained floor", () => {
  it("allows leaving exactly the floor behind, and refuses one token less", () => {
    expect(validateWithdrawalAmount("50", 150, tokens)).toEqual({ value: 50, error: null, floor: false });
    const lastAllowed = validateWithdrawalAmount(String(150 - MIN_RETAINED_TOKENS), 150, tokens);
    expect(lastAllowed.error).toBeNull();
    const oneTooMany = validateWithdrawalAmount(String(150 - MIN_RETAINED_TOKENS + 1), 150, tokens);
    expect(oneTooMany.error).toBe(MINIMUM_BALANCE_MESSAGE);
    expect(oneTooMany.floor).toBe(true);
  });

  it("cannot withdraw anything at all at the floor", () => {
    const atFloor = validateWithdrawalAmount("1", MIN_RETAINED_TOKENS, tokens);
    expect(atFloor.floor).toBe(true);
    expect(atFloor.error).toBe(MINIMUM_BALANCE_MESSAGE);
    expect(withdrawableFrom(MIN_RETAINED_TOKENS)).toBe(0);
    expect(withdrawableFrom(101)).toBe(1);
    expect(withdrawableFrom(0)).toBe(0);
  });

  it("separates 'more than you hold' from 'you must leave 100 behind'", () => {
    const overBalance = validateWithdrawalAmount("1000", 500, tokens);
    expect(overBalance.floor).toBe(false);
    expect(overBalance.error).toBe("You hold 500 tokens in winnings.");
  });

  it("rejects non-integers before it does arithmetic", () => {
    expect(validateWithdrawalAmount("10.5", 500, tokens).error).toBe("Tokens are whole numbers.");
    expect(validateWithdrawalAmount("-10", 500, tokens).error).toBe("Tokens are whole numbers.");
    expect(validateWithdrawalAmount("1e2", 500, tokens).error).toBe("Tokens are whole numbers.");
    expect(validateWithdrawalAmount("0", 500, tokens).error).toBe("At least 1 token.");
  });
});

describe("validateScreenshotUrl", () => {
  it("only ever wants an absolute https link", () => {
    expect(validateScreenshotUrl("https://files.example.com/a.png", "hint")).toBeNull();
    expect(validateScreenshotUrl("http://files.example.com/a.png", "hint")).toBe("The link has to start with https://");
    expect(validateScreenshotUrl("files.example.com/a.png", "hint")).toContain("https://");
  });

  it("refuses the schemes that would run in a reviewer's browser, on length alone", () => {
    // The backend also refuses these on shape; the app catches the 2048 overflow, which is
    // the one a paste can produce without anyone meaning to.
    expect(validateScreenshotUrl(`https://x.com/${"p".repeat(2100)}`, "hint")).toContain("2048");
    expect(validateScreenshotUrl("", "hint")).toBe("hint");
  });
});

describe("the services derive limits instead of restating them", () => {
  /**
   * A text check, on purpose. Importing `services/payments.ts` here would drag in axios and
   * AsyncStorage, and the app's test suite should not need a React Native runtime to answer
   * "does anyone still write 64 in this file".
   */
  it("has no second copy of any number from MONEY_RULES", () => {
    const files = ["services/payments.ts", "services/withdrawals.ts", "lib/config.ts"];
    const offenders: string[] = [];
    for (const rel of files) {
      const source = readFileSync(join(APP_ROOT, "src", rel), "utf8");
      for (const [name, value] of Object.entries(MONEY_RULES)) {
        const literal = new RegExp(`(^|[^\\w.])${value}[^\\d]`, "m");
        // `retainedTokens: 100` may appear in copy about the floor, so only the exported
        // limit objects are checked, not prose.
        const limitsBlock = source.match(/export const (PAYMENT_LIMITS|WITHDRAWAL_LIMITS) = \{[\s\S]*?\};/);
        if (limitsBlock && literal.test(limitsBlock[0]) && !limitsBlock[0].includes("MONEY_RULES")) {
          offenders.push(`${rel}: hard-codes ${value} (${name})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the payout floor message imported, not retyped, by the screens", () => {
    const screens = {
      "withdraw.tsx": readFileSync(join(APP_ROOT, "app/(protected)/wallet/withdraw.tsx"), "utf8"),
      "add-money.tsx": readFileSync(join(APP_ROOT, "app/(protected)/wallet/add-money.tsx"), "utf8"),
    };
    for (const [name, source] of Object.entries(screens)) {
      expect(source, `${name} should not retype the server's sentence`).not.toContain(
        '"Minimum 100 tokens must remain in wallet"',
      );
      expect(source, `${name} should not hand-roll a length or amount check`).not.toMatch(
        /length > (32|64|320|100000)\b/,
      );
      expect(source, `${name} should not validate a UPI id inline`).not.toMatch(/split\("@"\)/);
    }
    // The payout screen is the one that needs the floor, so it is the one that must be
    // importing the shared sentence rather than a literal.
    expect(screens["withdraw.tsx"]).toContain("MINIMUM_BALANCE_MESSAGE");
  });
});
