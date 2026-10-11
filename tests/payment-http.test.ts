import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MONEY_MODE_OFF_MESSAGE, moneyModeEnabled } from "@/lib/feature-flags";
import { apiJson, featureDisabledResponse, readJsonBody, unauthorizedResponse } from "@/lib/http";
import { WalletError } from "@/lib/wallet";
import {
  MAX_PAYMENT_AMOUNT,
  MIN_PAYMENT_AMOUNT,
  PaymentError,
  assertAmount,
  normalizeReviewNote,
  normalizeScreenshotUrl,
  normalizeUtr,
} from "@/lib/payment";
import {
  parseApproveBody,
  parseCreateBody,
  parseListQuery,
  parseRejectBody,
  paymentErrorResponse,
} from "@/lib/payment-http";

/**
 * Pure tests for the payment HTTP layer and the legal gate. No database, no
 * server: these pin the shapes and the rules that decide whether a request is
 * even worth acting on.
 */

let consoleError: ReturnType<typeof vi.spyOn>;
let consoleWarn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/* ==========================================================================
   MONEY_MODE
   ========================================================================== */

describe("money gate", () => {
  it("reads the accepted spellings of on and off", () => {
    for (const value of ["true", "TRUE", "1", " on ", "yes", "enabled"]) {
      vi.stubEnv("MONEY_MODE", value);
      expect(moneyModeEnabled()).toBe(true);
    }
    for (const value of ["false", "0", "OFF", "no", "disabled", ""]) {
      vi.stubEnv("MONEY_MODE", value);
      expect(moneyModeEnabled()).toBe(false);
    }
  });

  it("is on outside production and off in production when unset", () => {
    const saved = process.env.MONEY_MODE;
    delete process.env.MONEY_MODE;
    try {
      vi.stubEnv("NODE_ENV", "test");
      expect(moneyModeEnabled()).toBe(true);

      vi.stubEnv("NODE_ENV", "production");
      expect(moneyModeEnabled()).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.MONEY_MODE;
      else process.env.MONEY_MODE = saved;
    }
  });

  it("an explicit value outranks the production default", () => {
    const saved = process.env.MONEY_MODE;
    try {
      vi.stubEnv("NODE_ENV", "production");
      process.env.MONEY_MODE = "true";
      expect(moneyModeEnabled()).toBe(true);

      process.env.MONEY_MODE = "false";
      expect(moneyModeEnabled()).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.MONEY_MODE;
      else process.env.MONEY_MODE = saved;
    }
  });

  it("treats an unrecognised value as unset and says so once", () => {
    vi.stubEnv("MONEY_MODE", "maybe");
    vi.stubEnv("NODE_ENV", "production");

    expect(moneyModeEnabled()).toBe(false);
    expect(consoleWarn).toHaveBeenCalledTimes(1);
    expect(String(consoleWarn.mock.calls[0][0])).toContain('MONEY_MODE="maybe"');
  });

  it("refuses in the service and in the route the same way", () => {
    vi.stubEnv("MONEY_MODE", "off");
    const response = featureDisabledResponse(MONEY_MODE_OFF_MESSAGE, "PAYMENTS_DISABLED");
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("retry-after")).toBe("3600");
  });
});

/* ==========================================================================
   ERROR ENVELOPE
   ========================================================================== */

