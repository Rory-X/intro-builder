import type { LanguageModel, LanguageModelUsage } from "ai";
import { describe, expect, it, vi } from "vitest";

import { loadConfig } from "../src/config";
import {
  createAiSdkAgentMessageProvider,
  type AiSdkAgentMessageRuntime,
} from "../src/providers/ai-sdk-agent-message-provider";
import type { AgentMessagePrompt, AgentMessageRequest } from "../src/agent-messages";

describe("AI SDK agent message provider", () => {
  it("uses AI SDK generateText-compatible runtime for non-streaming runs", async () => {
    const model = fakeModel();
    const runtime: AiSdkAgentMessageRuntime = {
      createModel: vi.fn(() => model),
      generate: vi.fn(async () => ({
        text: providerJson("AI SDK 生成完成。"),
        usage: usage(11, 7),
      })),
      stream: vi.fn(),
    };
    const provider = createAiSdkAgentMessageProvider(loadConfig(modelEnv()), {
      runtime,
    });
    if (!provider) throw new Error("expected provider");

    const result = await provider.run({
      request: request(),
      prompt: prompt(),
      session: session(),
      requestId: "req_ai_sdk",
    });

    expect(runtime.createModel).toHaveBeenCalledWith({
      baseUrl: "https://model.test/v1",
      apiKey: "model-key",
      modelName: "deepseek-chat",
    });
    expect(runtime.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        model,
        timeoutMs: 30_000,
        system: "系统\n\n开发者指令：\n开发者",
        messages: [{ role: "user", content: "用户" }],
        telemetry: expect.objectContaining({
          isEnabled: true,
          recordInputs: false,
          recordOutputs: false,
          functionId: "agent.message.provider",
        }),
      }),
    );
    expect(result).toEqual({
      content: providerJson("AI SDK 生成完成。"),
      usage: {
        provider: "ai-sdk/openai-compatible",
        model: "deepseek-chat",
        inputTokens: 11,
        outputTokens: 7,
      },
    });
  });

  it("streams AI SDK text deltas and yields final usage", async () => {
    const runtime: AiSdkAgentMessageRuntime = {
      createModel: vi.fn(() => fakeModel()),
      generate: vi.fn(),
      stream: vi.fn(() => ({
        textStream: asyncIterable(["{\"message\":", "{\"id\":\"msg\"}"]),
        usage: Promise.resolve(usage(13, 5)),
      })),
    };
    const provider = createAiSdkAgentMessageProvider(loadConfig(modelEnv()), {
      runtime,
    });
    if (!provider?.stream) throw new Error("expected streaming provider");

    const chunks = [];
    for await (const chunk of provider.stream({
      request: request(),
      prompt: {
        ...prompt(),
        messages: [{ role: "user", content: "compiled user prompt" }],
      },
      session: session(),
      requestId: "req_ai_sdk_stream",
    })) {
      chunks.push(chunk);
    }

    expect(runtime.stream).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: "user", content: "compiled user prompt" }],
      }),
    );
    expect(chunks).toEqual([
      { type: "content_delta", delta: "{\"message\":" },
      { type: "content_delta", delta: "{\"id\":\"msg\"}" },
      {
        type: "usage",
        usage: {
          provider: "ai-sdk/openai-compatible",
          model: "deepseek-chat",
          inputTokens: 13,
          outputTokens: 5,
        },
      },
    ]);
  });

  it("is undefined until model config is complete", () => {
    expect(createAiSdkAgentMessageProvider(loadConfig({}))).toBeUndefined();
  });
});

function modelEnv(): Record<string, string> {
  return {
    AGENT_MODEL_BASE_URL: "https://model.test/v1",
    AGENT_MODEL_API_KEY: "model-key",
    AGENT_MODEL_NAME: "deepseek-chat",
    AGENT_MODEL_TIMEOUT_MS: "30000",
  };
}

function prompt(): AgentMessagePrompt {
  return {
    system: "系统",
    developer: "开发者",
    user: "用户",
  };
}

function providerJson(content: string): string {
  return JSON.stringify({
    message: { id: "msg_assistant", role: "assistant", content },
    toolCalls: [],
    proposedOperations: [],
  });
}

function usage(inputTokens: number, outputTokens: number): LanguageModelUsage {
  return {
    inputTokens,
    inputTokenDetails: {
      noCacheTokens: undefined,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
    },
    outputTokens,
    outputTokenDetails: {
      textTokens: undefined,
      reasoningTokens: undefined,
    },
    totalTokens: inputTokens + outputTokens,
  };
}

async function* asyncIterable<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

function fakeModel(): LanguageModel {
  return { provider: "fake", modelId: "fake-model" } as unknown as LanguageModel;
}

function session() {
  return {
    userId: "user_123",
    resumeId: "resume_abc",
    scope: "agent:chat" as const,
    jti: "jti_ai_sdk",
    expiresAt: new Date("2026-06-14T00:00:00.000Z"),
  };
}

function request(): AgentMessageRequest {
  return {
    resumeId: "resume_abc",
    locale: "zh-CN",
    workflowId: "resume-diagnose",
    messages: [{ id: "msg_user", role: "user", content: "诊断简历" }],
    context: {
      resumeTitle: "前端工程师",
      templateId: "professional",
      activeSection: null,
      completeness: {
        overall: 70,
        sections: [{ key: "experience", label: "工作经历", score: 8, max: 10 }],
      },
      sections: [
        {
          key: "experience",
          label: "工作经历",
          fieldPath: "experience.0.content",
          plainText: "负责前端开发。",
        },
      ],
    },
  };
}
