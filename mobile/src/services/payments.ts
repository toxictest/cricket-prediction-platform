import { apiGet, apiPost } from "../lib/api";
import { MONEY_RULES } from "../utils/validation";
import type {
  MyPaymentPage,
  PaymentQr,
  PaymentReceipt,
  PaymentStatus,
} from "../types/api";

/*
 * Deposits. Read the active QR, pay it in any UPI app, then file a claim with the
 * UTR and a link to the screenshot. Crediting is a human's job on the admin side,
 * so `PENDING` is the normal state to wake up to — the app must not imply that
 * submitting this form moved anything.
 *
 * Server rules the UI mirrors, in the same order the server applies them:
 *   - `amount` is a whole number of rupees from 1 to 100000 (MIN/MAX_PAYMENT_AMOUNT)
 *   - `utrNumber` is 8..64 characters and unique platform-wide → 409 DUPLICATE_UTR
 *   - `screenshotUrl` must be https on an allowlisted host; `data:` is refused
 *   - more than 5 open claims → 429 TOO_MANY_PENDING
 *   - `tokensToCredit` is computed server-side and is rejected if sent
 *   - 503 PAYMENTS_DISABLED while the deployment keeps the money gate closed
 */

export function getPaymentQr(): Promise<PaymentQr> {
  return apiGet<PaymentQr>("/api/payment/qr");
}

export function createPaymentRequest(input: {
  amount: number;
  utrNumber: string;
  screenshotUrl: string;
}): Promise<PaymentReceipt> {
  return apiPost<PaymentReceipt>("/api/payment/request", input);
}

export function listMyPayments(filter: { status?: PaymentStatus; limit?: number; cursor?: string | null } = {}): Promise<MyPaymentPage> {
  const params: Record<string, string | number> = { limit: filter.limit ?? 25 };
  if (filter.status) params.status = filter.status;
  if (filter.cursor) params.cursor = filter.cursor;
  return apiGet<MyPaymentPage>("/api/payment/my", { params });
}

/**
 * Derived from `MONEY_RULES`, where every number names the backend file that owns it.
 *
 * The UTR maximum used to be written here as 64, because that is the length the route's
 * own field permits — but `src/lib/bank-reference.ts` caps any bank reference at 32 and
 * it is the service that answers, so a 40-character UTR was accepted by this app and
 * refused by the server. That is the whole argument for one source of truth.
 */
export const PAYMENT_LIMITS = {
  minAmount: MONEY_RULES.depositMinAmount,
  maxAmount: MONEY_RULES.depositMaxAmount,
  minUtrLength: MONEY_RULES.referenceMinLength,
  maxUtrLength: MONEY_RULES.referenceMaxLength,
  maxOpenClaims: MONEY_RULES.maxOpenClaims,
} as const;
