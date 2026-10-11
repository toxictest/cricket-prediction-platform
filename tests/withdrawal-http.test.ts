import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MIN_REFERENCE_LENGTH,
  canonicalizeReference,
  isWellFormedReference,
  referenceShapeMessage,
} from "@/lib/bank-reference";
import { MIN_RETAINED_WINNING_TOKENS, WalletError } from "@/lib/wallet";
import { MAX_REVIEW_NOTE_LENGTH, MIN_REVIEW_NOTE_LENGTH } from "@/lib/review-note";
import { WithdrawalError, normalizeReference, normalizeReviewNote, normalizeUpiId } from "@/lib/withdrawal";
import {
  parseApproveBody,
  parseCreateBody,
  parseListQuery,
  parseRejectBody,
  withdrawalErrorResponse,
} from "@/lib/withdrawal-http";

/**
 * Pure tests for the payout HTTP layer and the payout-side validators. No
 * database and no server: these pin the envelope a client reads and the rules
 * that decide whether a request is worth acting on at all.
 */

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

/* ==========================================================================
   VALIDATORS
   ========================================================================== */

describe("VPA validation", () => {
  it("canonicalises to lower case", () => {
    expect(normalizeUpiId("Rahul.Sharma@YBL")).toBe("rahul.sharma@ybl");
    expect(normalizeUpiId(" 9876543210@paytm ")).toBe("9876543210@paytm");
    expect(normalizeUpiId("a.b-c_d@okhdfcbank")).toBe("a.b-c_d@okhdfcbank");
  });

  it.each([
    "",
    "   ",
    "justastring",
    "one@two@three",
    "@bank",
    "user@",
    "a@bank",
    "ab@b",
    "ab@123",
    "ab@bank.com",
    "u ser@bank",
    "user@bank#1",
  ])("rejects %o", (value) => {
    expect(() => normalizeUpiId(value)).toThrow(WithdrawalError);
  });

  it("trims the value it accepts, without trusting the client to", () => {
    expect(normalizeUpiId("ab@bank ")).toBe("ab@bank");
    expect(normalizeUpiId("\tname@okaxisbank\n")).toBe("name@okaxisbank");
  });

  it("names the half that is wrong, because the form shows the error under one field", () => {
    expect(() => normalizeUpiId("ab@12345")).toThrow(/bank handle/);
    expect(() => normalizeUpiId("ab@bank.com")).toThrow(/letters only/);
    expect(() => normalizeUpiId("u ser@bank")).toThrow(/part before @/);
    expect(() => normalizeUpiId("a@ybl")).toThrow(/before @/);
    expect(() => normalizeUpiId("noref")).toThrow(/name@bank/);
  });

  it("caps the whole string, so a field can be given a size in the UI", () => {
    const local = "a".repeat(257);
    expect(() => normalizeUpiId(`${local}@ybl`)).toThrow(/before @/);
    expect(() => normalizeUpiId(`${"a".repeat(200)}@${"b".repeat(65)}`)).toThrow(/bank handle/);
  });
});

describe("payout reference validation", () => {
  it("shares the rules with an inbound UTR", () => {
    const value = " utr 2026-0001 ";
    expect(normalizeReference(value)).toBe(canonicalizeReference(value));
    expect(normalizeReference(value)).toBe("UTR2026-0001");
  });

  it.each(["", "1234567", "a".repeat(MIN_REFERENCE_LENGTH - 1), "utr_2026", "utr;drop table"])(
    "rejects %o",
    (value) => {
      expect(() => normalizeReference(value)).toThrow(WithdrawalError);
    },
  );

  it("quotes the shared shape message", () => {
    expect(() => normalizeReference("123")).toThrow(referenceShapeMessage("adminUtr"));
    expect(referenceShapeMessage("adminUtr")).toContain("adminUtr");
  });

  it("accepts the shapes Indian rails actually produce", () => {
    for (const value of ["912345678901", "N22091234567890ABCDEF1", "UTR-2026-000001"]) {
      expect(isWellFormedReference(canonicalizeReference(value))).toBe(true);
    }
  });
});

describe("review note validation", () => {
  it("trims and keeps the length bounds shared with the deposit queue", () => {
    expect(normalizeReviewNote("  VPA belongs to someone else  ")).toBe("VPA belongs to someone else");
    expect(() => normalizeReviewNote("ab")).toThrow(new RegExp(String(MIN_REVIEW_NOTE_LENGTH)));
    expect(() => normalizeReviewNote("x".repeat(MAX_REVIEW_NOTE_LENGTH + 1))).toThrow(
      new RegExp(String(MAX_REVIEW_NOTE_LENGTH)),
    );
  });
});

/* ==========================================================================
   ERROR MAPPING
   ========================================================================== */

