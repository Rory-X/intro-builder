"use client";

import { useEffect, useRef, useState } from "react";

import { ModelSettingsDialog } from "@/components/agent/model-settings-dialog";
import { Button } from "@/components/ui/button";
import {
  emptyAgentModelSettings,
  isAgentModelConfigured,
  readStoredAgentModelSettings,
  type AgentModelSettingsForm,
} from "@/lib/agent/model-settings-storage";
import {
  readEditorOnboardingOutcome,
  storeEditorOnboardingOutcome,
} from "@/lib/editor-onboarding-storage";

type EditorOnboardingProps = {
  userId: string;
  restartToken: number;
  onVisibilityChange: (visible: boolean) => void;
};

const MISSIONS = [
  {
    label: "连接模型",
    ariaLabel: "连接 Agent 模型",
    title: "连接 Agent 模型",
    body: "先配置 BYOK，再体验对话 Agent。访问密钥只保存在当前浏览器会话。",
    target: null,
  },
  {
    label: "编辑内容",
    ariaLabel: "编辑内容",
    title: "左侧填写，右侧实时看到结果",
    body: "从姓名或求职方向开始。输入会自动保存，不需要寻找保存按钮。",
    target: "editor",
  },
  {
    label: "实时预览",
    ariaLabel: "实时预览",
    title: "这张纸就是最终导出的样子",
    body: "模板、排版和分页变化会直接出现在 A4 预览中。",
    target: "preview",
  },
  {
    label: "排版与安全",
    ariaLabel: "排版与安全",
    title: "放心试排版，随时可以撤销或恢复",
    body: "模板、排版、撤销、重做和版本记录都集中在编辑器顶栏。",
    target: "toolbar",
  },
  {
    label: "AI 辅助",
    ariaLabel: "AI 辅助",
    title: "AI 辅助适合处理一个段落或模块",
    body: "先查看建议和差异，再决定是否应用；原文不会被静默覆盖。",
    target: "ai",
  },
  {
    label: "认识 Agent",
    ariaLabel: "认识 Agent",
    title: "Agent 适合跨模块的完整任务",
    body: "可以诊断整份简历、连续补充信息并展示执行过程和确认节点。",
    target: "agent",
  },
] as const;

const ACTIVE_TARGET_CLASS = "editor-onboarding-target-active";

function modelSettingsSummary(settings: AgentModelSettingsForm): string | null {
  if (!isAgentModelConfigured(settings)) return null;
  let host = settings.baseUrl;
  try {
    host = new URL(settings.baseUrl).host;
  } catch {
    // Keep the normalized service address when it is not an absolute URL.
  }
  return `${host} · ${settings.modelName}`;
}

