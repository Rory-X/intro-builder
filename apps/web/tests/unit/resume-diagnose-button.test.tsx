import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FormProvider, useForm } from "react-hook-form";

import { ResumeDiagnoseButton } from "@/components/agent/resume-diagnose-button";
import type { ResumeContent } from "@intro-builder/shared/schemas";

const MODEL_SETTINGS_KEY = "intro-builder.agent.model-settings.v1";
const MODEL_API_KEY = "intro-builder.agent.model-api-key.v1";

describe("ResumeDiagnoseButton", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("requests resume-diagnose suggestions from the Web BFF", async () => {
    /*
     * 预置模型配置。服务端已不再回退已退役的 Agent 微服务，
     * 缺配置会返回 model_not_configured —— 因此这个场景必须先有配置。
     */
    window.localStorage.setItem(
      MODEL_SETTINGS_KEY,
      JSON.stringify({ baseUrl: "https://models.example.test/v1", modelName: "gpt-4.1-mini" }),
    );
    window.sessionStorage.setItem(MODEL_API_KEY, "sk-ui-test");

    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async () => {
      return new Response(
        JSON.stringify({
          status: "ok",
          requestId: "req_helper_ui",
          helperId: "resume-diagnose",
          result: {
            summary: "整体内容完整，但工作经历缺少可验证结果。",
            suggestions: [],
          },
          usage: {
            provider: "fake-provider",
            model: "fake-model",
            inputTokens: 620,
            outputTokens: 180,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithForm(<ResumeDiagnoseButton resumeId="resume_abc" />);

    fireEvent.click(screen.getByRole("button", { name: "AI 诊断" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/agent/resume/helpers/resume-diagnose",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      resumeId: "resume_abc",
      locale: "zh-CN",
      target: { kind: "resume", section: null, fieldPath: null },
      intent: { mode: "diagnose", maxSuggestions: 5, strategy: "star" },
    });
    expect(body.context.sections[0]).toMatchObject({
      key: "summary",
      label: "个人总结",
      plainText: "3 年前端开发经验。",
    });
    /*
     * 请求必须带上模型配置（P05 任务 5）。
     *
     * 服务端已不再回退已退役的 Agent 微服务：缺 modelConfig 会直接返回
     * model_not_configured。因此这条断言是「按钮真的能用」的机械防线 ——
     * 此前没有它，改了服务端契约后调用方漏传配置也不会被发现。
     */
    expect(body.modelConfig).toMatchObject({
      baseUrl: expect.any(String),
      modelName: expect.any(String),
    });
    expect(await screen.findByText("整体内容完整，但工作经历缺少可验证结果。")).toBeInTheDocument();
  });

  it("shows an actionable timeout message when diagnosis generation times out", async () => {
    const fetchMock = vi.fn<
      (...args: [RequestInfo | URL, RequestInit?]) => Promise<Response>
    >(async () => {
      return new Response(
        JSON.stringify({
          error: "Agent 服务暂不可用",
          code: "agent_timeout",
          requestId: "req_timeout",
        }),
        { status: 504, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithForm(<ResumeDiagnoseButton resumeId="resume_abc" />);

    fireEvent.click(screen.getByRole("button", { name: "AI 诊断" }));

    expect(
      await screen.findByText("AI 生成超时，请稍后重试或减少简历内容后再试"),
    ).toBeInTheDocument();
  });
});

function renderWithForm(ui: React.ReactNode) {
  function Wrapper() {
    const form = useForm<ResumeContent>({
      defaultValues: validContent(),
    });
    return <FormProvider {...form}>{ui}</FormProvider>;
  }

  return render(<Wrapper />);
}

function validContent(): ResumeContent {
  return {
    basics: {
      name: "张三",
      status: "",
      title: "前端开发工程师",
      email: "zhangsan@example.com",
      phone: "13800000000",
      location: "上海",
      website: "",
      summary: "3 年前端开发经验。",
      photo: "",
    },
    experience: [],
    education: [],
    projects: [],
    research: [],
    skills: { type: "doc", content: [] },
    summary: { type: "doc", content: [] },
    awards: { type: "doc", content: [] },
    portfolio: { type: "doc", content: [] },
    custom: [],
    sectionOrder: ["basics", "experience", "education", "projects", "skills"],
  };
}
