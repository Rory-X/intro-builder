"use client";

import { useId, useState } from "react";
import { useFormContext } from "react-hook-form";

import { ResumeHelperDialog, type HelperState } from "@/components/agent/resume-helper-dialog";
import { Button } from "@/components/ui/button";
import { useCompletenessScore } from "@/hooks/use-completeness-score";
import {
  buildResumeHelperContext,
  type ResumeHelperContextSnapshot,
} from "@/lib/agent/resume-helper-context";
import type { ResumeHelperResponse } from "@/lib/agent/client";
import {
  readSessionAgentModelApiKey,
  readStoredAgentModelSettings,
  toAgentModelConfig,
} from "@/lib/agent/model-settings-storage";
import type { ResumeContent } from "@intro-builder/shared/schemas";

export function ResumeDiagnoseButton({ resumeId }: { resumeId: string }) {
  const form = useFormContext<ResumeContent>();
  const completeness = useCompletenessScore();
  const [state, setState] = useState<HelperState>({ status: "idle" });
  const [dialogOpen, setDialogOpen] = useState(false);
  const gradientId = `resume-diagnose-gradient-${useId().replace(/:/g, "")}`;

  async function requestDiagnosis() {
    const context = buildResumeHelperContext(form.getValues(), completeness);
    setDialogOpen(true);
    await requestResumeHelper({
      resumeId,
      path: "/api/agent/resume/helpers/resume-diagnose",
      body: {
        resumeId,
        locale: "zh-CN",
        target: { kind: "resume", section: null, fieldPath: null },
        context,
        intent: { mode: "diagnose", maxSuggestions: 5, strategy: "star" },
      },
      setState,
    });
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="gap-1.5 rounded-full border-fuchsia-300/50 bg-background/90 px-3 text-xs font-semibold shadow-sm shadow-fuchsia-500/10 hover:bg-muted/70 dark:border-fuchsia-400/40 dark:bg-muted/40"
        disabled={state.status === "loading"}
        onClick={() => void requestDiagnosis()}
      >
        <GradientSparklesIcon gradientId={gradientId} />
        <span className="bg-gradient-to-r from-sky-500 via-fuchsia-500 to-amber-400 bg-clip-text text-transparent">
          {state.status === "loading" ? "诊断中" : "AI 诊断"}
        </span>
      </Button>

      <ResumeHelperDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title="AI 简历诊断"
        state={state}
        maxWidth="2xl"
      />
    </>
  );
}

export async function requestResumeHelper({
  path,
  body,
  setState,
}: {
  resumeId: string;
  path: string;
  body: unknown;
  setState: (state: HelperState) => void;
}) {
  setState({ status: "loading" });
  try {
    /*
     * 带上当前模型配置（P05 任务 5）。
     *
     * 服务端不再回退已退役的 Agent 微服务，因此缺配置会返回
     * `model_not_configured`。这里与浮窗、润色用**同一份**来源：
     * localStorage 取 baseUrl/modelName、sessionStorage 取 apiKey，
     * 随请求传、不落库。
     */
    const requestBody = isRecord(body)
      ? { ...body, modelConfig: currentModelConfig() }
      : body;
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    const responseBody = await response.json().catch(() => null);
    if (!response.ok) {
      setState({
        status: "error",
        message: resumeHelperErrorMessage(responseBody),
      });
      return;
    }
    if (!isRecord(responseBody) || !isRecord(responseBody.result)) {
      setState({ status: "error", message: "Agent 服务返回格式异常" });
      return;
    }
    const result = responseBody.result;
    if (typeof result.summary !== "string" || !Array.isArray(result.suggestions)) {
      setState({ status: "error", message: "Agent 服务返回格式异常" });
      return;
    }
    setState({
      status: "ready",
      result: {
        summary: result.summary,
        suggestions: result.suggestions.filter(isSuggestion),
      },
    });
  } catch {
    setState({ status: "error", message: "Agent 服务暂不可用，请稍后再试" });
  }
}

export function GradientSparklesIcon({ gradientId }: { gradientId: string }) {
  return (
    <svg
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      height="24"
      stroke={`url(#${gradientId})`}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={gradientId} x1="2" x2="22" y1="2" y2="22">
          <stop offset="0%" stopColor="#0ea5e9" />
          <stop offset="52%" stopColor="#d946ef" />
          <stop offset="100%" stopColor="#f59e0b" />
        </linearGradient>
      </defs>
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
      <path d="M20 3v4" />
      <path d="M22 5h-4" />
      <path d="M4 17v2" />
      <path d="M5 18H3" />
    </svg>
  );
}

function isSuggestion(value: unknown): value is ResumeHelperResponse["result"]["suggestions"][number] {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.section === "string" &&
    typeof value.fieldPath === "string" &&
    (value.severity === "high" || value.severity === "medium" || value.severity === "low") &&
    typeof value.title === "string" &&
    typeof value.rationale === "string" &&
    typeof value.actionLabel === "string" &&
    typeof value.example === "string" &&
    Array.isArray(value.riskFlags)
  );
}

function resumeHelperErrorMessage(responseBody: unknown): string {
  if (isRecord(responseBody)) {
    const code = responseBody.code;
    if (code === "agent_timeout" || code === "provider_timeout") {
      return "AI 生成超时，请稍后重试或减少简历内容后再试";
    }
    if (typeof responseBody.error === "string") {
      return responseBody.error;
    }
  }

  return "Agent 服务暂不可用，请稍后再试";
}

/**
 * 当前模型配置（P05 任务 5）。
 *
 * 与浮窗 `toAgentModelConfig(modelSettings)` 同一来源：`readStoredAgentModelSettings()`
 * 已自动合并 sessionStorage 里的 apiKey，因此这里只需再显式取一次
 * （保留 `readSessionAgentModelApiKey` 是为了让「key 存 sessionStorage」
 * 这件事在调用点可见，而不是藏在另一个函数的实现里）。
 */
function currentModelConfig(): { baseUrl: string; apiKey: string; modelName: string } | null {
  const settings = readStoredAgentModelSettings();
  const apiKey = readSessionAgentModelApiKey();
  return toAgentModelConfig({ ...settings, apiKey });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export type { HelperState, ResumeHelperContextSnapshot };
