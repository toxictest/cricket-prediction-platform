import * as Crypto from "expo-crypto";

/**
 * PKCE for the browser handoff.
 *
 * The app generates a verifier, keeps it, and shows the browser only its SHA-256.
 * That is what makes a sign-in code stolen off the deep link useless: the thief
 * has a code, and the exchange needs the verifier that never left this device.
 *
 * `expo-crypto` is used instead of Node's `crypto` because that is what is
 * available in Hermes, and base64url by hand because `expo-crypto` returns hex and
 * RFC 7636 wants the URL-safe alphabet without padding.
 */

function base64UrlFromHex(hex: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type PkcePair = { verifier: string; challenge: string };

export async function createPkcePair(): Promise<PkcePair> {
  const verifierBytes = await Crypto.getRandomBytesAsync(48);
  const verifier = base64UrlFromHex(Array.from(verifierBytes).map((b) => b.toString(16).padStart(2, "0")).join(""));
  const digestHex = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier);
  return { verifier, challenge: base64UrlFromHex(digestHex) };
}
