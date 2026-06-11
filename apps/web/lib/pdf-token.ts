import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Short-lived HMAC-signed tokens for PDF preview authentication.
 * Used when a remote browser service (e.g. Browserless) needs to access
 * the preview page without the user's session cookie.
 */

const SECRET = process.env.PDF_SIGNING_SECRET || "dev-pdf-secret";
const TTL_MS = 60_000; // 60 seconds

/**
 * Generate a signed token granting access to a specific resume's preview.
 * Token format: base64url(payload).base64url(hmac-sha256-signature)
 */
export function signPdfToken(resumeId: string, userId: string): string {
  const payload = JSON.stringify({ resumeId, userId, exp: Date.now() + TTL_MS });
  const b64 = Buffer.from(payload).toString("base64url");
  const sig = createHmac("sha256", SECRET).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}

/**
 * Verify a PDF token and extract the userId if valid.
 * Returns { valid: false } if signature mismatch, expired, or wrong resumeId.
 */
export function verifyPdfToken(
  token: string,
  resumeId: string,
): { valid: boolean; userId?: string } {
  try {
    const dotIdx = token.indexOf(".");
    if (dotIdx === -1) return { valid: false };

    const b64 = token.slice(0, dotIdx);
    const sig = token.slice(dotIdx + 1);
    if (!b64 || !sig) return { valid: false };

    const expectedSig = createHmac("sha256", SECRET).update(b64).digest("base64url");
    const sigBuf = Buffer.from(sig, "base64url");
    const expectedBuf = Buffer.from(expectedSig, "base64url");

    if (sigBuf.length !== expectedBuf.length) return { valid: false };
    if (!timingSafeEqual(sigBuf, expectedBuf)) return { valid: false };

    const payload = JSON.parse(Buffer.from(b64, "base64url").toString()) as {
      resumeId: string;
      userId: string;
      exp: number;
    };

    if (payload.resumeId !== resumeId) return { valid: false };
    if (Date.now() > payload.exp) return { valid: false };

    return { valid: true, userId: payload.userId };
  } catch {
    return { valid: false };
  }
}
