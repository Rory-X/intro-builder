/**
 * Provider 策略（P04 任务 7）。
 *
 * 用户可以自带模型服务地址（BYOK），因此这个 URL 是**用户可控的**。
 * 不加限制地把它交给服务端发起请求，等于给了一个 SSRF 原语：
 * 用它能探测内网、读云厂商 metadata 端点、访问本机管理端口。
 *
 * 因此这里的校验不是「尽力而为」，而是**默认拒绝**：
 * 只允许 https + 公网主机，明确拒绝 localhost / 私网 / 链路本地 / metadata / userinfo。
 *
 * 关于「字符串层校验不够」的诚实说明（契约 §P04 任务 7 要求写清限制）：
 * 仅靠字符串无法防御 DNS rebinding（域名先解析到公网、再改指向内网）。
 * 彻底的方案是在**实际出站传输**时校验/固定解析结果。当前运行平台（Vercel 函数）
 * 无法在该层插入自定义 socket 校验，因此本模块：
 * 1. 做完整的字符串层拒绝（挡住绝大多数误配与直接攻击）；
 * 2. 导出 `describeProviderPolicyLimitation()`，让调用方/文档如实报告剩余风险，
 *    而不是宣称「已经安全」。
 * 这是明确的已知上限，不是被忽略的问题。
 */

export type ProviderPolicyResult =
  | { ok: true; url: URL }
  | { ok: false; code: string; message: string };

/** 云厂商 metadata 端点：拿到它们等于拿到实例凭据。 */
const METADATA_HOSTS = new Set([
  "169.254.169.254",
  "metadata.google.internal",
  "metadata.goog",
  "100.100.100.200",
  // 阿里云
  "100.100.100.200",
  "metadata.aliyun.com",
  // 腾讯云
  "metadata.tencentyun.com",
  "metadata.tencent.internal",
]);

/** 内网环境常见的本地后缀（`.local` 是 mDNS，`.localdomain` 是常见默认域名）。 */
const LOCAL_SUFFIXES = [".localhost", ".local", ".localdomain", ".internal", ".home.arpa"];

function isPrivateIpv4(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const [a, b] = [Number(match[1]), Number(match[2])];
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;
  // 100.64.0.0/10：运营商级 NAT，云内网常用。
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 组播与保留段：不可能是合法的模型服务地址。
  if (a >= 224) return true;
  return false;
}

/**
 * 把 IPv6 文本还原成 8 组 16 位整数。
 *
 * 必须自己解析而不是靠字符串前缀：`new URL()` 会把 IPv4-mapped 地址规范化成
 * **十六进制**形式（`::ffff:10.0.0.1` → `::ffff:a00:1`），任何按点分十进制写的
 * 匹配都会漏掉 —— 实测这条漏检让内网地址直接绕过私网检查。
 */
function parseIpv6(input: string): number[] | null {
  const normalized = input.replace(/^\[|\]$/g, "").toLowerCase();
  if (!normalized.includes(":")) return null;

  // 处理 "::" 简写：左右两半分别解析，中间补 0。
  const [headPart, tailPart] = normalized.split("::");
  const head = headPart ? headPart.split(":").filter(Boolean) : [];
  const tail = tailPart !== undefined ? tailPart.split(":").filter(Boolean) : [];

  const groups: number[] = [];
  const parseGroup = (value: string): number | null => {
    if (!/^[0-9a-f]{1,4}$/.test(value)) return null;
    return Number.parseInt(value, 16);
  };
  // 尾部可能以 IPv4 点分形式结尾（未规范化时）。
  const tailValues: number[] = [];
  for (const group of tail) {
    if (group.includes(".")) {
      const octets = group.split(".").map(Number);
      if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
      tailValues.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
    } else {
      const parsed = parseGroup(group);
      if (parsed === null) return null;
      tailValues.push(parsed);
    }
  }

  const headValues: number[] = [];
  for (const group of head) {
    const parsed = parseGroup(group);
    if (parsed === null) return null;
    headValues.push(parsed);
  }

  if (tailPart === undefined) {
    // 没有 "::"，必须是完整 8 组。
    if (headValues.length !== 8) return null;
    return headValues;
  }

  const fill = 8 - headValues.length - tailValues.length;
  if (fill < 0) return null;
  groups.push(...headValues, ...new Array(fill).fill(0), ...tailValues);
  return groups.length === 8 ? groups : null;
}

