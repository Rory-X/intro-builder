import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { canonicalize, hashValue, sha256Hex } from "@intro-builder/shared/utils";

/**
 * 手写 SHA-256 的正确性（P01 引入）。
 *
 * 为什么这个测试必须对照 `node:crypto` 而不是自比自：它是**安全相关**实现 ——
 * 条件哈希用于判断「提案基于的内容是否还是当前内容」。若服务端算出的哈希与
 * 客户端不一致，所有提案都会误判为冲突（或更糟：误判为未冲突）。
 * 自比自只能证明「稳定」，不能证明「正确」。
 */

function nodeSha(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

describe("sha256Hex 与 node:crypto 逐字节一致", () => {
  it("常见输入", () => {
    for (const input of [
      "",
      "a",
      "abc",
      "hello world",
      "中文简历内容：负责订单查询接口开发",
      "🚀🎯 表情与中文混排",
      "𝄞 音乐符号",
      "e\u0301 组合字符",
      "line\nbreak\ttab",
      "Привет мир",
      "مرحبا بالعالم",
    ]) {
      expect(sha256Hex(input), JSON.stringify(input.slice(0, 20))).toBe(nodeSha(input));
    }
  });

  it("长度边界（SHA-256 分块 padding 最易写错处）", () => {
    // 55/56/57 是单块填充的临界；63/64/65 是跨块临界。
    for (let n = 0; n <= 200; n += 1) {
      for (const ch of ["a", "中", "🚀"]) {
        const input = ch.repeat(n);
        expect(sha256Hex(input), `len=${n} ch=${ch}`).toBe(nodeSha(input));
      }
    }
  });

  it("孤立代理替换为 U+FFFD（与 TextEncoder/Buffer/node:crypto 一致）", () => {
    /*
     * 真实缺陷：此前孤立代理按 CESU-8 风格编成三字节，与 Node 不一致。
     * 经 `hashValue` 不可达（JSON.stringify 会转义），但 `sha256Hex` 是导出 API，
     * 且文件头承诺「Node 与浏览器结果一致」—— 必须对齐标准行为。
     */
    for (const input of [
      "a\uD800b", // 孤立高位代理在中间
      "\uD800", // 末尾孤立高位代理
      "\uDC00", // 孤立低位代理
      "x\uDFFFy",
      "\uD800\uDC00", // 合法代理对（不应被替换）
    ]) {
      expect(sha256Hex(input), JSON.stringify(input)).toBe(nodeSha(input));
    }
    // 合法代理对与 U+1F600 等价。
    expect(sha256Hex("\uD83D\uDE00")).toBe(sha256Hex("😀"));
  });

  it("大数据（跨多分块）", () => {
    expect(sha256Hex("x".repeat(1_000_000))).toBe(nodeSha("x".repeat(1_000_000)));
  });
});

describe("canonicalize 的规范化规则", () => {
  it("对象键顺序不影响结果", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
    expect(hashValue({ b: 1, a: 2 })).toBe(hashValue({ a: 2, b: 1 }));
  });

  it("数组顺序**影响**结果（顺序是语义的一部分）", () => {
    expect(hashValue([1, 2])).not.toBe(hashValue([2, 1]));
  });

  it("不偷偷 trim 文本（尾随空格是真实差异）", () => {
    expect(hashValue(" a ")).not.toBe(hashValue("a"));
  });

  it("嵌套结构同样规范化", () => {
    expect(hashValue({ x: { b: 1, a: 2 } })).toBe(hashValue({ x: { a: 2, b: 1 } }));
  });

  it("undefined 值的键被丢弃（与 JSON 语义一致）", () => {
    expect(hashValue({ a: 1, b: undefined })).toBe(hashValue({ a: 1 }));
  });

  it("TipTap 文本内容变化会改变哈希", () => {
    const doc = (t: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });
    expect(hashValue(doc("甲"))).not.toBe(hashValue(doc("乙")));
  });
});
