import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FormProvider, useForm } from "react-hook-form";

import { ResumeDiagnoseButton } from "@/components/agent/resume-diagnose-button";
import type { ResumeContent } from "@/lib/resume-schema";

describe("ResumeDiagnoseButton", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests resume-diagnose suggestions from the Web BFF", async () => {
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
    expect(await screen.findByText("整体内容完整，但工作经历缺少可验证结果。")).toBeInTheDocument();
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
    custom: [],
    sectionOrder: ["basics", "experience", "education", "projects", "skills"],
  };
}
