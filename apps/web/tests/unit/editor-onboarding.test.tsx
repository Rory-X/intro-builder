import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EditorOnboarding } from "@/components/editor/editor-onboarding";
import {
  AGENT_MODEL_API_KEY_SESSION_STORAGE_KEY,
  AGENT_MODEL_SETTINGS_STORAGE_KEY,
} from "@/lib/agent/model-settings-storage";
import { editorOnboardingStorageKey } from "@/lib/editor-onboarding-storage";

describe("EditorOnboarding", () => {
  afterEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("opens with BYOK as the first mission for a user's first editor visit", async () => {
    const onVisibilityChange = vi.fn();

    render(
      <EditorOnboarding
        userId="user-a"
        restartToken={0}
        onVisibilityChange={onVisibilityChange}
      />,
    );

    expect(
      await screen.findByRole("region", { name: "编辑器新手引导" }),
    ).toBeInTheDocument();
    expect(screen.getByText("连接 Agent 模型")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "配置 BYOK" }),
    ).toBeInTheDocument();
    expect(onVisibilityChange).toHaveBeenLastCalledWith(true);
  });

  it("shows onboarding when its stored outcome is corrupt", async () => {
    window.localStorage.setItem(editorOnboardingStorageKey("user-a"), "not-json");

    render(
      <EditorOnboarding
        userId="user-a"
        restartToken={0}
        onVisibilityChange={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole("region", { name: "编辑器新手引导" }),
    ).toBeInTheDocument();
  });

  it("unlocks later missions only after complete BYOK settings are saved", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <EditorOnboarding
        userId="user-a"
        restartToken={0}
        onVisibilityChange={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "编辑内容" }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "配置 BYOK" }));
    expect(
      screen.getByRole("dialog", { name: "连接 Agent 模型" }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("模型服务地址"), {
      target: { value: "https://api.example.com/v1" },
    });
    fireEvent.change(screen.getByLabelText("访问密钥"), {
      target: { value: "test-key" },
    });
    fireEvent.change(screen.getByLabelText("模型名称"), {
      target: { value: "example-model" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(screen.getByText("已连接")).toBeInTheDocument();
    });
    expect(
      screen.getByText("api.example.com · example-model"),
    ).toBeInTheDocument();
    expect(screen.queryByText("test-key")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑内容" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "开始认识编辑器" }),
    ).toBeEnabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps later missions locked when incomplete BYOK settings are saved", async () => {
    render(
      <EditorOnboarding
        userId="user-a"
        restartToken={0}
        onVisibilityChange={vi.fn()}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "配置 BYOK" }),
    );
    fireEvent.change(screen.getByLabelText("模型服务地址"), {
      target: { value: "https://api.example.com/v1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(
      await screen.findByText("请填写服务地址、访问密钥和模型名称"),
    ).toBeInTheDocument();
    expect(screen.getByText("未连接")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑内容" })).toBeDisabled();
  });

  it("moves the active explanation and focus between real editor targets", async () => {
    window.localStorage.setItem(
      AGENT_MODEL_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        baseUrl: "https://api.example.com/v1",
        modelName: "example-model",
      }),
    );
    window.sessionStorage.setItem(
      AGENT_MODEL_API_KEY_SESSION_STORAGE_KEY,
      "test-key",
    );

    render(
      <>
        <div data-editor-onboarding-target="editor">编辑区目标</div>
        <div data-editor-onboarding-target="preview">预览区目标</div>
        <EditorOnboarding
          userId="user-a"
          restartToken={0}
          onVisibilityChange={vi.fn()}
        />
      </>,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "开始认识编辑器" }),
    );

    expect(screen.getByText("左侧填写，右侧实时看到结果")).toBeInTheDocument();
    expect(screen.getByText("编辑区目标")).toHaveAttribute(
      "data-editor-onboarding-active",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "实时预览" }));

    expect(screen.getByText("这张纸就是最终导出的样子")).toBeInTheDocument();
    expect(screen.getByText("预览区目标")).toHaveAttribute(
      "data-editor-onboarding-active",
      "true",
    );
    expect(screen.getByText("编辑区目标")).not.toHaveAttribute(
      "data-editor-onboarding-active",
    );
  });

  it("remembers dismissal for the current user without suppressing another user", async () => {
    const first = render(
      <EditorOnboarding
        userId="user-a"
        restartToken={0}
        onVisibilityChange={vi.fn()}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "以后再说" }),
    );

    expect(
      screen.queryByRole("region", { name: "编辑器新手引导" }),
    ).not.toBeInTheDocument();
    expect(
      window.localStorage.getItem(editorOnboardingStorageKey("user-a")),
    ).toContain('"outcome":"dismissed"');

    first.unmount();
    const sameUser = render(
      <EditorOnboarding
        userId="user-a"
        restartToken={0}
        onVisibilityChange={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(
        screen.queryByRole("region", { name: "编辑器新手引导" }),
      ).not.toBeInTheDocument();
    });

    sameUser.unmount();
    render(
      <EditorOnboarding
        userId="user-b"
        restartToken={0}
        onVisibilityChange={vi.fn()}
      />,
    );
    expect(
      await screen.findByRole("region", { name: "编辑器新手引导" }),
    ).toBeInTheDocument();
  });

  it("records completion and reopens when the user explicitly restarts the guide", async () => {
    window.localStorage.setItem(
      AGENT_MODEL_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        baseUrl: "https://api.example.com/v1",
        modelName: "example-model",
      }),
    );
    window.sessionStorage.setItem(
      AGENT_MODEL_API_KEY_SESSION_STORAGE_KEY,
      "test-key",
    );

    const view = render(
      <EditorOnboarding
        userId="user-a"
        restartToken={0}
        onVisibilityChange={vi.fn()}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "开始认识编辑器" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "认识 Agent" }));
    fireEvent.click(screen.getByRole("button", { name: "完成上手" }));

    expect(
      screen.queryByRole("region", { name: "编辑器新手引导" }),
    ).not.toBeInTheDocument();
    expect(
      window.localStorage.getItem(editorOnboardingStorageKey("user-a")),
    ).toContain('"outcome":"completed"');

    view.rerender(
      <EditorOnboarding
        userId="user-a"
        restartToken={1}
        onVisibilityChange={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole("region", { name: "编辑器新手引导" }),
    ).toBeInTheDocument();
    expect(screen.getByText("已连接")).toBeInTheDocument();
  });
});
