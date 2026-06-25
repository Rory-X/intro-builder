"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { Bot, Eye, EyeOff, RefreshCw, Settings } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  emptyAgentModelSettings,
  isAgentModelConfigured,
  normalizeAgentModelSettings,
  readStoredAgentModelSettings,
  storeAgentModelSettings,
  type AgentModelSettingsForm,
} from "@/lib/agent/model-settings-storage";

type ModelOption = {
  id: string;
  label: string;
};

type ModelSettingsDialogProps = {
  settings: AgentModelSettingsForm;
  onSave: (settings: AgentModelSettingsForm) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactElement | null;
  title?: string;
  description?: string;
};

export function ModelSettingsDialog({
  settings,
  onSave,
  open,
  onOpenChange,
  trigger,
  title = "模型设置",
  description = "为当前浏览器设置本地模型偏好。访问密钥只会随本次对话请求发送。",
}: ModelSettingsDialogProps) {
  const baseId = useId();
  const [internalOpen, setInternalOpen] = useState(false);
  const [draft, setDraft] = useState<AgentModelSettingsForm>(settings);
  const [showApiKey, setShowApiKey] = useState(false);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [modelFetchError, setModelFetchError] = useState<string | null>(null);
  const wasOpenRef = useRef(false);
  const isControlled = open !== undefined;
  const actualOpen = isControlled ? open : internalOpen;
  const canFetchModels = Boolean(draft.baseUrl.trim() && draft.apiKey.trim());
  const baseUrlId = `${baseId}-base-url`;
  const apiKeyId = `${baseId}-api-key`;
  const modelNameId = `${baseId}-model-name`;
  const modelSelectId = `${baseId}-model-select`;
  const triggerNode =
    trigger === undefined && !isControlled ? (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="模型设置"
      >
        <Settings className="h-4 w-4" />
      </Button>
    ) : (
      trigger
    );

  const setDialogOpen = useCallback(
    (nextOpen: boolean) => {
      if (!isControlled) {
        setInternalOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);
    },
    [isControlled, onOpenChange],
  );

  useEffect(() => {
    if (actualOpen && !wasOpenRef.current) {
      setDraft(settings);
      setShowApiKey(false);
      setModelOptions([]);
      setModelFetchError(null);
    }
    wasOpenRef.current = actualOpen;
  }, [actualOpen, settings]);

  const fetchModels = useCallback(async () => {
    const next = normalizeAgentModelSettings(draft);
    if (!next.baseUrl || !next.apiKey) {
      setModelFetchError("请先填写模型服务地址和访问密钥");
      return;
    }

    setIsFetchingModels(true);
    setModelFetchError(null);
    try {
      const response = await fetch("/api/agent/floating/models", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          baseUrl: next.baseUrl,
          apiKey: next.apiKey,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof body.error === "string" ? body.error : "获取模型失败",
        );
      }

      const models = normalizeModelOptions(body.models);
      if (models.length === 0) {
        setModelOptions([]);
        setModelFetchError("没有获取到可用模型");
        return;
      }

      setModelOptions(models);
      setDraft((current) => {
        const currentName = current.modelName.trim();
        const hasCurrent = models.some((model) => model.id === currentName);
        return {
          ...current,
          modelName: hasCurrent ? currentName : models[0].id,
        };
      });
    } catch (error) {
      setModelOptions([]);
      setModelFetchError(
        error instanceof Error ? error.message : "获取模型失败",
      );
    } finally {
      setIsFetchingModels(false);
    }
  }, [draft]);

  function saveSettings() {
    const next = normalizeAgentModelSettings(draft);
    storeAgentModelSettings(next);
    onSave(next);
    setDialogOpen(false);
  }

  return (
    <Dialog open={actualOpen} onOpenChange={setDialogOpen}>
      {triggerNode ? <DialogTrigger render={triggerNode} /> : null}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <ModelSettingsInput
            id={baseUrlId}
            label="模型服务地址"
            value={draft.baseUrl}
            placeholder="https://api.openai.com/v1"
            onChange={(value) =>
              setDraft((current) => ({ ...current, baseUrl: value }))
            }
          />
          <div className="space-y-1.5">
            <Label htmlFor={apiKeyId} className="text-xs text-muted-foreground">
              访问密钥
            </Label>
            <div className="relative">
              <Input
                id={apiKeyId}
                type={showApiKey ? "text" : "password"}
                value={draft.apiKey}
                placeholder="只保存在当前浏览器"
                autoComplete="off"
                className="h-9 pr-9 text-sm"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    apiKey: event.target.value,
                  }))
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="absolute right-1 top-1/2 -translate-y-1/2"
                aria-label={showApiKey ? "隐藏访问密钥" : "显示访问密钥"}
                title={showApiKey ? "隐藏访问密钥" : "显示访问密钥"}
                onClick={() => setShowApiKey((current) => !current)}
              >
                {showApiKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              填好地址和密钥后，可以直接获取模型列表。
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canFetchModels || isFetchingModels}
              onClick={fetchModels}
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isFetchingModels ? "animate-spin" : ""}`}
              />
              获取模型
            </Button>
          </div>
          {modelFetchError ? (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {modelFetchError}
            </p>
          ) : null}
          {modelOptions.length > 0 ? (
            <ModelSettingsSelect
              id={modelSelectId}
              label="选择模型"
              value={draft.modelName}
              options={modelOptions}
              onChange={(value) =>
                setDraft((current) => ({ ...current, modelName: value }))
              }
            />
          ) : (
            <ModelSettingsInput
              id={modelNameId}
              label="模型名称"
              value={draft.modelName}
              placeholder="gpt-5-mini"
              onChange={(value) =>
                setDraft((current) => ({ ...current, modelName: value }))
              }
            />
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>
            取消
          </Button>
          <Button type="button" onClick={saveSettings}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AgentModelSettingsCard() {
  const [settings, setSettings] = useState<AgentModelSettingsForm>(() =>
    emptyAgentModelSettings(),
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSettings(readStoredAgentModelSettings());
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const configured = isAgentModelConfigured(settings);
  const hasApiKey = settings.apiKey.trim().length > 0;

  return (
    <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/10">
          <Bot className="h-4 w-4 text-sky-600 dark:text-sky-400" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Agent 模型</span>
            <span
              className={[
                "rounded-full px-2 py-0.5 text-[11px] font-medium",
                configured
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
              ].join(" ")}
            >
              {configured ? "已配置" : "未配置"}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            仅保存在当前浏览器；访问密钥只保存在本次浏览器会话。
          </p>
          <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
            <ModelSettingsSummaryItem
              label="模型服务地址"
              value={settings.baseUrl || "未填写"}
            />
            <ModelSettingsSummaryItem
              label="模型名称"
              value={settings.modelName || "未填写"}
            />
            <ModelSettingsSummaryItem
              label="访问密钥"
              value={hasApiKey ? "访问密钥已配置" : "访问密钥未配置"}
            />
          </dl>
          <div className="mt-4">
            <ModelSettingsDialog
              settings={settings}
              onSave={setSettings}
              trigger={
                <Button type="button" size="sm" variant="outline">
                  <Settings className="h-3.5 w-3.5" />
                  编辑模型设置
                </Button>
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ModelSettingsInput({
  id,
  label,
  value,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        className="h-9 text-sm"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function ModelSettingsSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: ModelOption[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm shadow-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ModelSettingsSummaryItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/40 px-3 py-2 dark:bg-muted/20">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate font-medium text-foreground">{value}</dd>
    </div>
  );
}

function normalizeModelOptions(value: unknown): ModelOption[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const options: ModelOption[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    if (!id || seen.has(id)) continue;
    const label =
      typeof record.label === "string" && record.label.trim()
        ? record.label.trim()
        : id;
    seen.add(id);
    options.push({ id, label });
  }
  return options;
}