describe("paymentErrorResponse", () => {
  it.each([
    ["VALIDATION_ERROR", 400],
    ["PAYMENTS_DISABLED", 503],
    ["NO_ACTIVE_QR", 404],
    ["PAYMENT_NOT_FOUND", 404],
    ["NOT_PENDING", 409],
    ["DUPLICATE_UTR", 409],
    ["TOO_MANY_PENDING", 429],
  ] as const)("maps %s to %i", async (code, status) => {
    const response = paymentErrorResponse(new PaymentError(code, `message for ${code}`));

    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      ok: false,
      error: `message for ${code}`,
      code,
    });
  });

  it("passes a wallet failure through with the wallet's own code", async () => {
    const response = paymentErrorResponse(
      new WalletError("PAYMENT_MISMATCH", "Amount does not match the tokens approved for this payment"),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ ok: false, code: "PAYMENT_MISMATCH" });
  });

  it("hides an unexpected failure behind a 500 and logs the real cause", async () => {
    const response = paymentErrorResponse(new Error("connection refused"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      error: "Something went wrong. Please try again.",
      code: "INTERNAL_ERROR",
    });
    expect(consoleError).toHaveBeenCalledWith("[payment] unexpected error:", expect.any(Error));
  });
});

describe("member envelopes", () => {
  it("401 uses the same body on every member route", async () => {
    const response = unauthorizedResponse();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      ok: false,
      error: "Not authenticated",
      code: "UNAUTHORIZED",
    });
  });

  it("apiJson never lets a shared cache hold a balance or a claim", async () => {
    const response = apiJson({ ok: true, data: { amount: 100 } }, 201, { "X-Trace": "abc" });
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-trace")).toBe("abc");
  });
});

/* ==========================================================================
   BODY READING
   ========================================================================== */

function request(contentType: string | null, body?: string): Request {
  return new Request("http://localhost:3000/api/payment/request", {
    method: "POST",
    headers: contentType ? { "content-type": contentType } : undefined,
    body,
  });
}

describe("readJsonBody", () => {
  it("refuses a form post, which a cross-site page could send without a preflight", async () => {
    for (const contentType of [
      "application/x-www-form-urlencoded",
      "text/plain",
      "multipart/form-data; boundary=x",
      null,
    ]) {
      const result = await readJsonBody(request(contentType, "amount=100"));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(415);
        expect(await result.response.json()).toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE" });
      }
    }
  });

  it("separates a broken body from a missing one", async () => {
    const broken = await readJsonBody(request("application/json", "{amount:"));
    expect(broken.ok).toBe(false);
    if (!broken.ok) {
      expect(broken.response.status).toBe(400);
      expect(await broken.response.json()).toMatchObject({ code: "INVALID_JSON" });
    }

    const missing = await readJsonBody(request("application/json", "   "));
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(await missing.response.json()).toMatchObject({ code: "INVALID_JSON" });
    }

    const emptyIsFine = await readJsonBody(request("application/json", ""), {
      allowEmpty: true,
    });
    expect(emptyIsFine).toEqual({ ok: true, data: {} });
  });
});

/* ==========================================================================
   QUERY AND BODY SCHEMAS
   ========================================================================== */

describe("parseListQuery", () => {
  it("accepts an empty query and the documented filters", () => {
    expect(parseListQuery(new URLSearchParams(""))).toEqual({ ok: true, data: {} });

    const parsed = parseListQuery(
      new URLSearchParams("status=PENDING&limit=5&cursor=abc&userId=cuid123"),
    );
    expect(parsed).toEqual({
      ok: true,
      data: { status: "PENDING", limit: 5, cursor: "abc", userId: "cuid123" },
    });
  });

  it.each([
    ["status=ARCHIVED"],
    ["limit=0"],
    [`limit=${101}`],
    ["limit=abc"],
    ["cursor="],
    [`userId=${"u".repeat(65)}`],
  ])("rejects %s with a 400 and field details", async (query) => {
    const result = parseListQuery(new URLSearchParams(query));
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.response.status).toBe(400);
    const body = await result.response.json();
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.error).toBe("Invalid query parameters");
    expect(Object.keys(body.details.fieldErrors).length).toBeGreaterThan(0);
  });
});

