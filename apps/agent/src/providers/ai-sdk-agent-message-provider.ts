import {
  generateText,
  Output,
  streamText,
  type LanguageModel,
  type LanguageModelUsage,
  type TelemetrySettings,
  type TimeoutConfiguration,
} from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import type { AgentConfig } from "../config.js";
import type {
  AgentMessagePrompt,
  AgentMessagePromptMessage,
  AgentMessageProvider,
  AgentMessageUsage,
} from "../agent-messages.js";
import { RichTextPolishProviderError } from "../rich-text-polish.js";

export type AiSdkModelSettings = {
  baseUrl: string;
  apiKey: string;
  modelName: string;
};

export type AiSdkAgentMessageRuntime = {
  createModel: (settings: AiSdkModelSettings) => LanguageModel;
  generate: (options: AiSdkGenerateOptions) => Promise<AiSdkGenerateResult>;
  stream: (options: AiSdkStreamOptions) => AiSdkStreamResult;
};

export type AiSdkGenerateOptions = {
  model: LanguageModel;
  system?: string;
  messages: AgentMessagePromptMessage[];
  timeoutMs: number;
  telemetry: TelemetrySettings;
};

export type AiSdkStreamOptions = AiSdkGenerateOptions;

export type AiSdkGenerateResult = {
  text: string;
  usage: LanguageModelUsage;
};

export type AiSdkStreamResult = {
  textStream: AsyncIterable<string>;
  usage: PromiseLike<LanguageModelUsage>;
};

export function createAiSdkAgentMessageProvider(
  config: AgentConfig,
  options: {
    runtime?: AiSdkAgentMessageRuntime;
  } = {},
): AgentMessageProvider | undefined {
  if (!config.modelBaseUrl || !config.modelApiKey || !config.modelName) {
    return undefined;
  }

  const settings: AiSdkModelSettings = {
    baseUrl: config.modelBaseUrl,
    apiKey: config.modelApiKey,
    modelName: config.modelName,
  };
  const runtime = options.runtime ?? createDefaultAiSdkAgentMessageRuntime(config);
  const model = runtime.createModel(settings);

  return {
    async run({ prompt, requestId }) {
      try {
        const result = await runtime.generate({
          model,
          ...promptToModelPrompt(prompt),
          timeoutMs: config.modelTimeoutMs,
          telemetry: buildAiSdkTelemetry(config, requestId, prompt),
        });

        return {
          content: result.text,
          usage: toAgentMessageUsage(settings.modelName, result.usage),
        };
      } catch (error) {
        throw toProviderError(error);
      }
    },
    async *stream({ prompt, requestId }) {
      try {
        const result = runtime.stream({
          model,
          ...promptToModelPrompt(prompt),
          timeoutMs: config.modelTimeoutMs,
          telemetry: buildAiSdkTelemetry(config, requestId, prompt),
        });

        for await (const delta of result.textStream) {
          if (delta) yield { type: "content_delta", delta };
        }

        yield {
          type: "usage",
          usage: toAgentMessageUsage(settings.modelName, await result.usage),
        };
      } catch (error) {
        throw toProviderError(error);
      }
    },
  };
}

export function promptToMessages(
  prompt: AgentMessagePrompt,
): AgentMessagePromptMessage[] {
  if (prompt.messages && prompt.messages.length > 0) {
    return prompt.messages;
  }

  return [
    {
      role: "system",
      content: `${prompt.system}\n\n开发者指令：\n${prompt.developer}`,
    },
    { role: "user", content: prompt.user },
  ];
}

export function promptToModelPrompt(prompt: AgentMessagePrompt): {
  system?: string;
  messages: AgentMessagePromptMessage[];
} {
  const promptMessages = promptToMessages(prompt);
  const system = promptMessages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const messages = promptMessages.filter((message) => message.role !== "system");

  return {
    ...(system ? { system } : {}),
    messages: messages.length > 0 ? messages : [{ role: "user", content: prompt.user }],
  };
}

function createDefaultAiSdkAgentMessageRuntime(
  config: AgentConfig,
): AiSdkAgentMessageRuntime {
  return {
    createModel(settings) {
      const provider = createOpenAICompatible({
        name: "intro-openai-compatible",
        baseURL: settings.baseUrl,
        apiKey: settings.apiKey,
        includeUsage: true,
      });
      return provider(settings.modelName);
    },
    async generate(options) {
      const result = await generateText({
        model: options.model,
        system: options.system,
        messages: options.messages,
        allowSystemInMessages: false,
        timeout: toAiSdkTimeout(options.timeoutMs),
        output: Output.json({ name: "agent_message_response" }),
        experimental_telemetry: options.telemetry,
      });

      return {
        text: result.text,
        usage: result.usage,
      };
    },
    stream(options) {
      const result = streamText({
        model: options.model,
        system: options.system,
        messages: options.messages,
        allowSystemInMessages: false,
        timeout: toAiSdkTimeout(options.timeoutMs),
        output: Output.json({ name: "agent_message_response" }),
        experimental_telemetry: options.telemetry,
      });

      return {
        textStream: result.textStream,
        usage: result.usage,
      };
    },
  };
}

export function toAiSdkTimeout(timeoutMs: number): TimeoutConfiguration {
  return { totalMs: timeoutMs };
}

function buildAiSdkTelemetry(
  config: AgentConfig,
  requestId: string,
  prompt: AgentMessagePrompt,
): TelemetrySettings {
  const promptMetadata = prompt.metadata;
  return {
    isEnabled: true,
    recordInputs: config.langfuse.captureRawPayloads,
    recordOutputs: config.langfuse.captureRawPayloads,
    functionId: "agent.message.provider",
    metadata: {
      requestId,
      provider: "ai-sdk/openai-compatible",
      promptSource: promptMetadata?.source ?? "local",
      ...(promptMetadata?.source === "langfuse"
        ? {
            promptName: promptMetadata.name,
            promptLabel: promptMetadata.label,
            promptVersion: promptMetadata.version,
            promptIsFallback: promptMetadata.isFallback,
          }
        : {}),
    },
  };
}

function toAgentMessageUsage(
  model: string,
  usage: LanguageModelUsage,
): AgentMessageUsage {
  return {
    provider: "ai-sdk/openai-compatible",
    model,
    inputTokens: numberOrZero(usage.inputTokens),
    outputTokens: numberOrZero(usage.outputTokens),
  };
}

function toProviderError(error: unknown): RichTextPolishProviderError {
  if (error instanceof RichTextPolishProviderError) return error;
  if (error instanceof DOMException && error.name === "AbortError") {
    return new RichTextPolishProviderError(
      "Provider request timed out",
      "provider_timeout",
    );
  }

  return new RichTextPolishProviderError(
    error instanceof Error ? error.message : "Provider request failed",
    "dependency_unavailable",
  );
}

function numberOrZero(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export const createOpenAICompatibleAgentMessageProvider =
  createAiSdkAgentMessageProvider;