export function EditorOnboarding({
  userId,
  restartToken,
  onVisibilityChange,
}: EditorOnboardingProps) {
  const previousRestartTokenRef = useRef(restartToken);
  const [hydrated, setHydrated] = useState(false);
  const [visible, setVisible] = useState(false);
  const [activeMission, setActiveMission] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [settings, setSettings] = useState<AgentModelSettingsForm>(() =>
    emptyAgentModelSettings(),
  );
  const configured = isAgentModelConfigured(settings);
  const settingsSummary = modelSettingsSummary(settings);

  function dismissOnboarding() {
    storeEditorOnboardingOutcome(userId, "dismissed");
    setVisible(false);
    setActiveMission(0);
  }

  function completeOnboarding() {
    storeEditorOnboardingOutcome(userId, "completed");
    setVisible(false);
    setActiveMission(0);
  }

  function handleSettingsSave(nextSettings: AgentModelSettingsForm) {
    setSettings(nextSettings);
    setSettingsMessage(
      isAgentModelConfigured(nextSettings)
        ? null
        : "请填写服务地址、访问密钥和模型名称",
    );
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setVisible(readEditorOnboardingOutcome(userId) === null);
      setSettings(readStoredAgentModelSettings());
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [userId]);

  useEffect(() => {
    if (restartToken === previousRestartTokenRef.current) return;
    previousRestartTokenRef.current = restartToken;
    const timer = window.setTimeout(() => {
      setSettings(readStoredAgentModelSettings());
      setActiveMission(0);
      setVisible(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [restartToken]);

  useEffect(() => {
    if (!hydrated) return;
    onVisibilityChange(visible);
  }, [hydrated, onVisibilityChange, visible]);

  useEffect(() => {
    const clearActiveTargets = () => {
      document
        .querySelectorAll<HTMLElement>("[data-editor-onboarding-active]")
        .forEach((element) => {
          element.removeAttribute("data-editor-onboarding-active");
          element.classList.remove(ACTIVE_TARGET_CLASS);
        });
    };

    clearActiveTargets();
    const targetName = MISSIONS[activeMission].target;
    if (!visible || !targetName) return clearActiveTargets;

    const target = document.querySelector<HTMLElement>(
      `[data-editor-onboarding-target="${targetName}"]`,
    );
    if (!target) return clearActiveTargets;

    target.setAttribute("data-editor-onboarding-active", "true");
    target.classList.add(ACTIVE_TARGET_CLASS);
    target.scrollIntoView?.({ block: "center", inline: "nearest" });
    return clearActiveTargets;
  }, [activeMission, visible]);

  if (!hydrated || !visible) return null;

  const mission = MISSIONS[activeMission];
  const isLastMission = activeMission === MISSIONS.length - 1;

  return (
    <section
      role="region"
      aria-label="编辑器新手引导"
      className="border-b border-border bg-background px-4 py-2 shadow-sm"
    >
      <div className="grid min-h-16 grid-cols-[minmax(14rem,20rem)_1fr_auto] items-center gap-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{mission.title}</p>
          <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {mission.body}
          </p>
          {activeMission === 0 && settingsMessage ? (
            <p className="mt-1 text-xs text-destructive">{settingsMessage}</p>
          ) : null}
          {activeMission === 0 && settingsSummary ? (
            <p className="mt-1 truncate text-xs font-medium text-emerald-600 dark:text-emerald-400">
              {settingsSummary}
            </p>
          ) : null}
        </div>
        <div className="relative flex min-w-0 items-start justify-center gap-1 before:absolute before:left-[8%] before:right-[8%] before:top-3 before:h-px before:bg-border">
          {MISSIONS.map((mission, index) => (
            <button
              key={mission.ariaLabel}
              type="button"
              aria-label={mission.ariaLabel}
              disabled={index > 0 && !configured}
              onClick={() => setActiveMission(index)}
              className="relative z-10 flex min-w-0 flex-1 flex-col items-center gap-1 rounded-md px-1 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-semibold ${
                  activeMission === index
                    ? "border-primary bg-primary text-primary-foreground"
                    : index < activeMission
                      ? "border-emerald-500 bg-background text-emerald-600 dark:text-emerald-400"
                      : "border-border bg-background"
                }`}
              >
                {index < activeMission ? "✓" : index + 1}
              </span>
              <span className="truncate">{mission.label}</span>
            </button>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={dismissOnboarding}
          >
            {activeMission === 0 ? "以后再说" : "跳过引导"}
          </Button>
          {activeMission === 0 ? (
            <>
              <span
                className={`rounded-full px-2 py-1 text-[11px] font-medium ${
                  configured
                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                }`}
              >
                {configured ? "已连接" : "未连接"}
              </span>
              {configured ? (
                <Button type="button" size="sm" onClick={() => setActiveMission(1)}>
                  开始认识编辑器
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    setSettingsMessage(null);
                    setSettingsOpen(true);
                  }}
                >
                  配置 BYOK
                </Button>
              )}
            </>
          ) : (
            <>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setActiveMission((current) => Math.max(0, current - 1))}
              >
                上一步
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  if (isLastMission) {
                    completeOnboarding();
                  } else {
                    setActiveMission((current) => current + 1);
                  }
                }}
              >
                {isLastMission ? "完成上手" : "完成这一步"}
              </Button>
            </>
          )}
        </div>
      </div>
      <ModelSettingsDialog
        settings={settings}
        onSave={handleSettingsSave}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        trigger={null}
        title="连接 Agent 模型"
        description="填写兼容 OpenAI API 的服务地址、访问密钥和模型名称。访问密钥只保存在当前浏览器会话。"
      />
    </section>
  );
}