describe("parseCreateBody", () => {
  it("accepts the three documented fields", () => {
    const result = parseCreateBody({
      amount: 500,
      utrNumber: "123456789012",
      screenshotUrl: "https://storage.example.test/a.png",
    });
    expect(result.ok).toBe(true);
  });

  it.each([
    ["a missing amount", { utrNumber: "123456789012", screenshotUrl: "https://x.test/a.png" }],
    ["a string amount", { amount: "500", utrNumber: "123456789012", screenshotUrl: "https://x.test/a.png" }],
    ["a missing screenshot", { amount: 500, utrNumber: "123456789012" }],
    [
      "a client-supplied tokensToCredit",
      {
        amount: 500,
        utrNumber: "123456789012",
        screenshotUrl: "https://x.test/a.png",
        tokensToCredit: 90_000,
      },
    ],
    ["an unknown field", { amount: 500, utrNumber: "1", screenshotUrl: "https://x.test/a.png", admin: true }],
  ])("rejects %s", async (_label, body) => {
    const result = parseCreateBody(body);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      const payload = await result.response.json();
      expect(payload.code).toBe("VALIDATION_ERROR");
      expect(payload.error).toBe("Invalid request body");
    }
  });
});

describe("review body schemas", () => {
  it("lets approve carry no fields at all", () => {
    expect(parseApproveBody({})).toEqual({ ok: true, reviewNote: null });
    expect(parseApproveBody({ reviewNote: "checked the statement" })).toEqual({
      ok: true,
      reviewNote: "checked the statement",
    });
  });

  it("rejects an unexpected field on approve", () => {
    expect(parseApproveBody({ amount: 1 }).ok).toBe(false);
  });

  it("requires a note on reject", () => {
    expect(parseRejectBody({}).ok).toBe(false);
    expect(parseRejectBody({ reviewNote: "no" }).ok).toBe(false);
    expect(parseRejectBody({ reviewNote: "utr not found" })).toEqual({
      ok: true,
      reviewNote: "utr not found",
    });
  });
});

/* ==========================================================================
   FIELD RULES (called directly, the way a future CLI or job would)
   ========================================================================== */

describe("field rules", () => {
  it("bounds a claim between the floor and the cap", () => {
    expect(assertAmount(MIN_PAYMENT_AMOUNT)).toBe(MIN_PAYMENT_AMOUNT);
    expect(assertAmount(MAX_PAYMENT_AMOUNT)).toBe(MAX_PAYMENT_AMOUNT);
    expect(() => assertAmount(MAX_PAYMENT_AMOUNT + 1)).toThrow(PaymentError);
  });

  it("collapses whitespace inside a UTR but keeps hyphens", () => {
    expect(normalizeUtr(" 12 34-56 78 ")).toBe("1234-5678");
    expect(() => normalizeUtr("1234_5678")).toThrow(/letters, digits and hyphens/);
  });

  it("keeps a usable storage URL, including a port and a query string", () => {
    expect(
      normalizeScreenshotUrl(" https://bucket.storage.googleapis.com/p/a.png?X-Goog-Signature=1 "),
    ).toBe("https://bucket.storage.googleapis.com/p/a.png?X-Goog-Signature=1");
    expect(normalizeScreenshotUrl("http://[2606:4700::6810:8404]/a.png")).toBe(
      "http://[2606:4700::6810:8404]/a.png",
    );
  });

  it("rejects a URL that only looks absolute", () => {
    expect(() => normalizeScreenshotUrl("//storage.example.test/a.png")).toThrow(
      /absolute URL/,
    );
    expect(() => normalizeScreenshotUrl("https://192.168.0.17/a.png")).toThrow(/internal address/);
  });

  it("trims an optional approve note and clears a blank one", () => {
    expect(normalizeReviewNote("  ok  ", { required: false })).toBe("ok");
    expect(normalizeReviewNote("   ", { required: false })).toBeNull();
    expect(normalizeReviewNote(undefined, { required: false })).toBeNull();
    expect(() => normalizeReviewNote(undefined, { required: true })).toThrow(/is required/);
    expect(() => normalizeReviewNote("no", { required: true })).toThrow(/at least 3 characters/);
  });
});