describe("withdrawalErrorResponse", () => {
  it.each([
    ["VALIDATION_ERROR", 400],
    ["PAYMENTS_DISABLED", 503],
    ["WITHDRAWAL_NOT_FOUND", 404],
    ["NOT_PENDING", 409],
    ["TOO_MANY_PENDING", 429],
  ] as const)("maps %s to %i", async (code, status) => {
    const response = withdrawalErrorResponse(new WithdrawalError(code, `message for ${code}`));
    expect(response.status).toBe(status);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(bodyOf(response)).resolves.toEqual({
      ok: false,
      error: `message for ${code}`,
      code,
    });
  });

  it("passes a wallet refusal through with its own status", async () => {
    const response = withdrawalErrorResponse(
      new WalletError(
        "MINIMUM_BALANCE",
        `Minimum ${MIN_RETAINED_WINNING_TOKENS} tokens must remain in wallet`,
      ),
    );
    expect(response.status).toBe(422);
    await expect(bodyOf(response)).resolves.toMatchObject({
      code: "MINIMUM_BALANCE",
      error: "Minimum 100 tokens must remain in wallet",
    });
  });

  it("keeps a refund mismatch a 422 rather than hiding it as a server error", async () => {
    const response = withdrawalErrorResponse(
      new WalletError("REFUND_NOT_MATCHED", "that debit does not match this request"),
    );
    expect(response.status).toBe(422);
    await expect(bodyOf(response)).resolves.toMatchObject({ code: "REFUND_NOT_MATCHED" });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("reports anything unexpected as 500 without leaking it", async () => {
    const response = withdrawalErrorResponse(new Error("connection pool exploded"));
    expect(response.status).toBe(500);
    await expect(bodyOf(response)).resolves.toEqual({
      ok: false,
      error: "Something went wrong. Please try again.",
      code: "INTERNAL_ERROR",
    });
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(String(consoleError.mock.calls[0]?.[0])).toMatch(
      /^\[withdrawal\] unhandled error: Error: connection pool exploded/,
    );
  });
});

/* ==========================================================================
   QUERY PARSING
   ========================================================================== */

describe("parseListQuery", () => {
  const url = (search: string) =>
    parseListQuery(new URL(`http://localhost/api/admin/withdrawals${search}`).searchParams);

  it("accepts the queue filters", async () => {
    const result = await url("?status=REJECTED&userId=usr_1&limit=50&cursor=abc");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ status: "REJECTED", userId: "usr_1", limit: 50, cursor: "abc" });
    }
  });

  it("accepts an empty query string", async () => {
    const result = await url("");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({});
  });

  it.each(["?status=PAID", "?limit=0", "?limit=101", "?limit=many", "?userId=", "?cursor="])(
    "rejects %s with a 400 and field details",
    async (search) => {
      const result = await url(search);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(400);
        await expect(bodyOf(result.response)).resolves.toMatchObject({
          ok: false,
          code: "VALIDATION_ERROR",
          error: "Invalid query parameters",
        });
      }
    },
  );
});

/* ==========================================================================
   BODY PARSING
   ========================================================================== */

describe("parseCreateBody", () => {
  it("accepts the two fields a member may send", async () => {
    const result = parseCreateBody({ amount: 500, upiId: "rahul@ybl" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ amount: 500, upiId: "rahul@ybl" });
  });

  it("checks types and shapes, and leaves value rules to the service", () => {
    // A fractional or negative amount is passed through: `assertAmount` is the
    // single authority on what a valid amount is, so the same 400 with the same
    // message comes from either entry point. Here the parser only guarantees the
    // fields exist and are of a type the service can be handed.
    const result = parseCreateBody({ amount: 500.5, upiId: "rahul@ybl" });
    expect(result.ok).toBe(true);
  });

  it("rejects a body that tries to set server-owned fields", async () => {
    for (const body of [
      { amount: 500, upiId: "rahul@ybl", status: "APPROVED" },
      { amount: 500, upiId: "rahul@ybl", tokensToCredit: 500 },
      { amount: 500, upiId: "rahul@ybl", adminUtr: "912345678901" },
      { amount: 500, upiId: "rahul@ybl", userId: "someone-else" },
      { amount: "500", upiId: "rahul@ybl" },
      { upiId: "rahul@ybl" },
      { amount: 500 },
      null,
      [],
      "amount=500",
    ]) {
      const result = parseCreateBody(body);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(400);
        await expect(bodyOf(result.response)).resolves.toMatchObject({ code: "VALIDATION_ERROR" });
      }
    }
  });
});

describe("parseApproveBody", () => {
  it.each([{}, { adminUtr: null }, { adminUtr: undefined }])(
    "accepts %o — a payout reference is not always available",
    (body) => {
      const result = parseApproveBody(body);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.adminUtr ?? null).toBeNull();
    },
  );

  it("keeps a supplied reference for the service to canonicalise", () => {
    const result = parseApproveBody({ adminUtr: " utr2026-0001 " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.adminUtr).toBe("utr2026-0001");
  });

  it.each([{ adminUtr: "123" }, { adminUtr: "x".repeat(33) }, { reviewed: true }, { amount: 500 }, undefined, null, "adminUtr=1234567890"])(
    "rejects %o",
    (body) => {
      const result = parseApproveBody(body);
      expect(result.ok).toBe(false);
    },
  );
});

describe("parseRejectBody", () => {
  it("requires a note a member can act on", async () => {
    const ok = parseRejectBody({ reviewNote: "the VPA does not match the registered name" });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.reviewNote).toBe("the VPA does not match the registered name");

    for (const body of [{}, { reviewNote: "ab" }, { reviewNote: " " }, { note: "wrong field" }, null]) {
      const result = parseRejectBody(body);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(400);
        await expect(bodyOf(result.response)).resolves.toMatchObject({ code: "VALIDATION_ERROR" });
      }
    }
  });
});
