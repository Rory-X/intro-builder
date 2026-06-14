import { LangfuseClient } from "@langfuse/client";

import {
  buildAgentMessagePrompt,
  type AgentMessagePrompt,
  type AgentMessagePromptMessage,
  type AgentMessageRequest,
} from "../agent-messages.js";
import type { AgentConfig } from "../config.js";

export type LangfusePromptClient = {
  prompt: {
    get: (
      name: string,
      options: {
        type: "chat";
        label: string;
        cacheTtlSeconds: number;
        fallback: AgentMessagePromptMessage[];
        maxRetries: number;
        fetchTimeoutMs: number;
      },
    ) => Promise<{
      name: string;
      version: number;
      isFallback: boolean;
      compile: (
        variables: Record<string, string>,
      ) => unknown[] | AgentMessagePromptMessage[];
    }>;
  };
};

export type AgentMessagePromptResolver = {
  resolve: (request: AgentMessageRequest) => Promise<AgentMessagePrompt>;
};

export function createAgentMessagePromptResolver(
  config: AgentConfig,
  options: {
    langfuse?: LangfusePromptClient;
  } = {},
): AgentMessagePromptResolver {
  const langfuse =
    options.langfuse ??
    (config.langfuse.promptManagementEnabled
      ? new LangfuseClient({
          publicKey: config.langfuse.publicKey,
          secretKey: config.langfuse.secretKey,
          baseUrl: config.langfuse.baseUrl,
          timeout: config.langfuse.timeoutSeconds,
        })
      : undefined);

  return {
    async resolve(request) {
      const localPrompt = {
        ...buildAgentMessagePrompt(request),
        metadata: { source: "local" as const },
      };

      if (!config.langfuse.promptManagementEnabled || !langfuse) {
        return localPrompt;
      }

      try {
        const fallback = localPromptFallbackMessages();
        const promptClient = await langfuse.prompt.get(
          config.langfuse.agentMessagePromptName,
          {
            type: "chat",
            label: config.langfuse.promptLabel,
            cacheTtlSeconds: config.langfuse.promptCacheTtlSeconds,
            fallback,
            maxRetries: 1,
            fetchTimeoutMs: config.langfuse.promptFetchTimeoutMs,
          },
        );
        const compiled = promptClient.compile({
          system: localPrompt.system,
          developer: localPrompt.developer,
          user: localPrompt.user,
          workflowId: request.workflowId ?? "",
          mode: request.mode ?? "optimize_existing",
          locale: request.locale,
        });
        const messages = toPromptMessages(compiled);

        if (messages.length === 0) {
          return localPrompt;
        }

        return {
          ...localPrompt,
          messages,
          metadata: {
            source: "langfuse",
            name: promptClient.name,
            label: config.langfuse.promptLabel,
            version: promptClient.version,
            isFallback: promptClient.isFallback,
          },
        };
      } catch {
        return localPrompt;
      }
    },
  };
}

function localPromptFallbackMessages(): AgentMessagePromptMessage[] {
  return [
    {
      role: "system",
      content: "{{system}}\n\n开发者指令：\n{{developer}}",
    },
    { role: "user", content: "{{user}}" },
  ];
}

function toPromptMessages(compiled: unknown[]): AgentMessagePromptMessage[] {
  const messages: AgentMessagePromptMessage[] = [];

  for (const item of compiled) {
    if (!isRecord(item)) continue;
    if (item.role !== "system" && item.role !== "user") continue;
    if (typeof item.content !== "string") continue;
    messages.push({ role: item.role, content: item.content });
  }

  return messages;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
