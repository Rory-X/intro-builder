import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SectionHelperButton } from "@/components/agent/section-helper-button";

const MODEL_SETTINGS_KEY = "intro-builder.agent.model-settings.v1";
const MODEL_API_KEY = "intro-builder.agent.model-api-key.v1";

describe("SectionHelperButton", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("requests section-next-steps suggestions for the supplied section", async () => {
    // 服务端不再回退已退役的微服务，缺配置会返回 model_not_configured。
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
          requestId: "req_section_helper",
          helperId: "section-next-steps",
          result: {
            summary: "项目经历可以进一步补充影响。",
            suggestions: [],
          },
          usage: {
            provider: "fake-provider",
            model: "fake-model",
            inputTokens: 320,
            outputTokens: 80,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <SectionHelperButton
        resumeId="resume_abc"
        section="projects"
        fieldPath="projects"
        label="项目经历"
        plainText="负责企业内部系统开发。"
        completeness={{ overall: 68, sections: [] }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "AI 建议" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/agent/resume/helpers/section-next-steps",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      resumeId: "resume_abc",
      target: { kind: "section", section: "projects", fieldPath: "projects" },
      intent: { mode: "next_steps", maxSuggestions: 3, strategy: "star" },
    });
    // 必须带上模型配置，否则服务端会拒绝（P05 任务 5）。
    expect(body.modelConfig).toMatchObject({
      baseUrl: "https://models.example.test/v1",
      modelName: "gpt-4.1-mini",
    });
    expect(await screen.findByText("项目经历可以进一步补充影响。")).toBeInTheDocument();
  });
});
