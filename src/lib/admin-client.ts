/* ==========================================================================
   ADMIN PANEL — THE ONE FETCH HELPER
   ==========================================================================

   Every write in the panel goes through the existing API routes. Not around
   them: the endpoints own the transactions, the locks, the state machines, the
   rate limiting and the `MONEY_MODE` gate, and a UI that skipped them would be a
   second, weaker implementation of the same rules.

   What the helper adds is the boring half: parse-or-die-free responses, and a
   message that is worth putting in a toast whatever the server said.
   ========================================================================== */

export type AdminCallResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; code: string | null };

const FALLBACK: Record<number, string> = {
  0: "Could not reach the server. Check your connection and try again.",
  400: "The server refused those values. Fix what it names and resend.",
  401: "Your admin session has ended. Sign in again.",
  403: "Your admin roles do not allow this action.",
  404: "That record is not there any more. Reload the list.",
  405: "That action is not allowed on this address.",
  409: "Somebody changed this record first. Reload and try again.",
  415: "The panel sent the body in a form the server does not accept.",
  422: "The server refused to apply that change.",
  429: "Too many attempts. Wait for the counter to cool down.",
  500: "The server failed. Nothing was changed. Try again once.",
  503: "This feature is switched off in this environment.",
};

/**
 * POST (or PATCH) JSON to an admin endpoint and describe the outcome in one
 * object. It never throws, so a caller can always show a toast and clear its
 * spinner.
 */
export async function adminCall<T = unknown>(
  path: string,
  options: { method?: "POST" | "PATCH" | "PUT" | "DELETE"; body?: unknown } = {},
): Promise<AdminCallResult<T>> {
  const method = options.method ?? "POST";

  try {
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    const text = await response.text();
    let payload: { error?: string; code?: string } | null = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    if (response.ok) {
      const data = (payload ?? null) as { ok?: boolean; data?: T } | null;
      // Every admin route answers with the `{ ok, data }` envelope, so unwrap it
      // here rather than in six components.
      if (data && "data" in data) return { ok: true, data: data.data as T };
      return { ok: true, data: (data ?? {}) as unknown as T };
    }

    return {
      ok: false,
      status: response.status,
      error: payload?.error?.trim() || FALLBACK[response.status] || `The request failed (${response.status}).`,
      code: payload?.code ?? null,
    };
  } catch (error) {
    console.error(`[admin-panel] ${method} ${path} failed:`, error);
    return { ok: false, status: 0, error: FALLBACK[0], code: "NETWORK" };
  }
}
