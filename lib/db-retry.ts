/**
 * Wrap a Neon HTTP db query in transient-network retry. ECONNRESET / TLS
 * handshake reset / "fetch failed" hits the China → ap-southeast-1 path
 * occasionally and is not a real failure — retrying with brief backoff
 * usually succeeds. Without this, every flaky moment 500s the page that
 * happened to be loading.
 *
 * Caller passes a thunk so the actual db call (whatever it is) re-executes
 * on each attempt. Non-transient errors are re-thrown immediately so we
 * don't mask real bugs.
 */
function isTransientNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const causeCode =
    err instanceof Error && (err as Error & { cause?: { code?: string; message?: string } }).cause
      ? `${(err as Error & { cause?: { code?: string; message?: string } }).cause?.code ?? ""} ${
          (err as Error & { cause?: { code?: string; message?: string } }).cause?.message ?? ""
        }`
      : "";
  return /fetch failed|ECONNRESET|socket disconnected|network socket|TLS|handshake/i.test(
    msg + " " + causeCode,
  );
}

export async function withDbRetry<T>(
  label: string,
  fn: () => Promise<T>,
  max = 5,
): Promise<T> {
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === max || !isTransientNetworkError(err)) throw err;
      const delay = 1000 * 2 ** (attempt - 1);
      console.warn(`[db] ${label} attempt ${attempt}/${max} transient — retry in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
}
