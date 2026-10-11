import { http } from "../lib/api";
import { API_URL } from "../lib/config";

/* ==========================================================================
   SCREENSHOT UPLOAD — an extension point, not a claim
   ==========================================================================

   `POST /api/payment/request` takes `screenshotUrl`: one https URL on a host the
   backend allows, and `data:` URLs are refused outright. There is no upload
   endpoint in this backend — deliberately, because storing member-uploaded bytes
   means a bucket, a malware pass and a retention policy, none of which belong in a
   payment-claims MVP.

   So the picker does two jobs: it shows the member what they are about to claim
   with, and, *if* an operator stands up an upload service, it hands that service
   the file and uses the URL it returns. Set EXPO_PUBLIC_UPLOAD_URL to turn the
   second job on. Until then the app says so in the UI instead of pretending.

   The response contract is `{ url }` or `{ ok: true, data: { url } }`, and the URL
   must be https — a service that hands back a `file://` or a plain-HTTP link would
   fail at the backend anyway, and failing here says which one is wrong.
   ========================================================================== */

export type PickedAsset = {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
};

const configured = (process.env.EXPO_PUBLIC_UPLOAD_URL ?? "").trim();

/** Null means "no upload service configured", which is the default and is fine. */
export const uploadEndpoint: string | null =
  configured.length === 0 ? null : configured.startsWith("http") ? configured : `${API_URL}${configured}`;

export function uploadAvailable(): boolean {
  return uploadEndpoint !== null;
}

export async function uploadScreenshot(asset: PickedAsset): Promise<string> {
  if (!uploadEndpoint) {
    throw new Error("No upload service is configured for this build.");
  }

  const form = new FormData();
  // React Native's FormData accepts this shape; the cast is the standard
  // workaround for a type that only knows about Blob.
  form.append("file", {
    uri: asset.uri,
    name: asset.fileName ?? `screenshot-${Date.now()}.jpg`,
    type: asset.mimeType ?? "image/jpeg",
  } as unknown as Blob);

  const response = await http.post<{ url?: string; data?: { url?: string } }>(uploadEndpoint, form, {
    headers: { "content-type": "multipart/form-data" },
    // RN needs this for multipart; axios would otherwise JSON-encode the form.
    transformRequest: [(data: unknown) => data],
    timeout: 60000,
  });

  const url = response.data?.url ?? response.data?.data?.url;
  if (typeof url !== "string" || url.length === 0) {
    throw new Error("The upload service did not return a URL.");
  }
  if (!/^https:\/\//i.test(url)) {
    throw new Error("The upload service returned something other than an https URL.");
  }
  return url;
}
