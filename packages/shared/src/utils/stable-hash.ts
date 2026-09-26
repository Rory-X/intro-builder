/**
 * Deterministic canonical JSON + SHA-256 that runs identically in Node and the browser.
 *
 * Why not `node:crypto` / WebCrypto:
 * the same hash has to be computed on both sides of the wire — the client records an
 * *expected* condition hash, the server recomputes it from actual stored content.
 * Any environment difference (padding, encoding, availability) would silently turn
 * every condition into a mismatch, so this module ships one pure implementation that
 * both sides call. See docs/superpowers/specs/2026-09-26-nextjs-agent-contracts.md §2.
 */

/**
 * Canonical JSON: object keys sorted, array order preserved, strings never trimmed.
 *
 * Trimming is deliberately avoided — a trailing space is a real content difference and
 * must produce a different hash, otherwise a stale proposal could match edited text.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalValue);
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    if (source[key] === undefined) continue;
    out[key] = canonicalValue(source[key]);
  }
  return out;
}

const HEX = "0123456789abcdef";
const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/**
 * UTF-8 编码。
 *
 * **孤立代理必须替换成 U+FFFD**（`efbfbd`），这是 WHATWG / Unicode 的规定做法，
 * 也是 `TextEncoder`、`Buffer.from(str, "utf8")`、`node:crypto` 的行为。
 * 若不替换（而是把代理本身按三字节编码，即 CESU-8 风格），
 * 遇到 `"a\uD800b"` 这类输入会算出与 `node:crypto` **不同**的哈希 ——
 * 实测确认过这个不一致。
 *
 * 经 `hashValue` 的路径不可达（`JSON.stringify` 会把孤立代理转义成 `\ud800`
 * 字面量），但 `sha256Hex` 是导出 API，而且文件头承诺「Node 与浏览器结果一致」，
 * 因此必须与标准行为对齐。
 */
function utf8Bytes(input: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) {
    let code = input.charCodeAt(i);

    if (code < 0x80) {
      bytes.push(code);
      continue;
    }
    if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      continue;
    }

    /*
     * 代理对与孤立代理。
     *
     * 合法的代理对编码为 4 字节；**孤立代理一律替换成 U+FFFD**（`efbfbd`），
     * 与 `TextEncoder` / `Buffer.from(str, "utf8")` / `node:crypto` 一致。
     * 若把代理本身按三字节编码（CESU-8 风格），遇到 `"a\uD800b"` 或末尾孤立代理
     * 会算出与 Node 不同的哈希 —— 实测确认过。
     */
    const isHigh = code >= 0xd800 && code <= 0xdbff;
    const isLow = code >= 0xdc00 && code <= 0xdfff;
    if (isHigh && i + 1 < input.length) {
      const next = input.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        const scalar = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
        bytes.push(
          0xf0 | (scalar >> 18),
          0x80 | ((scalar >> 12) & 0x3f),
          0x80 | ((scalar >> 6) & 0x3f),
          0x80 | (scalar & 0x3f),
        );
        continue;
      }
    }
    if (isHigh || isLow) {
      // 孤立代理（含位于字符串末尾的高位代理）→ U+FFFD。
      code = 0xfffd;
    }

    bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return bytes;
}

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** Plain SHA-256 over a UTF-8 string, returned as lowercase hex. */
export function sha256Hex(input: string): string {
  const bytes = utf8Bytes(input);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);

  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  bytes.push((high >>> 24) & 0xff, (high >>> 16) & 0xff, (high >>> 8) & 0xff, high & 0xff);
  bytes.push((low >>> 24) & 0xff, (low >>> 16) & 0xff, (low >>> 8) & 0xff, low & 0xff);

  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const w = new Array<number>(64);

  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      w[i] = ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }

  let out = "";
  for (const word of h) {
    for (let shift = 28; shift >= 0; shift -= 4) out += HEX[(word >>> shift) & 0xf];
  }
  return out;
}

/** Canonical SHA-256 of any JSON value. */
export function hashValue(value: unknown): string {
  return sha256Hex(canonicalize(value));
}