/** IPv6 私网/本地/链路本地判定（含 IPv4-mapped 与 IPv4-compatible）。 */
function isPrivateIpv6(host: string): boolean {
  const groups = parseIpv6(host);
  if (!groups) return false;

  // ::1（loopback）与 ::（unspecified）
  const isAllZeroPrefix = groups.slice(0, 7).every((g) => g === 0);
  if (isAllZeroPrefix && (groups[7] === 0 || groups[7] === 1)) return true;

  const first = groups[0];

  // fe80::/10 链路本地
  if ((first & 0xffc0) === 0xfe80) return true;
  // fc00::/7 唯一本地地址
  if ((first & 0xfe00) === 0xfc00) return true;
  // ff00::/8 组播
  if ((first & 0xff00) === 0xff00) return true;

  /*
   * 「内嵌 IPv4」的写法必须还原后按 IPv4 规则判定。
   *
   * 判据是**前 96 位（6 组）落在已知内嵌前缀里**，最后 32 位就是被嵌入的 IPv4。
   * 实测各写法规范化后的形态（`new URL()` 会把点分十进制转成十六进制）：
   *
   *   [::ffff:127.0.0.1]     -> [::ffff:7f00:1]      前缀 0,0,0,0,0,ffff
   *   [::ffff:0:127.0.0.1]   -> [::ffff:0:7f00:1]    前缀 0,0,0,0,ffff,0
   *   [::127.0.0.1]          -> [::7f00:1]           前缀 0,0,0,0,0,0
   *   [64:ff9b::127.0.0.1]   -> [64:ff9b::7f00:1]    前缀 64,ff9b,0,0,0,0
   *
   * 只识别前两种会漏掉后两种（实测 [::ffff:0:127.0.0.1] 与 NAT64 曾放行到 127.0.0.1）。
   */
  const EMBEDDED_IPV4_PREFIXES: ReadonlyArray<readonly number[]> = [
    [0, 0, 0, 0, 0, 0], // ::/96            IPv4-compatible
    [0, 0, 0, 0, 0, 0xffff], // ::ffff:a.b.c.d   IPv4-mapped
    [0, 0, 0, 0, 0xffff, 0], // ::ffff:0:a.b.c.d
    [0x64, 0xff9b, 0, 0, 0, 0], // 64:ff9b::/96     NAT64 well-known
  ];

  const prefixMatches = EMBEDDED_IPV4_PREFIXES.some((prefix) =>
    prefix.every((value, index) => groups[index] === value),
  );
  if (prefixMatches) {
    const last32 = (groups[6] << 16) | groups[7];
    const embedded = `${last32 >>> 24}.${(last32 >>> 16) & 0xff}.${(last32 >>> 8) & 0xff}.${last32 & 0xff}`;
    return isPrivateIpv4(embedded);
  }

  return false;
}

/**
 * 校验用户提供的模型服务地址。
 *
 * 顺序刻意先拒「明显越界」再判常规问题，保证 `/etc/passwd` 这类畸形输入也拿到
 * 明确拒绝而不是抛异常。
 */
