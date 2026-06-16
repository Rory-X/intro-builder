"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Settings2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  clearByokConfig,
  saveByokConfig,
  useByokConfig,
} from "@/lib/agent/byok-store";

/**
 * BYOK model settings. The key lives only in this browser (localStorage) and is
 * sent per chat request — never stored on our servers.
 */
export function ByokSettingsDialog() {
  const config = useByokConfig();
  const [open, setOpen] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [modelName, setModelName] = useState("");

  // Seed the form from the stored config when the dialog opens (in the event
  // handler, not an effect — avoids cascading-render lint and is simpler).
  const handleOpenChange = (next: boolean) => {
    if (next) {
      setBaseUrl(config?.baseUrl ?? "");
      setApiKey(config?.apiKey ?? "");
      setModelName(config?.modelName ?? "");
    }
    setOpen(next);
  };

  const save = () => {
    if (!baseUrl.trim() || !apiKey.trim() || !modelName.trim()) {
      toast.error("请填写 Base URL、API Key 和模型名");
      return;
    }
    saveByokConfig({ baseUrl, apiKey, modelName });
    toast.success("模型已保存（仅存于本浏览器）");
    setOpen(false);
  };

  const clear = () => {
    clearByokConfig();
    setBaseUrl("");
    setApiKey("");
    setModelName("");
    toast.success("已清除本地模型配置");
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={<Button type="button" variant="ghost" size="sm" title="模型设置" />}
      >
        <Settings2 className="size-4" />
        {config ? "模型已配置" : "模型设置"}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>模型设置（BYOK）</DialogTitle>
          <DialogDescription>
            填入你自己的 OpenAI 兼容模型。密钥只保存在本浏览器，按需随请求发送，不会存到服务器。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="byok-base-url">Base URL</Label>
            <Input
              id="byok-base-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.deepseek.com/v1"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="byok-api-key">API Key</Label>
            <Input
              id="byok-api-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-…"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="byok-model-name">模型名</Label>
            <Input
              id="byok-model-name"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder="deepseek-chat"
              autoComplete="off"
            />
          </div>
        </div>
        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={clear}
            disabled={!config}
          >
            清除
          </Button>
          <Button type="button" onClick={save}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
