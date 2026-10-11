import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_PAGE_SIZE, WalletError, minimumBalanceMessage } from "@/lib/wallet";
import { parseHistoryQuery, walletErrorResponse } from "@/lib/wallet-http";

/**
 * Pure tests for the wallet HTTP helpers. No database, no server.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe("walletErrorResponse", () => {
  it("maps a minimum-balance violation to 422 with the exact message", async () => {
    const response = walletErrorResponse(
      new WalletError("MINIMUM_BALANCE", minimumBalanceMessage()),
    );

    expect(response.status).toBe(422);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      ok: false,
      error: "Minimum 100 tokens must remain in wallet",
      code: "MINIMUM_BALANCE",
    });
  });

  it.each([
    ["WALLET_NOT_FOUND", 404],
    ["PAYMENT_NOT_FOUND", 404],
    ["PAYMENT_NOT_APPROVED", 422],
    ["PAYMENT_MISMATCH", 422],
    ["BALANCE_LIMIT", 422],
    ["DUPLICATE_REFERENCE", 409],
    ["VALIDATION_ERROR", 400],
  ] as const)("maps %s to HTTP %i", (code, status) => {
    const response = walletErrorResponse(new WalletError(code, "message"));
    expect(response.status).toBe(status);
  });

  it("hides unexpected errors behind a generic 500 and logs them", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = walletErrorResponse(new Error("db password leaked here"));

    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string; code: string };
    expect(body.code).toBe("INTERNAL_ERROR");
    expect(body.error).not.toContain("password");
    expect(logged).toHaveBeenCalledOnce();
  });
});

describe("parseHistoryQuery", () => {
  it("accepts an empty query and returns no limit or cursor", () => {
    const result = parseHistoryQuery(new URLSearchParams(""));
    expect(result).toEqual({ ok: true, data: { limit: undefined, cursor: undefined } });
  });

  it("parses a valid limit and cursor", () => {
    const result = parseHistoryQuery(new URLSearchParams("limit=5&cursor=abc"));
    expect(result).toEqual({ ok: true, data: { limit: 5, cursor: "abc" } });
  });

  it.each([
    ["limit=0"],
    [`limit=${MAX_PAGE_SIZE + 1}`],
    ["limit=abc"],
    ["limit=2.5"],
    ["limit="],
  ])("rejects %s with a 400 VALIDATION_ERROR", async (query) => {
    const result = parseHistoryQuery(new URLSearchParams(query));
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.response.status).toBe(400);
    const body = (await result.response.json()) as { code: string; details: unknown };
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.details).toBeDefined();
  });

  it("rejects an oversized cursor", () => {
    const result = parseHistoryQuery(new URLSearchParams(`cursor=${"x".repeat(201)}`));
    expect(result.ok).toBe(false);
  });
});