export function validateProviderUrl(raw: string): ProviderPolicyResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, code: "empty", message: "请填写模型服务地址" };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, code: "malformed", message: "模型服务地址格式不正确" };
  }

  // 只允许 https：明文 http 会把 API key 暴露在链路上。
  if (url.protocol !== "https:") {
    return { ok: false, code: "insecure_protocol", message: "模型服务地址必须使用 https" };
  }

  // userinfo（https://user:pass@host）可用于混淆真实目标，直接拒绝。
  if (url.username || url.password) {
    return { ok: false, code: "userinfo_not_allowed", message: "模型服务地址不能包含用户名或密码" };
  }

  /*
   * **必须自己去掉末尾点**。
   *
   * `new URL()` 不去除末尾点（`https://localhost./` 的 hostname 仍是 `localhost.`），
   * 而绝大多数解析器把带末尾点的名字与不带点视为等价（实测 `dns.lookup("localhost.")`
   * 返回 `::1`）。若不去点，名单匹配与后缀匹配会全部落空 —— 这是一条实测可复现的绕过。
   */
  const host = url.hostname.toLowerCase().replace(/\.$/, "");

  if (METADATA_HOSTS.has(host)) {
    return { ok: false, code: "metadata_endpoint", message: "不允许使用云厂商元数据地址" };
  }

  if (
    host === "localhost" ||
    host === "localhost.localdomain" ||
    LOCAL_SUFFIXES.some((suffix) => host.endsWith(suffix))
  ) {
    return { ok: false, code: "local_host", message: "不允许使用本机或本地网络地址" };
  }

  if (isPrivateIpv4(host) || isPrivateIpv6(host)) {
    return { ok: false, code: "private_network", message: "不允许使用内网地址" };
  }

  // 单标签主机名（如 `intranet`）无法判断归属，且通常解析到内网。
  if (!host.includes(".") && !host.startsWith("[")) {
    return { ok: false, code: "single_label_host", message: "模型服务地址必须是完整的公网域名" };
  }

  return { ok: true, url };
}

/**
 * 如实报告本模块**无法**覆盖的风险。
 *
 * 存在的意义是避免把「字符串层校验通过」误表述成「已经安全」：
 * 调用方应在文档/日志中引用这段说明，而不是宣称 SSRF 已完全消除。
 */
export function describeProviderPolicyLimitation(): string {
  return (
    "provider 地址已通过字符串层校验（https、公网、非 metadata）。" +
    "剩余风险：DNS rebinding 无法在字符串层防御 —— 域名可先解析到公网、再改指向内网。" +
    "彻底修复需要在实际出站传输时校验或固定解析结果；当前平台不具备该能力，" +
    "因此如需更强保证，应改为服务端配置允许的 provider host 白名单。"
  );
}

/** 请求体大小与并发预算。所有模型入口共用，避免每个路由各自发明阈值。 */
export const AI_REQUEST_LIMITS = {
  /** 单条用户消息最大字符数。 */
  maxMessageChars: 20_000,
  /** 一次请求携带的历史消息上限。 */
  maxHistoryMessages: 100,
  /** 模型调用总预算。 */
  maxSteps: 6,
  /** 单次模型请求超时（毫秒）。 */
  modelTimeoutMs: 30_000,
  /** 整个路由的内部 deadline（毫秒），需小于平台 maxDuration。 */
  routeDeadlineMs: 45_000,
  /** 路由 maxDuration（秒），发布前需按平台套餐复核。 */
  routeMaxDurationSeconds: 60,
} as const;

export type AiRequestValidation =
  | { ok: true }
  | { ok: false; code: string; message: string };

/** 校验用户输入规模。超限一律拒绝，不静默截断（截断会让模型看到不完整上下文）。 */
export function validateAiRequestInput(input: {
  message: string;
  historyLength: number;
}): AiRequestValidation {
  if (input.message.length > AI_REQUEST_LIMITS.maxMessageChars) {
    return {
      ok: false,
      code: "message_too_long",
      message: `单条消息不能超过 ${AI_REQUEST_LIMITS.maxMessageChars} 个字符`,
    };
  }
  if (input.historyLength > AI_REQUEST_LIMITS.maxHistoryMessages) {
    return {
      ok: false,
      code: "history_too_long",
      message: `对话历史过长（上限 ${AI_REQUEST_LIMITS.maxHistoryMessages} 条）`,
    };
  }
  return { ok: true };
}
