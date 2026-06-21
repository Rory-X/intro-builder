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
        updateWorkExperienceBlock: {
          execute: (input: unknown, options: { toolCallId: string }) => Promise<unknown>;
        };
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
        await options.tools.updateWorkExperienceBlock.execute(
          {
            index: 0,
            beforePlainText: "负责开发。",
            content: "主导核心链路优化。",
            changeSummary: "强化行动与结果。",
          },
          { toolCallId: "tool_1" },
        );
        yield {
          type: "tool-result",
          toolCallId: "tool_1",
          toolName: "updateWorkExperienceBlock",
          input: {
            index: 0,
            beforePlainText: "负责开发。",
            content: "主导核心链路优化。",
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
          updateWorkExperienceBlock: expect.any(Object),
          suggestSkills: expect.any(Object),
          analyzeJobMatch: expect.any(Object),
        }),
      }),
    );
    expect(aiMocks.stepCountIs).toHaveBeenCalledWith(25);
    const streamArgs = aiMocks.streamText.mock.calls[0][0];
    expect(streamArgs.system).toContain("调用 askUser 追问");
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
            name: "updateWorkExperienceBlock",
            status: "completed",
          }),
          operations: [
            expect.objectContaining({
              id: "floating_tool_1",
              fieldPath: "experience.0",
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
              fieldPath: "experience.0",
            }),
          ],
          toolCalls: expect.arrayContaining([
            expect.objectContaining({ id: "tool_read_1", name: "readResume" }),
            expect.objectContaining({ id: "tool_1", name: "updateWorkExperienceBlock" }),
          ]),
        }),
      ]),
    );
    expect(streamArgs.tools).not.toHaveProperty("updateSection");
    expect(streamArgs.tools).not.toHaveProperty("addSection");
    expect(streamArgs.tools).not.toHaveProperty("rewriteText");
    expect(streamArgs.tools.suggestSkills.inputSchema.def.shape).not.toHaveProperty("fieldPath");
  });

  it("emits approval requests instead of direct operations in approval write mode", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");
    aiMocks.streamText.mockImplementation((options: {
      tools: {
        updateWorkExperienceBlock: {
          execute: (input: unknown, options: { toolCallId: string }) => Promise<unknown>;
        };
      };
    }) => ({
      fullStream: (async function* () {
        yield { type: "text-delta", text: "我准备更新最近经历。" };
        await options.tools.updateWorkExperienceBlock.execute(
          {
            index: 0,
            beforePlainText: "负责开发。",
            content: "主导核心链路优化。",
            changeSummary: "强化行动与结果。",
          },
          { toolCallId: "tool_approval_1" },
        );
        yield {
          type: "tool-result",
          toolCallId: "tool_approval_1",
          toolName: "updateWorkExperienceBlock",
          input: {
            index: 0,
          },
          output: { success: true },
        };
        yield {
          type: "text-delta",
          text: "不应该在用户确认前继续生成。",
        };
      })(),
    }));

    const response = await POST(
      jsonRequest({
        ...validBody(),
        writeMode: "approval",
      }),
    );

    expect(response.status).toBe(200);
    const events = await readSseEvents(response);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool-call-result",
          toolCall: expect.objectContaining({
            id: "tool_approval_1",
            name: "updateWorkExperienceBlock",
            status: "completed",
          }),
          operations: [],
        }),
        expect.objectContaining({
          type: "approval-request",
          approvalRequest: expect.objectContaining({
            id: "floating_tool_approval_1",
            status: "pending",
            reason: "approval_required",
            message: "强化行动与结果。",
            operation: expect.objectContaining({
              id: "floating_tool_approval_1",
              fieldPath: "experience.0",
              afterPlainText: "主导核心链路优化。",
            }),
          }),
        }),
        expect.objectContaining({
          type: "done",
          operations: [],
          approvalRequests: [
            expect.objectContaining({
              id: "floating_tool_approval_1",
              status: "pending",
            }),
          ],
        }),
      ]),
    );
    expect(events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "text-delta",
          delta: "不应该在用户确认前继续生成。",
        }),
      ]),
    );
  });

  it("emits question requests when the floating agent needs user input", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");
    aiMocks.streamText.mockImplementation((options: {
      tools: {
        askUser: {
          execute: (input: unknown, options: { toolCallId: string }) => Promise<unknown>;
        };
      };
    }) => ({
      fullStream: (async function* () {
        const output = await options.tools.askUser.execute(
          {
            question: "这个项目最终带来了哪些指标变化？",
            field: "projects.0.content",
          },
          { toolCallId: "tool_question_1" },
        );
        yield {
          type: "tool-result",
          toolCallId: "tool_question_1",
          toolName: "askUser",
          input: { question: "这个项目最终带来了哪些指标变化？" },
          output,
        };
        yield {
          type: "text-delta",
          text: "这段不应该在问题卡片后继续出现。",
        };
      })(),
    }));

    const response = await POST(jsonRequest(validBody()));

    expect(response.status).toBe(200);
    expect(aiMocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.objectContaining({
          askUser: expect.any(Object),
        }),
      }),
    );
    const events = await readSseEvents(response);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool-call-result",
          toolCall: expect.objectContaining({
            id: "tool_question_1",
            name: "askUser",
            status: "completed",
          }),
          operations: [],
        }),
        expect.objectContaining({
          type: "question-request",
          question: expect.objectContaining({
            id: "floating_question_tool_question_1",
            question: "这个项目最终带来了哪些指标变化？",
            field: "projects.0.content",
          }),
        }),
        expect.objectContaining({
          type: "done",
          operations: [],
          approvalRequests: [],
          questions: [
            expect.objectContaining({
              id: "floating_question_tool_question_1",
              question: "这个项目最终带来了哪些指标变化？",
              field: "projects.0.content",
            }),
          ],
        }),
      ]),
    );
    expect(events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "text-delta",
          delta: "这段不应该在问题卡片后继续出现。",
        }),
      ]),
    );
  });

  it("exposes reference-style add and analysis tools without forcing final text before tools", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");
    aiMocks.streamText.mockImplementation((options: {
      tools: {
        addProject: {
          execute: (input: unknown, options: { toolCallId: string }) => Promise<unknown>;
        };
        analyzeJobMatch: {
          execute: (input: unknown, options: { toolCallId: string }) => Promise<unknown>;
        };
      };
    }) => ({
      fullStream: (async function* () {
        yield { type: "text-delta", text: "先补一个项目经历。" };
        await options.tools.addProject.execute(
          {
            name: "在线简历编辑器",
            content: "负责在线简历编辑器性能优化，首屏渲染耗时下降 32%。",
            changeSummary: "补充可量化项目经历。",
          },
          { toolCallId: "tool_add_1" },
        );
        yield {
          type: "tool-result",
          toolCallId: "tool_add_1",
          toolName: "addProject",
          input: { name: "在线简历编辑器" },
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
            name: "addProject",
            status: "completed",
          }),
          operations: [
            expect.objectContaining({
              id: "floating_tool_add_1",
              operation: "insert_section",
              section: "projects",
              fieldPath: "projects.1",
              afterPlainText: "负责在线简历编辑器性能优化，首屏渲染耗时下降 32%。",
              replacementValue: expect.objectContaining({
                name: "在线简历编辑器",
              }),
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

  it("exposes semantic basics and style tools as block actions", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");
    aiMocks.streamText.mockImplementation((options: {
      tools: {
        updateBasicsBlock: {
          execute: (input: unknown, options: { toolCallId: string }) => Promise<unknown>;
        };
        updateStyleSettingsBlock: {
          execute: (input: unknown, options: { toolCallId: string }) => Promise<unknown>;
        };
      };
    }) => ({
      fullStream: (async function* () {
        await options.tools.updateBasicsBlock.execute(
          {
            name: "李四",
            photo: "https://example.com/avatar.jpg",
            summary: "三年后端经验",
            beforePlainText: "张三",
          },
          { toolCallId: "tool_basics_1" },
        );
        yield {
          type: "tool-result",
          toolCallId: "tool_basics_1",
          toolName: "updateBasicsBlock",
          input: { name: "李四", photo: "https://example.com/avatar.jpg" },
          output: { success: true },
        };
        await options.tools.updateStyleSettingsBlock.execute(
          {
            fontSize: 12,
            photoScale: 0.9,
            beforePlainText: "13",
          },
          { toolCallId: "tool_style_1" },
        );
        yield {
          type: "tool-result",
          toolCallId: "tool_style_1",
          toolName: "updateStyleSettingsBlock",
          input: { fontSize: 12, photoScale: 0.9 },
          output: { success: true },
        };
      })(),
    }));

    const response = await POST(jsonRequest(validBody()));

    expect(response.status).toBe(200);
    expect(aiMocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.objectContaining({
          updateBasicsBlock: expect.any(Object),
          updateStyleSettingsBlock: expect.any(Object),
        }),
      }),
    );
    const streamArgs = aiMocks.streamText.mock.calls[0][0];
    expect(streamArgs.tools).not.toHaveProperty("setCandidateName");
    expect(streamArgs.tools).not.toHaveProperty("setCandidatePhoto");
    expect(streamArgs.tools).not.toHaveProperty("setContactEmail");
    expect(streamArgs.tools).not.toHaveProperty("setResumeFontSize");
    expect(streamArgs.tools).not.toHaveProperty("setResumePhotoScale");
    const events = await readSseEvents(response);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool-call-result",
          toolCall: expect.objectContaining({
            id: "tool_basics_1",
            name: "updateBasicsBlock",
          }),
          operations: [
            expect.objectContaining({
              id: "floating_tool_basics_1",
              section: "basics",
              fieldPath: "basics",
              replacementValue: expect.objectContaining({
                name: "李四",
                photo: "https://example.com/avatar.jpg",
                summary: "三年后端经验",
              }),
            }),
          ],
        }),
        expect.objectContaining({
          type: "tool-call-result",
          toolCall: expect.objectContaining({
            id: "tool_style_1",
            name: "updateStyleSettingsBlock",
          }),
          operations: [
            expect.objectContaining({
              id: "floating_tool_style_1",
              section: "style",
              fieldPath: "styleSettings",
              replacementValue: expect.objectContaining({
                fontSize: 12,
                photoScale: 0.9,
              }),
            }),
          ],
        }),
      ]),
    );
  });

  it("keeps block tool schemas aligned with editable resume schema fields", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");
    aiMocks.streamText.mockReturnValue({
      fullStream: (async function* () {})(),
    });

    const response = await POST(jsonRequest(validBody()));

    expect(response.status).toBe(200);
    await response.text();
    const tools = aiMocks.streamText.mock.calls[0][0].tools;
    expectToolSchemaKeys(tools.updateBasicsBlock, [
        "name",
        "status",
        "title",
        "email",
        "phone",
        "location",
        "website",
        "summary",
        "photo",
        "beforePlainText",
        "changeSummary",
      ]);
    expectToolSchemaKeys(tools.updateStyleSettingsBlock, [
        "fontFamily",
        "fontSize",
        "lineHeight",
        "bodyLineHeight",
        "headingGap",
        "pagePadding",
        "sectionGap",
        "itemGap",
        "photoScale",
        "beforePlainText",
        "changeSummary",
      ]);
    expectToolSchemaKeys(tools.updateWorkExperienceBlock, [
      "index",
      "company",
      "title",
      "start",
      "end",
      "location",
      "content",
      "beforePlainText",
      "changeSummary",
    ]);
    expectToolSchemaKeys(tools.addWorkExperience, [
      "company",
      "title",
      "start",
      "end",
      "location",
      "content",
      "beforePlainText",
      "changeSummary",
    ]);
    expectToolSchemaKeys(tools.updateEducationBlock, [
        "index",
        "school",
        "degree",
        "major",
        "location",
        "start",
        "end",
        "gpa",
        "highlights",
        "beforePlainText",
        "changeSummary",
      ]);
    expectToolSchemaKeys(tools.addEducation, [
        "school",
        "degree",
        "major",
        "location",
        "start",
        "end",
        "gpa",
        "highlights",
        "beforePlainText",
        "changeSummary",
      ]);
    expectToolSchemaKeys(tools.updateProjectBlock, [
        "index",
        "name",
        "role",
        "location",
        "start",
        "end",
        "stack",
        "link",
        "content",
        "beforePlainText",
        "changeSummary",
      ]);
    expectToolSchemaKeys(tools.addProject, [
        "name",
        "role",
        "location",
        "start",
        "end",
        "stack",
        "link",
        "content",
        "beforePlainText",
        "changeSummary",
      ]);
    expectToolSchemaKeys(tools.updateResearchBlock, [
        "index",
        "name",
        "role",
        "location",
        "start",
        "end",
        "paperTitle",
        "link",
        "content",
        "beforePlainText",
        "changeSummary",
      ]);
    expectToolSchemaKeys(tools.addResearch, [
        "name",
        "role",
        "location",
        "start",
        "end",
        "paperTitle",
        "link",
        "content",
        "beforePlainText",
        "changeSummary",
      ]);
    expectToolSchemaKeys(tools.updateCustomSectionBlock, [
      "sectionId",
      "title",
      "content",
      "beforePlainText",
      "changeSummary",
    ]);
    expectToolSchemaKeys(tools.addCustomSection, [
      "title",
      "content",
      "beforePlainText",
      "changeSummary",
    ]);
    expectToolSchemaKeys(tools.writeSkillsSection, ["content", "beforePlainText", "changeSummary"]);
    expectToolSchemaKeys(tools.writePersonalSummarySection, ["content", "beforePlainText", "changeSummary"]);
    expectToolSchemaKeys(tools.writeAwardsSection, ["content", "beforePlainText", "changeSummary"]);
    expectToolSchemaKeys(tools.writePortfolioSection, ["content", "beforePlainText", "changeSummary"]);
    expect(schemaKeys(tools.reorderResumeModules)).toContain("sectionOrder");
  });

  it("allows block tools to clear rich-text fields with an empty string", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");
    aiMocks.streamText.mockReturnValue({
      fullStream: (async function* () {})(),
    });

    const response = await POST(jsonRequest(validBody()));

    expect(response.status).toBe(200);
    await response.text();
    const tools = aiMocks.streamText.mock.calls[0][0].tools;
    expectToolInputToParse(tools.addWorkExperience, { company: "星河科技", content: "" });
    expectToolInputToParse(tools.addEducation, { school: "浙江大学", highlights: "" });
    expectToolInputToParse(tools.addProject, { name: "简历助手", content: "" });
    expectToolInputToParse(tools.addResearch, { name: "检索增强研究", content: "" });
    expectToolInputToParse(tools.addCustomSection, { title: "其他", content: "" });
    expectToolInputToParse(tools.writeSkillsSection, { content: "" });
    expectToolInputToParse(tools.writePersonalSummarySection, { content: "" });
    expectToolInputToParse(tools.writeAwardsSection, { content: "" });
    expectToolInputToParse(tools.writePortfolioSection, { content: "" });
  });

  it("exposes semantic block tools for repeatable resume sections", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");
    aiMocks.streamText.mockImplementation((options: {
      tools: {
        updateWorkExperienceBlock: {
          execute: (input: unknown, options: { toolCallId: string }) => Promise<unknown>;
        };
        updateEducationBlock: {
          execute: (input: unknown, options: { toolCallId: string }) => Promise<unknown>;
        };
        updateProjectBlock: {
          execute: (input: unknown, options: { toolCallId: string }) => Promise<unknown>;
        };
        updateResearchBlock: {
          execute: (input: unknown, options: { toolCallId: string }) => Promise<unknown>;
        };
      };
    }) => ({
      fullStream: (async function* () {
        await options.tools.updateWorkExperienceBlock.execute(
          {
            index: 0,
            company: "字节跳动",
            title: "前端工程师",
            location: "北京",
            content: "主导增长平台搭建。",
            beforePlainText: "旧公司 / 前端",
          },
          { toolCallId: "tool_exp_block_1" },
        );
        yield {
          type: "tool-result",
          toolCallId: "tool_exp_block_1",
          toolName: "updateWorkExperienceBlock",
          input: { index: 0, company: "字节跳动", title: "前端工程师" },
          output: { success: true },
        };
        await options.tools.updateEducationBlock.execute(
          { index: 0, school: "清华大学", degree: "本科", beforePlainText: "旧学校" },
          { toolCallId: "tool_edu_block_1" },
        );
        yield {
          type: "tool-result",
          toolCallId: "tool_edu_block_1",
          toolName: "updateEducationBlock",
          input: { index: 0, school: "清华大学", degree: "本科" },
          output: { success: true },
        };
        await options.tools.updateProjectBlock.execute(
          {
            index: 0,
            name: "简历助手",
            stack: ["React", "TypeScript"],
            content: "主导简历编辑器性能优化，首屏耗时下降 32%。",
          },
          { toolCallId: "tool_project_block_1" },
        );
        yield {
          type: "tool-result",
          toolCallId: "tool_project_block_1",
          toolName: "updateProjectBlock",
          input: { index: 0, name: "简历助手", stack: ["React", "TypeScript"] },
          output: { success: true },
        };
        await options.tools.updateResearchBlock.execute(
          { index: 0, name: "LLM 简历生成", paperTitle: "LLM 简历生成评测" },
          { toolCallId: "tool_research_block_1" },
        );
        yield {
          type: "tool-result",
          toolCallId: "tool_research_block_1",
          toolName: "updateResearchBlock",
          input: { index: 0, name: "LLM 简历生成", paperTitle: "LLM 简历生成评测" },
          output: { success: true },
        };
      })(),
    }));

    const response = await POST(jsonRequest(validBody()));

    expect(response.status).toBe(200);
    expect(aiMocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.objectContaining({
          updateWorkExperienceBlock: expect.any(Object),
          updateEducationBlock: expect.any(Object),
          updateProjectBlock: expect.any(Object),
          updateResearchBlock: expect.any(Object),
        }),
      }),
    );
    const streamArgs = aiMocks.streamText.mock.calls[0][0];
    expect(streamArgs.tools).not.toHaveProperty("setWorkExperienceCompany");
    expect(streamArgs.tools).not.toHaveProperty("setEducationSchool");
    expect(streamArgs.tools).not.toHaveProperty("setProjectTechStack");
    expect(streamArgs.tools).not.toHaveProperty("setResearchPaperTitle");
    expect(streamArgs.tools).not.toHaveProperty("writeWorkExperienceContent");
    expect(streamArgs.tools).not.toHaveProperty("writeEducationHighlights");
    expect(streamArgs.tools).not.toHaveProperty("writeProjectContent");
    expect(streamArgs.tools).not.toHaveProperty("writeResearchContent");
    const events = await readSseEvents(response);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool-call-result",
          toolCall: expect.objectContaining({
            id: "tool_exp_block_1",
            name: "updateWorkExperienceBlock",
          }),
          operations: [
            expect.objectContaining({
              id: "floating_tool_exp_block_1",
              section: "experience",
              fieldPath: "experience.0",
              afterPlainText: "主导增长平台搭建。",
              replacementValue: expect.objectContaining({
                company: "字节跳动",
                title: "前端工程师",
                location: "北京",
              }),
            }),
          ],
        }),
        expect.objectContaining({
          type: "tool-call-result",
          toolCall: expect.objectContaining({
            id: "tool_edu_block_1",
            name: "updateEducationBlock",
          }),
          operations: [
            expect.objectContaining({
              id: "floating_tool_edu_block_1",
              section: "education",
              fieldPath: "education.0",
              replacementValue: expect.objectContaining({
                school: "清华大学",
                degree: "本科",
              }),
            }),
          ],
        }),
        expect.objectContaining({
          type: "tool-call-result",
          toolCall: expect.objectContaining({
            id: "tool_project_block_1",
            name: "updateProjectBlock",
          }),
          operations: [
            expect.objectContaining({
              id: "floating_tool_project_block_1",
              section: "projects",
              fieldPath: "projects.0",
              replacementValue: expect.objectContaining({
                name: "简历助手",
                stack: ["React", "TypeScript"],
              }),
              afterPlainText: "主导简历编辑器性能优化，首屏耗时下降 32%。",
            }),
          ],
        }),
        expect.objectContaining({
          type: "tool-call-result",
          toolCall: expect.objectContaining({
            id: "tool_research_block_1",
            name: "updateResearchBlock",
          }),
          operations: [
            expect.objectContaining({
              id: "floating_tool_research_block_1",
              section: "research",
              fieldPath: "research.0",
              replacementValue: expect.objectContaining({
                name: "LLM 简历生成",
                paperTitle: "LLM 简历生成评测",
              }),
            }),
          ],
        }),
      ]),
    );
  });

  it("exposes semantic delete, item reorder, and module structure tools", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");
    aiMocks.streamText.mockImplementation((options: {
      tools: {
        deleteProject: {
          execute: (input: unknown, options: { toolCallId: string }) => Promise<unknown>;
        };
        reorderWorkExperiences: {
          execute: (input: unknown, options: { toolCallId: string }) => Promise<unknown>;
        };
        hideResumeModule: {
          execute: (input: unknown, options: { toolCallId: string }) => Promise<unknown>;
        };
        reorderResumeModules: {
          execute: (input: unknown, options: { toolCallId: string }) => Promise<unknown>;
        };
        deleteWorkExperience: unknown;
        deleteEducation: unknown;
        deleteResearch: unknown;
        reorderEducation: unknown;
        reorderProjects: unknown;
        reorderResearch: unknown;
        showResumeModule: {
          execute: (input: unknown, options: { toolCallId: string }) => Promise<unknown>;
        };
      };
    }) => ({
      fullStream: (async function* () {
        await options.tools.deleteProject.execute(
          { index: 1, beforePlainText: "旧项目" },
          { toolCallId: "tool_delete_project_1" },
        );
        yield {
          type: "tool-result",
          toolCallId: "tool_delete_project_1",
          toolName: "deleteProject",
          input: { index: 1 },
          output: { success: true },
        };
        await options.tools.reorderWorkExperiences.execute(
          { itemOrder: [1, 0] },
          { toolCallId: "tool_reorder_exp_1" },
        );
        yield {
          type: "tool-result",
          toolCallId: "tool_reorder_exp_1",
          toolName: "reorderWorkExperiences",
          input: { itemOrder: [1, 0] },
          output: { success: true },
        };
        await options.tools.hideResumeModule.execute(
          { moduleKey: "projects" },
          { toolCallId: "tool_hide_module_1" },
        );
        yield {
          type: "tool-result",
          toolCallId: "tool_hide_module_1",
          toolName: "hideResumeModule",
          input: { moduleKey: "projects" },
          output: { success: true },
        };
        await options.tools.showResumeModule.execute(
          { moduleKey: "projects", position: 2 },
          { toolCallId: "tool_show_module_1" },
        );
        yield {
          type: "tool-result",
          toolCallId: "tool_show_module_1",
          toolName: "showResumeModule",
          input: { moduleKey: "projects", position: 2 },
          output: { success: true },
        };
        await options.tools.reorderResumeModules.execute(
          { sectionOrder: ["basics", "skills", "experience"] },
          { toolCallId: "tool_reorder_modules_1" },
        );
        yield {
          type: "tool-result",
          toolCallId: "tool_reorder_modules_1",
          toolName: "reorderResumeModules",
          input: { sectionOrder: ["basics", "skills", "experience"] },
          output: { success: true },
        };
      })(),
    }));

    const response = await POST(
      jsonRequest({
        ...validBody(),
        context: {
          ...validBody().context,
          sectionOrder: ["basics", "experience", "education", "skills"],
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(aiMocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.objectContaining({
          deleteWorkExperience: expect.any(Object),
          deleteEducation: expect.any(Object),
          deleteProject: expect.any(Object),
          deleteResearch: expect.any(Object),
          reorderWorkExperiences: expect.any(Object),
          reorderEducation: expect.any(Object),
          reorderProjects: expect.any(Object),
          reorderResearch: expect.any(Object),
          hideResumeModule: expect.any(Object),
          showResumeModule: expect.any(Object),
          reorderResumeModules: expect.any(Object),
        }),
      }),
    );
    const events = await readSseEvents(response);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool-call-result",
          toolCall: expect.objectContaining({ name: "deleteProject" }),
          operations: [
            expect.objectContaining({
              operation: "delete_section",
              section: "projects",
              fieldPath: "projects.1",
            }),
          ],
        }),
        expect.objectContaining({
          type: "tool-call-result",
          toolCall: expect.objectContaining({ name: "reorderWorkExperiences" }),
          operations: [
            expect.objectContaining({
              operation: "reorder_items",
              section: "experience",
              fieldPath: "experience",
              itemOrder: [1, 0],
            }),
          ],
        }),
        expect.objectContaining({
          type: "tool-call-result",
          toolCall: expect.objectContaining({ name: "hideResumeModule" }),
          operations: [
            expect.objectContaining({
              operation: "delete_section",
              fieldPath: "projects",
            }),
          ],
        }),
        expect.objectContaining({
          type: "tool-call-result",
          toolCall: expect.objectContaining({ name: "showResumeModule" }),
          operations: [
            expect.objectContaining({
              operation: "reorder_sections",
              fieldPath: "sectionOrder",
              sectionOrder: ["basics", "experience", "projects", "education", "skills"],
            }),
          ],
        }),
        expect.objectContaining({
          type: "tool-call-result",
          toolCall: expect.objectContaining({ name: "reorderResumeModules" }),
          operations: [
            expect.objectContaining({
              operation: "reorder_sections",
              sectionOrder: ["basics", "skills", "experience"],
            }),
          ],
        }),
      ]),
    );
  });

  it("normalizes floating rich-text HTML tool input into TipTap operations", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");
    aiMocks.streamText.mockImplementation((options: {
      tools: {
        updateProjectBlock: {
          execute: (input: unknown, options: { toolCallId: string }) => Promise<unknown>;
        };
      };
    }) => ({
      fullStream: (async function* () {
        await options.tools.updateProjectBlock.execute(
          {
            index: 0,
            name: "前端监控埋点平台",
            content:
              "<p><strong>项目描述：</strong>埋点监控系统</p><ul><li>支持 PV、UV 与错误捕获</li></ul>",
            changeSummary: "更新项目经历。",
          },
          { toolCallId: "tool_project_html_1" },
        );
        yield {
          type: "tool-result",
          toolCallId: "tool_project_html_1",
          toolName: "updateProjectBlock",
          input: { index: 0 },
          output: { success: true },
        };
      })(),
    }));

    const response = await POST(jsonRequest(validBody()));

    expect(response.status).toBe(200);
    const events = await readSseEvents(response);
    const operations = events.flatMap((event) =>
      Array.isArray((event as { operations?: unknown }).operations)
        ? ((event as { operations: unknown[] }).operations)
        : [],
    );
    const operation = operations.find(
      (candidate) =>
        (candidate as { fieldPath?: unknown }).fieldPath === "projects.0",
    ) as {
      afterPlainText?: string;
      replacementValue?: { content?: string };
      replacementTiptapJson?: unknown;
    };

    expect(operation.afterPlainText).toContain("项目描述：埋点监控系统");
    expect(operation.afterPlainText).toContain("支持 PV、UV 与错误捕获");
    expect(operation.afterPlainText).not.toMatch(/<\/?[a-z][^>]*>/i);
    expect(operation.replacementValue?.content).toBe(operation.afterPlainText);
    expect(JSON.stringify(operation.replacementTiptapJson)).toContain("bulletList");
    expect(JSON.stringify(operation.replacementTiptapJson)).toContain("\"type\":\"bold\"");
    expect(JSON.stringify(operation.replacementTiptapJson)).not.toMatch(/<\/?[a-z][^>]*>/i);
  });

  it("exposes semantic singleton rich-text section tools", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");
    aiMocks.streamText.mockImplementation((options: {
      tools: {
        writeSkillsSection: {
          execute: (input: unknown, options: { toolCallId: string }) => Promise<unknown>;
        };
        writeAwardsSection: {
          execute: (input: unknown, options: { toolCallId: string }) => Promise<unknown>;
        };
        writePersonalSummarySection: unknown;
        writePortfolioSection: unknown;
      };
    }) => ({
      fullStream: (async function* () {
        await options.tools.writeSkillsSection.execute(
          {
            content: "TypeScript、React、性能优化",
            beforePlainText: "React",
          },
          { toolCallId: "tool_skills_1" },
        );
        yield {
          type: "tool-result",
          toolCallId: "tool_skills_1",
          toolName: "writeSkillsSection",
          input: { content: "TypeScript、React、性能优化" },
          output: { success: true },
        };
        await options.tools.writeAwardsSection.execute(
          {
            content: "ACM 区域赛银奖",
            beforePlainText: "",
          },
          { toolCallId: "tool_awards_1" },
        );
        yield {
          type: "tool-result",
          toolCallId: "tool_awards_1",
          toolName: "writeAwardsSection",
          input: { content: "ACM 区域赛银奖" },
          output: { success: true },
        };
      })(),
    }));

    const response = await POST(jsonRequest(validBody()));

    expect(response.status).toBe(200);
    expect(aiMocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.objectContaining({
          writeSkillsSection: expect.any(Object),
          writePersonalSummarySection: expect.any(Object),
          writeAwardsSection: expect.any(Object),
          writePortfolioSection: expect.any(Object),
        }),
      }),
    );
    const events = await readSseEvents(response);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool-call-result",
          toolCall: expect.objectContaining({ name: "writeSkillsSection" }),
          operations: [
            expect.objectContaining({
              section: "skills",
              fieldPath: "skills",
              afterPlainText: "TypeScript、React、性能优化",
            }),
          ],
        }),
        expect.objectContaining({
          type: "tool-call-result",
          toolCall: expect.objectContaining({ name: "writeAwardsSection" }),
          operations: [
            expect.objectContaining({
              section: "awards",
              fieldPath: "awards",
              afterPlainText: "ACM 区域赛银奖",
            }),
          ],
        }),
      ]),
    );
  });

  it("exposes semantic custom section tools", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");
    aiMocks.streamText.mockImplementation((options: {
      tools: {
        addCustomSection: {
          execute: (input: unknown, options: { toolCallId: string }) => Promise<unknown>;
        };
        updateCustomSectionBlock: {
          execute: (input: unknown, options: { toolCallId: string }) => Promise<unknown>;
        };
        deleteCustomSection: {
          execute: (input: unknown, options: { toolCallId: string }) => Promise<unknown>;
        };
        reorderCustomSections: {
          execute: (input: unknown, options: { toolCallId: string }) => Promise<unknown>;
        };
      };
    }) => ({
      fullStream: (async function* () {
        await options.tools.addCustomSection.execute(
          { title: "开源贡献", content: "维护 3 个开源项目。" },
          { toolCallId: "tool_custom_add_1" },
        );
        yield {
          type: "tool-result",
          toolCallId: "tool_custom_add_1",
          toolName: "addCustomSection",
          input: { title: "开源贡献" },
          output: { success: true },
        };
        await options.tools.updateCustomSectionBlock.execute(
          {
            sectionId: "custom_1",
            title: "开源贡献",
            content: "维护 3 个开源项目。",
          },
          { toolCallId: "tool_custom_update_1" },
        );
        yield {
          type: "tool-result",
          toolCallId: "tool_custom_update_1",
          toolName: "updateCustomSectionBlock",
          input: { sectionId: "custom_1" },
          output: { success: true },
        };
        await options.tools.deleteCustomSection.execute(
          { sectionId: "custom_1" },
          { toolCallId: "tool_custom_delete_1" },
        );
        yield {
          type: "tool-result",
          toolCallId: "tool_custom_delete_1",
          toolName: "deleteCustomSection",
          input: { sectionId: "custom_1" },
          output: { success: true },
        };
        await options.tools.reorderCustomSections.execute(
          { itemOrder: ["custom_2", "custom_1"] },
          { toolCallId: "tool_custom_reorder_1" },
        );
        yield {
          type: "tool-result",
          toolCallId: "tool_custom_reorder_1",
          toolName: "reorderCustomSections",
          input: { itemOrder: ["custom_2", "custom_1"] },
          output: { success: true },
        };
      })(),
    }));

    const response = await POST(jsonRequest(validBody()));

    expect(response.status).toBe(200);
    expect(aiMocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.objectContaining({
          addCustomSection: expect.any(Object),
          updateCustomSectionBlock: expect.any(Object),
          deleteCustomSection: expect.any(Object),
          reorderCustomSections: expect.any(Object),
        }),
      }),
    );
    const streamArgs = aiMocks.streamText.mock.calls[0][0];
    expect(streamArgs.tools).not.toHaveProperty("renameCustomSection");
    expect(streamArgs.tools).not.toHaveProperty("writeCustomSectionContent");
    const events = await readSseEvents(response);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool-call-result",
          toolCall: expect.objectContaining({ name: "addCustomSection" }),
          operations: [
            expect.objectContaining({
              operation: "insert_section",
              fieldPath: "custom.0",
              replacementValue: { title: "开源贡献" },
              afterPlainText: "维护 3 个开源项目。",
            }),
          ],
        }),
        expect.objectContaining({
          type: "tool-call-result",
          toolCall: expect.objectContaining({ name: "updateCustomSectionBlock" }),
          operations: [
            expect.objectContaining({
              operation: "update_section",
              fieldPath: "custom.custom_1",
              replacementValue: expect.objectContaining({
                title: "开源贡献",
                content: "维护 3 个开源项目。",
              }),
              afterPlainText: "维护 3 个开源项目。",
            }),
          ],
        }),
        expect.objectContaining({
          type: "tool-call-result",
          toolCall: expect.objectContaining({ name: "deleteCustomSection" }),
          operations: [
            expect.objectContaining({
              operation: "delete_section",
              fieldPath: "custom.custom_1",
            }),
          ],
        }),
        expect.objectContaining({
          type: "tool-call-result",
          toolCall: expect.objectContaining({ name: "reorderCustomSections" }),
          operations: [
            expect.objectContaining({
              operation: "reorder_items",
              section: "custom",
              fieldPath: "custom",
              itemOrder: ["custom_2", "custom_1"],
            }),
          ],
        }),
      ]),
    );
  });

  it("exposes semantic add item tools for repeatable resume sections", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");
    aiMocks.streamText.mockImplementation((options: {
      tools: {
        addWorkExperience: {
          execute: (input: unknown, options: { toolCallId: string }) => Promise<unknown>;
        };
        addEducation: {
          execute: (input: unknown, options: { toolCallId: string }) => Promise<unknown>;
        };
        addProject: {
          execute: (input: unknown, options: { toolCallId: string }) => Promise<unknown>;
        };
        addResearch: {
          execute: (input: unknown, options: { toolCallId: string }) => Promise<unknown>;
        };
      };
    }) => ({
      fullStream: (async function* () {
        await options.tools.addWorkExperience.execute(
          {
            company: "字节跳动",
            title: "前端工程师",
            content: "负责核心链路性能优化。",
          },
          { toolCallId: "tool_add_exp_1" },
        );
        yield {
          type: "tool-result",
          toolCallId: "tool_add_exp_1",
          toolName: "addWorkExperience",
          input: { company: "字节跳动" },
          output: { success: true },
        };
        await options.tools.addEducation.execute(
          {
            school: "浙江大学",
            degree: "本科",
            highlights: "GPA 3.8 / 4.0。",
          },
          { toolCallId: "tool_add_edu_1" },
        );
        yield {
          type: "tool-result",
          toolCallId: "tool_add_edu_1",
          toolName: "addEducation",
          input: { school: "浙江大学" },
          output: { success: true },
        };
        await options.tools.addProject.execute(
          {
            name: "智能简历助手",
            role: "负责人",
            stack: ["React", "Next.js"],
            content: "搭建流式对话和简历修改工具。",
          },
          { toolCallId: "tool_add_project_1" },
        );
        yield {
          type: "tool-result",
          toolCallId: "tool_add_project_1",
          toolName: "addProject",
          input: { name: "智能简历助手" },
          output: { success: true },
        };
        await options.tools.addResearch.execute(
          {
            name: "LLM 简历生成研究",
            paperTitle: "Resume Agents",
            content: "分析工具调用可靠性。",
          },
          { toolCallId: "tool_add_research_1" },
        );
        yield {
          type: "tool-result",
          toolCallId: "tool_add_research_1",
          toolName: "addResearch",
          input: { name: "LLM 简历生成研究" },
          output: { success: true },
        };
      })(),
    }));

    const response = await POST(jsonRequest(validBody()));

    expect(response.status).toBe(200);
    expect(aiMocks.streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.objectContaining({
          addWorkExperience: expect.any(Object),
          addEducation: expect.any(Object),
          addProject: expect.any(Object),
          addResearch: expect.any(Object),
        }),
      }),
    );
    const events = await readSseEvents(response);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool-call-result",
          toolCall: expect.objectContaining({ name: "addWorkExperience" }),
          operations: [
            expect.objectContaining({
              operation: "insert_section",
              section: "experience",
              fieldPath: "experience.0",
              replacementValue: expect.objectContaining({
                company: "字节跳动",
                title: "前端工程师",
              }),
              afterPlainText: "负责核心链路性能优化。",
            }),
          ],
        }),
        expect.objectContaining({
          type: "tool-call-result",
          toolCall: expect.objectContaining({ name: "addEducation" }),
          operations: [
            expect.objectContaining({
              operation: "insert_section",
              section: "education",
              fieldPath: "education.0",
              replacementValue: expect.objectContaining({
                school: "浙江大学",
                degree: "本科",
              }),
              afterPlainText: "GPA 3.8 / 4.0。",
            }),
          ],
        }),
        expect.objectContaining({
          type: "tool-call-result",
          toolCall: expect.objectContaining({ name: "addProject" }),
          operations: [
            expect.objectContaining({
              operation: "insert_section",
              section: "projects",
              fieldPath: "projects.0",
              replacementValue: expect.objectContaining({
                name: "智能简历助手",
                role: "负责人",
                stack: ["React", "Next.js"],
              }),
              afterPlainText: "搭建流式对话和简历修改工具。",
            }),
          ],
        }),
        expect.objectContaining({
          type: "tool-call-result",
          toolCall: expect.objectContaining({ name: "addResearch" }),
          operations: [
            expect.objectContaining({
              operation: "insert_section",
              section: "research",
              fieldPath: "research.0",
              replacementValue: expect.objectContaining({
                name: "LLM 简历生成研究",
                paperTitle: "Resume Agents",
              }),
              afterPlainText: "分析工具调用可靠性。",
            }),
          ],
        }),
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

function schemaKeys(toolDefinition: unknown): string[] {
  const schema = (toolDefinition as { inputSchema?: { def?: { shape?: unknown } } }).inputSchema;
  const shape = schema?.def?.shape;
  return shape && typeof shape === "object" ? Object.keys(shape) : [];
}

function expectToolSchemaKeys(toolDefinition: unknown, expectedKeys: string[]) {
  expect([...schemaKeys(toolDefinition)].sort()).toEqual([...expectedKeys].sort());
}

function expectToolInputToParse(toolDefinition: unknown, input: unknown) {
  const schema = (toolDefinition as {
    inputSchema?: { safeParse?: (value: unknown) => { success: boolean; error?: unknown } };
  }).inputSchema;
  const result = schema?.safeParse?.(input);
  expect(result?.success).toBe(true);
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
