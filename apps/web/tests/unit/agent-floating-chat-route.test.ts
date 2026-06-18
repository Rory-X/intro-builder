import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

const aiMocks = vi.hoisted(() => ({
  streamText: vi.fn(),
  stepCountIs: vi.fn((count: number) => ({ type: "step-count", count })),
  tool: vi.fn((definition: unknown) => definition),
  createOpenAICompatible: vi.fn(),
  modelFactory: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({ currentUserId: vi.fn() }));
vi.mock("@/lib/agent/floating-chat-session-store", () => ({
  appendFloatingChatMessage: vi.fn(),
  getFloatingChatSession: vi.fn(),
  renameFloatingChatSession: vi.fn(),
}));
vi.mock("ai", () => ({
  streamText: aiMocks.streamText,
  stepCountIs: aiMocks.stepCountIs,
  tool: aiMocks.tool,
}));
vi.mock("@ai-sdk/openai-compatible", () => ({
  createOpenAICompatible: aiMocks.createOpenAICompatible,
}));

import { currentUserId } from "@/lib/auth-helpers";
import {
  appendFloatingChatMessage,
  getFloatingChatSession,
  renameFloatingChatSession,
} from "@/lib/agent/floating-chat-session-store";
import { POST, runtime } from "@/app/api/agent/floating/chat/route";

const hiddenDefaultModel = "默认" + "模型";

describe("POST /api/agent/floating/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    aiMocks.modelFactory.mockReturnValue({ modelId: "gpt-4.1-mini" });
    aiMocks.createOpenAICompatible.mockReturnValue(aiMocks.modelFactory);
  });

  it("uses the Node runtime", () => {
    expect(runtime).toBe("nodejs");
  });

  it("requires a Web user session", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue(null);

    const response = await POST(jsonRequest(validBody()));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "未登录" });
  });

  it("requires the user to connect a model", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");

    const response = await POST(
      jsonRequest({
        messages: [{ role: "user", content: "优化最近经历" }],
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "请先连接模型" });
    expect(aiMocks.createOpenAICompatible).not.toHaveBeenCalled();
    expect(aiMocks.streamText).not.toHaveBeenCalled();
  });

  it("streams visible deltas through AI SDK and returns resume operations from tool calls", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");
    aiMocks.streamText.mockImplementation((options: {
      tools: {
        readResume: {
          execute: (input: unknown, options: { toolCallId: string }) => Promise<unknown>;
        };
        updateSection: {
          execute: (input: unknown, options: { toolCallId: string }) => Promise<unknown>;
        };
        addSection: {
          execute: (input: unknown, options: { toolCallId: string }) => Promise<unknown>;
        };
        rewriteText: unknown;
        suggestSkills: unknown;
        analyzeJobMatch: unknown;
      };
    }) => ({
      fullStream: (async function* () {
        yield { type: "text-delta", text: "我先读取简历。" };
        yield { type: "tool-input-start", id: "tool_read_1", toolName: "readResume" };
        yield { type: "tool-input-delta", id: "tool_read_1", delta: "{}" };
        const readOutput = await options.tools.readResume.execute(
          {},
          { toolCallId: "tool_read_1" },
        );
        yield {
          type: "tool-call",
          toolCallId: "tool_read_1",
          toolName: "readResume",
          input: {},
        };
        yield {
          type: "tool-result",
          toolCallId: "tool_read_1",
          toolName: "readResume",
          input: {},
          output: readOutput,
        };
        yield { type: "text-delta", text: "我会更新最近经历。" };
        await options.tools.updateSection.execute(
          {
            fieldPath: "experience.0.content",
            section: "experience",
            beforePlainText: "负责开发。",
            value: "主导核心链路优化。",
            label: "更新经历",
            changeSummary: "强化行动与结果。",
          },
          { toolCallId: "tool_1" },
        );
        yield {
          type: "tool-result",
          toolCallId: "tool_1",
          toolName: "updateSection",
          input: {
            fieldPath: "experience.0.content",
            section: "experience",
            beforePlainText: "负责开发。",
            value: "主导核心链路优化。",
            label: "更新经历",
            changeSummary: "强化行动与结果。",
          },
          output: { success: true },
        };
        yield { type: "text-delta", text: "已优化最近经历。" };
      })(),
    }));

    const response = await POST(jsonRequest(validBody()));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(aiMocks.createOpenAICompatible).toHaveBeenCalledWith({
      name: "intro-floating-openai-compatible",
      apiKey: "sk-request",
      baseURL: "https://models.example.test/v1",
      includeUsage: true,
    });
    expect(aiMocks.modelFactory).toHaveBeenCalledWith("gpt-4.1-mini");
    expect(aiMocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { modelId: "gpt-4.1-mini" },
        stopWhen: { type: "step-count", count: 25 },
        tools: expect.objectContaining({
          readResume: expect.any(Object),
          updateSection: expect.any(Object),
          addSection: expect.any(Object),
          rewriteText: expect.any(Object),
          suggestSkills: expect.any(Object),
          analyzeJobMatch: expect.any(Object),
        }),
      }),
    );
    expect(aiMocks.stepCountIs).toHaveBeenCalledWith(25);
    const streamArgs = aiMocks.streamText.mock.calls[0][0];
    expect(streamArgs.system).toBeUndefined();
    expect(JSON.stringify(streamArgs)).not.toContain(hiddenDefaultModel);
    const events = await readSseEvents(response);
    expect(events).toEqual(
      expect.arrayContaining([
        { type: "text-delta", delta: "我先读取简历。" },
        expect.objectContaining({
          type: "tool-call-start",
          toolCall: expect.objectContaining({
            id: "tool_read_1",
            name: "readResume",
            status: "running",
          }),
        }),
        expect.objectContaining({
          type: "tool-call-result",
          toolCall: expect.objectContaining({
            id: "tool_read_1",
            name: "readResume",
            status: "completed",
          }),
          operations: [],
        }),
        { type: "text-delta", delta: "我会更新最近经历。" },
        expect.objectContaining({
          type: "tool-call-result",
          toolCall: expect.objectContaining({
            id: "tool_1",
            name: "updateSection",
            status: "completed",
          }),
          operations: [
            expect.objectContaining({
              id: "floating_tool_1",
              fieldPath: "experience.0.content",
              afterPlainText: "主导核心链路优化。",
            }),
          ],
        }),
        { type: "text-delta", delta: "已优化最近经历。" },
        expect.objectContaining({
          type: "done",
          message: "我先读取简历。我会更新最近经历。已优化最近经历。",
          operations: [
            expect.objectContaining({
              id: "floating_tool_1",
              fieldPath: "experience.0.content",
            }),
          ],
          toolCalls: expect.arrayContaining([
            expect.objectContaining({ id: "tool_read_1", name: "readResume" }),
            expect.objectContaining({ id: "tool_1", name: "updateSection" }),
          ]),
        }),
      ]),
    );
  });

  it("exposes reference-style add and analysis tools without forcing final text before tools", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");
    aiMocks.streamText.mockImplementation((options: {
      tools: {
        addSection: {
          execute: (input: unknown, options: { toolCallId: string }) => Promise<unknown>;
        };
        analyzeJobMatch: {
          execute: (input: unknown, options: { toolCallId: string }) => Promise<unknown>;
        };
      };
    }) => ({
      fullStream: (async function* () {
        yield { type: "text-delta", text: "先补一个项目经历。" };
        await options.tools.addSection.execute(
          {
            section: "projects",
            value: "负责在线简历编辑器性能优化，首屏渲染耗时下降 32%。",
            label: "新增项目经历",
            changeSummary: "补充可量化项目经历。",
          },
          { toolCallId: "tool_add_1" },
        );
        yield {
          type: "tool-result",
          toolCallId: "tool_add_1",
          toolName: "addSection",
          input: { section: "projects" },
          output: { success: true },
        };
        yield { type: "text-delta", text: "再看岗位匹配。" };
        const analysisOutput = await options.tools.analyzeJobMatch.execute(
          { jobDescription: "前端工程师，要求性能优化经验。" },
          { toolCallId: "tool_match_1" },
        );
        yield {
          type: "tool-result",
          toolCallId: "tool_match_1",
          toolName: "analyzeJobMatch",
          input: { jobDescription: "前端工程师，要求性能优化经验。" },
          output: analysisOutput,
        };
        yield { type: "text-delta", text: "项目经历已经对齐岗位关键词。" };
      })(),
    }));

    const response = await POST(
      jsonRequest({
        ...validBody(),
        context: {
          ...validBody().context,
          sections: [
            {
              key: "projects",
              label: "项目经历 1",
              fieldPath: "projects.0.content",
              plainText: "负责旧项目。",
            },
          ],
        },
      }),
    );

    expect(response.status).toBe(200);
    const events = await readSseEvents(response);
    expect(events).toEqual(
      expect.arrayContaining([
        { type: "text-delta", delta: "先补一个项目经历。" },
        expect.objectContaining({
          type: "tool-call-result",
          toolCall: expect.objectContaining({
            id: "tool_add_1",
            name: "addSection",
            status: "completed",
          }),
          operations: [
            expect.objectContaining({
              id: "floating_tool_add_1",
              operation: "insert_section",
              section: "projects",
              fieldPath: "projects.1.content",
              afterPlainText: "负责在线简历编辑器性能优化，首屏渲染耗时下降 32%。",
            }),
          ],
        }),
        { type: "text-delta", delta: "再看岗位匹配。" },
        expect.objectContaining({
          type: "tool-call-result",
          toolCall: expect.objectContaining({
            id: "tool_match_1",
            name: "analyzeJobMatch",
            status: "completed",
          }),
          operations: [],
        }),
        { type: "text-delta", delta: "项目经历已经对齐岗位关键词。" },
      ]),
    );
  });

  it("persists user and assistant messages when a session id is provided", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");
    (getFloatingChatSession as unknown as Mock).mockResolvedValue({
      id: "session_1",
      title: "新对话",
      resumeId: "resume_abc",
    });
    aiMocks.streamText.mockReturnValue({
      fullStream: (async function* () {
        yield { type: "text-delta", text: "已优化" };
        yield { type: "text-delta", text: "最近经历。" };
      })(),
    });

    const response = await POST(
      jsonRequest({
        ...validBody(),
        sessionId: "session_1",
      }),
    );

    expect(response.status).toBe(200);
    await response.text();
    expect(getFloatingChatSession).toHaveBeenCalledWith({
      sessionId: "session_1",
      userId: "user_123",
    });
    expect(renameFloatingChatSession).toHaveBeenCalledWith({
      sessionId: "session_1",
      userId: "user_123",
      title: "请直接优化最近经历",
    });
    expect(appendFloatingChatMessage).toHaveBeenNthCalledWith(1, {
      sessionId: "session_1",
      role: "user",
      content: "请直接优化最近经历",
    });
    expect(appendFloatingChatMessage).toHaveBeenNthCalledWith(2, {
      sessionId: "session_1",
      role: "assistant",
      content: "已优化最近经历。",
      parts: [
        expect.objectContaining({
          type: "text",
          text: "已优化最近经历。",
        }),
      ],
      toolCalls: [],
      operations: [],
    });
  });
});

async function readSseEvents(response: Response) {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((chunk) => {
      const data = chunk.replace(/^data: /, "");
      return JSON.parse(data) as unknown;
    });
}

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/agent/floating/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validBody() {
  return {
    resumeId: "resume_abc",
    locale: "zh-CN",
    messages: [{ role: "user", content: "请直接优化最近经历" }],
    context: {
      resumeId: "resume_abc",
      title: "前端工程师",
      sections: [{ id: "experience", title: "工作经历", items: [] }],
    },
    modelConfig: {
      baseUrl: "https://models.example.test/v1",
      apiKey: "sk-request",
      modelName: "gpt-4.1-mini",
    },
  };
}
