import { describe, expect, it } from "vitest";

import {
  buildRichTextPolishPrompt,
  createOpenAICompatibleRichTextPolishProvider,
  parsePolishProviderResponse,
  polishRichText,
  validateRichTextPolishRequest,
} from "../src/rich-text-polish";

describe("rich text polish prompt", () => {
  it("builds a conservative STAR-aware Chinese resume polish prompt", () => {
    const prompt = buildRichTextPolishPrompt({
      requestId: "req_prompt",
      resumeId: "resume_abc",
      section: "experience",
      fieldPath: "experience.0.content",
      locale: "zh-CN",
      content: {
        format: "tiptap_json",
        plainText: "负责业务系统前端开发，优化页面性能。",
        tiptapJson: { type: "doc", content: [] },
      },
      intent: {
        mode: "polish",
        tone: "professional",
        length: "same",
        strategy: "star",
      },
    });

    expect(prompt.system).toContain("中文简历润色助手");
    expect(prompt.system).toContain("不得新增事实");
    expect(prompt.system).toContain("不得把“参与”改成“主导”");
    expect(prompt.developer).toContain("合法 JSON");
    expect(prompt.developer).toContain("strategy=star");
    expect(prompt.developer).toContain("Situation");
    expect(prompt.developer).toContain("Result");
    expect(prompt.user).toContain("section: experience");
    expect(prompt.user).toContain("负责业务系统前端开发，优化页面性能。");
  });

  it("describes TipTap text blocks so providers keep list structure", () => {
    const prompt = buildRichTextPolishPrompt({
      requestId: "req_prompt_structure",
      resumeId: "resume_abc",
      section: "projects",
      fieldPath: "projects.0.content",
      locale: "zh-CN",
      content: {
        format: "tiptap_json",
        plainText: "项目描述：负责系统开发。\n项目难点：\n登录请求采用RSA+AES混合加密方案。",
        tiptapJson: {
          type: "doc",
          content: [
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "项目描述：负责系统开发。" }],
                    },
                  ],
                },
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "项目难点：" }],
                    },
                    {
                      type: "bulletList",
                      content: [
                        {
                          type: "listItem",
                          content: [
                            {
                              type: "paragraph",
                              content: [
                                {
                                  type: "text",
                                  text: "登录请求采用RSA+AES混合加密方案。",
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      intent: {
        mode: "polish",
        tone: "professional",
        length: "same",
        strategy: "star",
      },
    });

    expect(prompt.developer).toContain("保持原 TipTap 富文本结构");
    expect(prompt.developer).toContain("polishedText");
    expect(prompt.developer).toContain("polishedBlocks");
    expect(prompt.user).toContain("textBlockCount: 3");
    expect(prompt.user).toContain("0. paragraph: 项目描述：负责系统开发。");
    expect(prompt.user).toContain("2. paragraph: 登录请求采用RSA+AES混合加密方案。");
  });

  it("builds a TipTap replacement from block-aligned provider output", async () => {
    const tiptapJson = {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              attrs: { textAlign: "left" },
              content: [
                {
                  type: "paragraph",
                  attrs: { textAlign: "left" },
                  content: [
                    {
                      type: "text",
                      marks: [{ type: "bold" }],
                      text: "项目描述：",
                    },
                    {
                      type: "text",
                      text: "负责企业内部部门管理系统的前后端开发。",
                    },
                  ],
                },
              ],
            },
            {
              type: "listItem",
              attrs: { textAlign: "left" },
              content: [
                {
                  type: "paragraph",
                  attrs: { textAlign: "left" },
                  content: [
                    {
                      type: "text",
                      marks: [{ type: "bold" }],
                      text: "项目难点：",
                    },
                  ],
                },
                {
                  type: "bulletList",
                  content: [
                    {
                      type: "listItem",
                      attrs: { textAlign: "left" },
                      content: [
                        {
                          type: "paragraph",
                          attrs: { textAlign: "left" },
                          content: [
                            {
                              type: "text",
                              text: "登录请求采用RSA+AES混合加密方案。",
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const provider = {
      polish: async () => ({
        content: JSON.stringify({
          polishedText:
            "项目描述：负责企业内部部门管理系统前后端开发与安全体系建设。\n项目难点：\n登录请求采用RSA+AES混合加密方案，降低中间人攻击风险。",
          polishedBlocks: [
            "项目描述：负责企业内部部门管理系统前后端开发与安全体系建设。",
            "项目难点：",
            "登录请求采用RSA+AES混合加密方案，降低中间人攻击风险。",
          ],
          changeSummary: "保留富文本结构，优化项目描述和难点表达。",
          riskFlags: [],
        }),
        usage: {
          provider: "fake-provider",
          model: "fake-model",
          inputTokens: 100,
          outputTokens: 40,
        },
      }),
    };

    const result = await polishRichText({
      request: {
        requestId: "req_tiptap_result",
        resumeId: "resume_abc",
        section: "projects",
        fieldPath: "projects.0.content",
        locale: "zh-CN",
        content: {
          format: "tiptap_json",
          plainText:
            "项目描述：负责企业内部部门管理系统的前后端开发。\n项目难点：\n登录请求采用RSA+AES混合加密方案。",
          tiptapJson,
        },
        intent: {
          mode: "polish",
          tone: "professional",
          length: "same",
          strategy: "star",
        },
      },
      provider,
      session: {
        userId: "user_123",
        resumeId: "resume_abc",
        scope: "rich_text:polish",
        jti: "jti_tiptap_result",
        expiresAt: new Date("2026-06-08T08:02:00.000Z"),
      },
      requestId: "req_tiptap_result",
    });

    expect(result.result.format).toBe("tiptap_json");
    if (result.result.format !== "tiptap_json") {
      throw new Error("Expected TipTap polish result");
    }
    expect(result.result.replacementTiptapJson).toBeDefined();
    const replacement = result.result.replacementTiptapJson as typeof tiptapJson;
    expect(replacement.content[0].type).toBe("bulletList");
    expect(replacement.content[0].content[0].content[0]).toMatchObject({
      type: "paragraph",
      attrs: { textAlign: "left" },
    });
    expect(
      replacement.content[0].content[0].content[0].content[0],
    ).toMatchObject({
      type: "text",
      marks: [{ type: "bold" }],
      text: "项目描述：",
    });
    expect(JSON.stringify(replacement)).toContain(
      "负责企业内部部门管理系统前后端开发与安全体系建设",
    );
    expect(JSON.stringify(replacement)).toContain("降低中间人攻击风险");
    expect(JSON.stringify(replacement)).toContain('"textAlign":"left"');
  });

  it("defaults experience and projects requests to STAR strategy", () => {
    const result = validateRichTextPolishRequest({
      resumeId: "resume_abc",
      section: "projects",
      fieldPath: "projects.0.content",
      locale: "zh-CN",
      content: {
        format: "tiptap_json",
        plainText: "参与订单系统重构。",
        tiptapJson: { type: "doc", content: [] },
      },
      intent: {
        mode: "polish",
        tone: "professional",
        length: "same",
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.intent.strategy).toBe("star");
    }
  });

  it("rejects empty or oversized polish input", () => {
    expect(
      validateRichTextPolishRequest({
        resumeId: "resume_abc",
        section: "experience",
        fieldPath: "experience.0.content",
        locale: "zh-CN",
        content: {
          format: "tiptap_json",
          plainText: "   ",
          tiptapJson: { type: "doc", content: [] },
        },
        intent: {
          mode: "polish",
          tone: "professional",
          length: "same",
          strategy: "star",
        },
      }),
    ).toEqual({
      ok: false,
      statusCode: 400,
      error: "bad_request",
      message: "content.plainText is required",
    });

    expect(
      validateRichTextPolishRequest({
        resumeId: "resume_abc",
        section: "experience",
        fieldPath: "experience.0.content",
        locale: "zh-CN",
        content: {
          format: "plain_text",
          plainText: "字".repeat(4_001),
        },
        intent: {
          mode: "polish",
          tone: "professional",
          length: "same",
          strategy: "star",
        },
      }),
    ).toEqual({
      ok: false,
      statusCode: 413,
      error: "payload_too_large",
      message: "content.plainText must be at most 4000 characters",
    });
  });

  it("parses provider JSON output into the stable response shape", () => {
    const parsed = parsePolishProviderResponse(
      JSON.stringify({
        polishedText: "负责核心业务系统前端开发，持续优化页面性能与交互体验。",
        changeSummary: "优化措辞，使表达更专业。",
        riskFlags: [
          {
            type: "too_little_context",
            message: "原文缺少可量化结果，已按现有信息保守润色。",
          },
        ],
      }),
    );

    expect(parsed).toEqual({
      ok: true,
      result: {
        format: "plain_text",
        polishedText: "负责核心业务系统前端开发，持续优化页面性能与交互体验。",
        changeSummary: "优化措辞，使表达更专业。",
        riskFlags: [
          {
            type: "too_little_context",
            message: "原文缺少可量化结果，已按现有信息保守润色。",
          },
        ],
      },
    });
  });

  it("sends DeepSeek-compatible chat completion messages", async () => {
    let requestBody: unknown;
    const fetchFn: typeof fetch = async (_input, init) => {
      requestBody = JSON.parse(init?.body as string);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  polishedText: "负责核心业务系统前端开发。",
                  changeSummary: "优化表达。",
                  riskFlags: [],
                }),
              },
            },
          ],
          usage: {
            prompt_tokens: 20,
            completion_tokens: 10,
          },
        }),
        { status: 200 },
      );
    };
    const provider = createOpenAICompatibleRichTextPolishProvider(
      {
        host: "127.0.0.1",
        port: 8787,
        serviceName: "intro-agent-test",
        version: "test-version",
        nodeEnv: "test",
        shutdownTimeoutMs: 100,
        redisUrl: "redis://127.0.0.1:6379",
        redisConnectTimeoutMs: 100,
        rateLimitWindowSeconds: 60,
        rateLimitMaxRequests: 30,
        jwtIssuer: "intro-builder-web",
        jwtAudience: "intro-builder-agent",
        jwtSecret: "test-agent-secret",
        jwtReplayTtlSeconds: 180,
        modelBaseUrl: "https://api.deepseek.com",
        modelApiKey: "deepseek-test-key",
        modelName: "deepseek-v4-flash",
        modelTimeoutMs: 20_000,
        langfuse: {
          enabled: false,
          publicKey: undefined,
          secretKey: undefined,
          baseUrl: "https://cloud.langfuse.com",
          environment: "test",
          release: "test-version",
          timeoutSeconds: 5,
          sampleRate: 1,
          captureRawPayloads: false,
        },
      },
      fetchFn,
    );

    expect(provider).toBeDefined();
    await provider!.polish({
      request: {
        resumeId: "resume_abc",
        section: "experience",
        fieldPath: "experience.0.content",
        locale: "zh-CN",
        content: {
          format: "plain_text",
          plainText: "负责业务系统前端开发。",
        },
        intent: {
          mode: "polish",
          tone: "professional",
          length: "same",
          strategy: "star",
        },
      },
      prompt: {
        system: "system rules",
        developer: "developer rules",
        user: "user payload",
      },
      session: {
        userId: "user_123",
        resumeId: "resume_abc",
        scope: "rich_text:polish",
        jti: "jti_provider_test",
        expiresAt: new Date("2026-06-08T08:02:00.000Z"),
      },
      requestId: "req_provider_test",
    });

    expect(requestBody).toEqual({
      model: "deepseek-v4-flash",
      response_format: { type: "json_object" },
      thinking: { type: "disabled" },
      messages: [
        {
          role: "system",
          content: "system rules\n\n开发者指令：\ndeveloper rules",
        },
        { role: "user", content: "user payload" },
      ],
    });
  });
});
