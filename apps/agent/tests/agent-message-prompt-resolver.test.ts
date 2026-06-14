import { describe, expect, it, vi } from "vitest";

import type { AgentMessageRequest } from "../src/agent-messages";
import { loadConfig } from "../src/config";
import {
  createAgentMessagePromptResolver,
  type LangfusePromptClient,
} from "../src/prompts/agent-message-prompt-resolver";

describe("agent message prompt resolver", () => {
  it("uses the local prompt when Langfuse prompt management is disabled", async () => {
    const langfuse: LangfusePromptClient = {
      prompt: { get: vi.fn() },
    };
    const resolver = createAgentMessagePromptResolver(loadConfig({}), {
      langfuse,
    });

    const prompt = await resolver.resolve({
      ...request(),
      requestId: "req_prompt",
    });

    expect(langfuse.prompt.get).not.toHaveBeenCalled();
    expect(prompt.system).toContain("intro-builder 的简历 Agent");
    expect(prompt.metadata).toEqual({ source: "local" });
  });

  it("compiles a Langfuse chat prompt with the local prompt sections as variables", async () => {
    const getPrompt = vi.fn(async () => ({
      name: "intro-builder/agent-message",
      version: 4,
      isFallback: false,
      compile: vi.fn((variables: Record<string, string>) => [
        { role: "system", content: `远端系统: ${variables.system.slice(0, 18)}` },
        { role: "user", content: `远端用户: ${variables.user.slice(0, 18)}` },
      ]),
    }));
    const resolver = createAgentMessagePromptResolver(
      loadConfig({
        LANGFUSE_PUBLIC_KEY: "pk_test",
        LANGFUSE_SECRET_KEY: "sk_test",
        LANGFUSE_PROMPT_MANAGEMENT_ENABLED: "true",
        LANGFUSE_AGENT_MESSAGE_PROMPT_NAME: "intro-builder/agent-message",
        LANGFUSE_PROMPT_LABEL: "production",
      }),
      { langfuse: { prompt: { get: getPrompt } } },
    );

    const prompt = await resolver.resolve({
      ...request(),
      requestId: "req_prompt",
    });

    expect(getPrompt).toHaveBeenCalledWith(
      "intro-builder/agent-message",
      expect.objectContaining({
        type: "chat",
        label: "production",
        cacheTtlSeconds: 300,
        fallback: [
          {
            role: "system",
            content: "{{system}}\n\n开发者指令：\n{{developer}}",
          },
          { role: "user", content: "{{user}}" },
        ],
      }),
    );
    expect(prompt.messages).toEqual([
      { role: "system", content: expect.stringContaining("远端系统") },
      { role: "user", content: expect.stringContaining("远端用户") },
    ]);
    expect(prompt.metadata).toEqual({
      source: "langfuse",
      name: "intro-builder/agent-message",
      label: "production",
      version: 4,
      isFallback: false,
    });
  });

  it("falls back to the local prompt when compiled Langfuse messages are malformed", async () => {
    const resolver = createAgentMessagePromptResolver(
      loadConfig({
        LANGFUSE_PUBLIC_KEY: "pk_test",
        LANGFUSE_SECRET_KEY: "sk_test",
        LANGFUSE_PROMPT_MANAGEMENT_ENABLED: "true",
      }),
      {
        langfuse: {
          prompt: {
            get: vi.fn(async () => ({
              name: "intro-builder/agent-message",
              version: 5,
              isFallback: true,
              compile: vi.fn(() => [{ type: "placeholder", name: "history" }]),
            })),
          },
        },
      },
    );

    const prompt = await resolver.resolve({
      ...request(),
      requestId: "req_prompt",
    });

    expect(prompt.messages).toBeUndefined();
    expect(prompt.metadata).toEqual({ source: "local" });
  });

  it("falls back to the local prompt when Langfuse prompt retrieval fails", async () => {
    const resolver = createAgentMessagePromptResolver(
      loadConfig({
        LANGFUSE_PUBLIC_KEY: "pk_test",
        LANGFUSE_SECRET_KEY: "sk_test",
        LANGFUSE_PROMPT_MANAGEMENT_ENABLED: "true",
      }),
      {
        langfuse: {
          prompt: {
            get: vi.fn(async () => {
              throw new Error("Langfuse unavailable");
            }),
          },
        },
      },
    );

    const prompt = await resolver.resolve({
      ...request(),
      requestId: "req_prompt",
    });

    expect(prompt.messages).toBeUndefined();
    expect(prompt.metadata).toEqual({ source: "local" });
    expect(prompt.system).toContain("intro-builder 的简历 Agent");
  });
});

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
