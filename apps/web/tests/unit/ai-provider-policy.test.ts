import { describe, expect, it } from "vitest";

import {
  AI_REQUEST_LIMITS,
  describeProviderPolicyLimitation,
  validateAiRequestInput,
  validateProviderUrl,
} from "@/lib/ai/provider-policy";

describe("provider 地址策略：默认拒绝", () => {
  it("接受正常的公网 https 地址", () => {
    for (const url of [
      "https://api.openai.com/v1",
      "https://api.deepseek.com",
      "https://openrouter.ai/api/v1",
    ]) {
      expect(validateProviderUrl(url).ok, url).toBe(true);
    }
  });

  it("拒绝非 https（API key 不应走明文）", () => {
    const result = validateProviderUrl("http://api.openai.com/v1");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("insecure_protocol");
  });

  it("拒绝本机地址（含各种写法）", () => {
    for (const url of [
      "https://localhost/v1",
      "https://127.0.0.1/v1",
      "https://127.1.2.3/v1",
      "https://[::1]/v1",
      "https://foo.localhost/v1",
    ]) {
      const result = validateProviderUrl(url);
      expect(result.ok, `${url} 应被拒绝`).toBe(false);
    }
  });

  it("拒绝内网地址（10/172.16/192.168 段）", () => {
    for (const url of [
      "https://10.0.0.1/v1",
      "https://172.16.0.1/v1",
      "https://172.31.255.254/v1",
      "https://192.168.1.1/v1",
    ]) {
      const result = validateProviderUrl(url);
      expect(result.ok, `${url} 应被拒绝`).toBe(false);
    }
  });

  it("172.32 与 172.15 属于公网，不得被误拒", () => {
    expect(validateProviderUrl("https://172.32.0.1/v1").ok).toBe(true);
    expect(validateProviderUrl("https://172.15.0.1/v1").ok).toBe(true);
  });

  it("拒绝云厂商 metadata 地址（拿到它等于拿到实例凭据）", () => {
    for (const url of [
      "https://169.254.169.254/latest/meta-data/",
      "https://metadata.google.internal/computeMetadata/v1/",
    ]) {
      const result = validateProviderUrl(url);
      expect(result.ok, `${url} 应被拒绝`).toBe(false);
    }
  });

  it("拒绝 userinfo（可用于混淆真实目标）", () => {
    const result = validateProviderUrl("https://user:pass@api.openai.com/v1");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("userinfo_not_allowed");
  });

  it("拒绝 IPv6 私网与唯一本地地址", () => {
    for (const url of [
      "https://[fc00::1]/v1",
      "https://[fd12:3456::1]/v1",
      "https://[fe80::1]/v1",
      "https://[ff02::1]/v1",
    ]) {
      expect(validateProviderUrl(url).ok, `${url} 应被拒绝`).toBe(false);
    }
  });

  it("拒绝 IPv4-mapped / IPv4-compatible IPv6 形式的私网地址（绕过用例）", () => {
    /*
     * 这里记录一个**实测出现过的真实绕过**：
     * `new URL()` 会把 `::ffff:10.0.0.1` 规范化成十六进制 `::ffff:a00:1`，
     * 任何按点分十进制写的匹配都会漏掉它 —— 内网地址因此能直接通过校验。
     * 修复方式是自己把 IPv6 解析成 8 组整数再判定，而不是做字符串前缀匹配。
     */
    for (const url of [
      "https://[::ffff:10.0.0.1]/v1",
      "https://[::ffff:192.168.1.1]/v1",
      "https://[::ffff:127.0.0.1]/v1",
      "https://[::ffff:169.254.169.254]/v1",
      "https://[::10.0.0.1]/v1",
      // 十六进制写法（URL 规范化后的形式）
      "https://[::ffff:a00:1]/v1",
      "https://[::ffff:c0a8:101]/v1",
      "https://[::ffff:7f00:1]/v1",
    ]) {
      expect(validateProviderUrl(url).ok, `${url} 应被拒绝`).toBe(false);
    }
  });

  it("【复核发现】末尾点写法不得绕过（URL 不去末尾点，必须自己去掉）", () => {
    /*
     * `new URL()` **不**去掉末尾点：`https://localhost./` 的 hostname 仍是
     * `localhost.`。而绝大多数解析器把带末尾点的名字与不带点视为等价
     * （实测 `dns.lookup("localhost.")` 返回 `::1`）。
     * 若校验层不自己去点，名单匹配与后缀匹配会全部落空 —— 实测曾放行。
     */
    for (const url of [
      "https://localhost./",
      "https://metadata.google.internal./",
      "https://metadata.goog./",
      "https://foo.local./",
      "https://localhost.localdomain/",
    ]) {
      expect(validateProviderUrl(url).ok, `${url} 应被拒绝`).toBe(false);
    }
  });

  it("【复核发现】云厂商 metadata 名单覆盖腾讯云/阿里云", () => {
    for (const url of ["https://metadata.tencentyun.com/", "https://metadata.aliyun.com/"]) {
      expect(validateProviderUrl(url).ok, `${url} 应被拒绝`).toBe(false);
    }
  });

  it("【复核发现】各种内嵌 IPv4 的 IPv6 写法都要拦住", () => {
    /*
     * 实测曾放行的两条：`[::ffff:0:127.0.0.1]`（规范化为 [::ffff:0:7f00:1]）
     * 与 NAT64 `[64:ff9b::127.0.0.1]`。判定必须覆盖全部内嵌前缀写法，
     * 而不能只认最常见的 ::ffff:a.b.c.d。
     */
    for (const url of [
      "https://[::ffff:0:127.0.0.1]/",
      "https://[::ffff:0:10.0.0.1]/",
      "https://[64:ff9b::127.0.0.1]/",
      "https://[64:ff9b::10.0.0.1]/",
      "https://[::127.0.0.1]/",
    ]) {
      expect(validateProviderUrl(url).ok, `${url} 应被拒绝`).toBe(false);
    }
  });

  it("【复核发现】100.64/10、组播与保留段被拒绝", () => {
    for (const url of [
      "https://100.64.0.1/v1",
      "https://100.127.255.254/v1",
      "https://224.0.0.1/v1",
      "https://240.0.0.1/v1",
    ]) {
      expect(validateProviderUrl(url).ok, `${url} 应被拒绝`).toBe(false);
    }
    // 100.63/8 与 100.128/8 不属于 100.64/10，不应误拒。
    expect(validateProviderUrl("https://100.63.0.1/v1").ok).toBe(true);
    expect(validateProviderUrl("https://100.128.0.1/v1").ok).toBe(true);
  });

  it("IPv4-mapped 形式的**公网**地址不被误拒", () => {
    // ::ffff:8.8.8.8 是公网地址，不应因为「包含私网前缀逻辑」被拒绝。
    expect(validateProviderUrl("https://[::ffff:8.8.8.8]/v1").ok).toBe(true);
  });

  it("IPv6 公网地址不被误拒", () => {
    expect(validateProviderUrl("https://[2606:4700:4700::1111]/v1").ok).toBe(true);
  });

  it("拒绝单标签主机名（无法判断归属，通常是内网）", () => {
    const result = validateProviderUrl("https://intranet/v1");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("single_label_host");
  });

  it("空值与畸形输入被明确拒绝，而不是抛异常", () => {
    expect(validateProviderUrl("").ok).toBe(false);
    expect(validateProviderUrl("   ").ok).toBe(false);
    expect(validateProviderUrl("not a url").ok).toBe(false);
    expect(validateProviderUrl("file:///etc/passwd").ok).toBe(false);
  });

  it("如实报告无法覆盖的剩余风险（不宣称已完全安全）", () => {
    const limitation = describeProviderPolicyLimitation();
    expect(limitation).toContain("DNS rebinding");
    // 必须说明需要更强保证时的替代做法，而不是只说「有风险」。
    expect(limitation).toContain("白名单");
  });
});

describe("请求规模预算", () => {
  it("正常输入通过", () => {
    expect(validateAiRequestInput({ message: "帮我改一下这段", historyLength: 3 }).ok).toBe(true);
  });

  it("超长消息被拒绝（不静默截断）", () => {
    const result = validateAiRequestInput({
      message: "x".repeat(AI_REQUEST_LIMITS.maxMessageChars + 1),
      historyLength: 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("message_too_long");
  });

  it("过长的历史被拒绝", () => {
    const result = validateAiRequestInput({
      message: "hi",
      historyLength: AI_REQUEST_LIMITS.maxHistoryMessages + 1,
    });
    expect(result.ok).toBe(false);
  });
});
