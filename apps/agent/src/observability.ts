import { createHash } from "node:crypto";

import { LangfuseClient } from "@langfuse/client";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
  startActiveObservation,
  type LangfuseAgent,
} from "@langfuse/tracing";
import { NodeSDK } from "@opentelemetry/sdk-node";

import type { AuthenticatedAgentSession } from "./auth.js";
import type { AgentConfig } from "./config.js";
import type {
  AgentMessagePrompt,
  AgentMessageProviderRunResult,
  AgentMessageRequest,
  AgentMessageUsage,
} from "./agent-messages.js";

export type AgentCacheStatus = "hit" | "miss" | "skip";

export type AgentMessageTraceContext = {
  request: AgentMessageRequest;
  session: AuthenticatedAgentSession;
  requestId: string;
  cacheStatus: AgentCacheStatus;
};

export type AgentMessageParseTrace =
  | {
      ok: true;
      toolCallCount: number;
      proposedOperationCount: number;
      interruptReasons: string[];
    }
  | { ok: false; message: string };

export type AgentMessageTrace = {
  recordCache: (status: AgentCacheStatus) => void;
  recordParseResult: (result: AgentMessageParseTrace) => void;
  recordRunOutput: (output: {
    status: "ok" | "error";
    toolCallCount?: number;
    proposedOperationCount?: number;
    error?: string;
  }) => void;
  traceGeneration: <T>(
    input: AgentMessageGenerationTraceInput,
    run: () => Promise<T>,
  ) => Promise<T>;
};

export type AgentMessageGenerationTraceInput = {
  modelName?: string;
  provider?: string;
  prompt: AgentMessagePrompt;
};

export type SafeAgentMessageGenerationTraceInput = {
  modelName?: string;
  provider?: string;
  prompt?: {
    name: string;
    version: number;
    isFallback: boolean;
  };
  input: Record<string, unknown> | AgentMessagePrompt;
  metadata: Record<string, unknown>;
};

export type AgentObservability = {
  enabled: boolean;
  traceAgentMessageRun: <T>(
    context: AgentMessageTraceContext,
    run: (trace: AgentMessageTrace) => Promise<T>,
  ) => Promise<T>;
  flush: () => Promise<void>;
  shutdown: () => Promise<void>;
};

export type AgentMessageTraceMetadata = {
  requestId: string;
  workflowId: AgentMessageRequest["workflowId"];
  serviceName: string;
  serviceVersion: string;
  environment: string;
  modelName: string | null;
  userHash: string;
  resumeId: string | null;
  activeSection: string | null;
  messageCount: number;
  sectionCount: number;
  cacheStatus: AgentCacheStatus;
  captureRawPayloads: boolean;
  raw?: {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    sections: Array<{
      key: string;
      label: string;
      fieldPath: string;
      plainText: string;
    }>;
  };
};

type CreateAgentObservabilityOptions = {
  random?: () => number;
};

export function createAgentObservability(
  config: AgentConfig,
  options: CreateAgentObservabilityOptions = {},
): AgentObservability {
  if (!config.langfuse.enabled) {
    return createNoopAgentObservability();
  }

  const random = options.random ?? Math.random;
  const sdk = new NodeSDK({
    spanProcessors: [
      new LangfuseSpanProcessor({
        publicKey: config.langfuse.publicKey,
        secretKey: config.langfuse.secretKey,
        baseUrl: config.langfuse.baseUrl,
        environment: config.langfuse.environment,
        release: config.langfuse.release,
        timeout: config.langfuse.timeoutSeconds,
        shouldExportSpan: () => random() <= config.langfuse.sampleRate,
        mask: ({ data }) => maskLangfusePayload(data),
      }),
    ],
  });
  sdk.start();

  const client = new LangfuseClient({
    publicKey: config.langfuse.publicKey,
    secretKey: config.langfuse.secretKey,
    baseUrl: config.langfuse.baseUrl,
    timeout: config.langfuse.timeoutSeconds,
  });

  return new LangfuseAgentObservability(config, sdk, client);
}

export function buildAgentMessageTraceMetadata({
  config,
  request,
  session,
  requestId,
  cacheStatus,
}: AgentMessageTraceContext & { config: AgentConfig }): AgentMessageTraceMetadata {
  const metadata: AgentMessageTraceMetadata = {
    requestId,
    workflowId: request.workflowId,
    serviceName: config.serviceName,
    serviceVersion: config.version,
    environment: config.langfuse.environment,
    modelName: config.modelName ?? null,
    userHash: hashIdentifier(session.userId),
    resumeId: request.resumeId,
    activeSection: request.context?.activeSection ?? null,
    messageCount: request.messages.length,
    sectionCount: request.context?.sections.length ?? 0,
    cacheStatus,
    captureRawPayloads: config.langfuse.captureRawPayloads,
  };

  if (config.langfuse.captureRawPayloads) {
    metadata.raw = {
      messages: request.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      sections:
        request.context?.sections.map((section) => ({
          key: section.key,
          label: section.label,
          fieldPath: section.fieldPath,
          plainText: section.plainText,
        })) ?? [],
    };
  }

  return metadata;
}

function createNoopAgentObservability(): AgentObservability {
  return {
    enabled: false,
    async traceAgentMessageRun(_context, run) {
      return run(noopAgentMessageTrace);
    },
    async flush() {},
    async shutdown() {},
  };
}

const noopAgentMessageTrace: AgentMessageTrace = {
  recordCache() {},
  recordParseResult() {},
  recordRunOutput() {},
  async traceGeneration(_input, run) {
    return run();
  },
};

class LangfuseAgentObservability implements AgentObservability {
  enabled = true;

  constructor(
    private readonly config: AgentConfig,
    private readonly sdk: NodeSDK,
    private readonly client: LangfuseClient,
  ) {}

  async traceAgentMessageRun<T>(
    context: AgentMessageTraceContext,
    run: (trace: AgentMessageTrace) => Promise<T>,
  ): Promise<T> {
    const metadata = buildAgentMessageTraceMetadata({
      config: this.config,
      ...context,
    });
    const { raw, ...safeMetadata } = metadata;

    return startActiveObservation(
      "agent.message.run",
      async (observation) => {
        observation.update({
          input: raw ?? buildSafeRunInput(context.request),
          metadata: safeMetadata,
        });
        const trace = new LangfuseAgentMessageTrace(
          this.config,
          observation,
          safeMetadata,
        );

        try {
          const result = await run(trace);
          trace.recordRunOutputIfMissing({ status: "ok" });
          return result;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Agent message run failed";
          trace.recordRunOutput({ status: "error", error: message });
          throw error;
        }
      },
      { asType: "agent" },
    );
  }

  async flush(): Promise<void> {
    await this.client.flush();
  }

  async shutdown(): Promise<void> {
    await this.client.shutdown();
    await this.sdk.shutdown();
  }
}

class LangfuseAgentMessageTrace implements AgentMessageTrace {
  private readonly metadata: Record<string, unknown>;
  private outputRecorded = false;

  constructor(
    private readonly config: AgentConfig,
    private readonly observation: LangfuseAgent,
    baseMetadata: Record<string, unknown>,
  ) {
    this.metadata = { ...baseMetadata };
  }

  recordCache(status: AgentCacheStatus): void {
    this.metadata.cacheStatus = status;
    this.updateObservation();
  }

  recordParseResult(result: AgentMessageParseTrace): void {
    if (result.ok) {
      this.metadata.parseStatus = "ok";
      this.metadata.toolCallCount = result.toolCallCount;
      this.metadata.proposedOperationCount = result.proposedOperationCount;
      this.metadata.interruptReasons = result.interruptReasons;
    } else {
      this.metadata.parseStatus = "error";
      this.metadata.parseError = result.message;
    }
    this.updateObservation();
  }

  recordRunOutput(output: {
    status: "ok" | "error";
    toolCallCount?: number;
    proposedOperationCount?: number;
    error?: string;
  }): void {
    this.outputRecorded = true;
    this.observation.update({
      output,
      level: output.status === "error" ? "ERROR" : "DEFAULT",
      statusMessage: output.error,
      metadata: this.metadata,
    });
  }

  recordRunOutputIfMissing(output: {
    status: "ok" | "error";
    toolCallCount?: number;
    proposedOperationCount?: number;
    error?: string;
  }): void {
    if (this.outputRecorded) return;
    this.recordRunOutput(output);
  }

  async traceGeneration<T>(
    input: AgentMessageGenerationTraceInput,
    run: () => Promise<T>,
  ): Promise<T> {
    const generation = this.observation.startObservation(
      "agent.message.provider",
      buildAgentMessageGenerationTraceInput({
        ...input,
        captureRawPayloads: this.config.langfuse.captureRawPayloads,
      }),
      { asType: "generation" },
    );

    try {
      const result = await run();
      const providerResult = isAgentMessageProviderRunResult(result)
        ? result
        : null;
      generation.update({
        output: providerResult
          ? this.config.langfuse.captureRawPayloads
            ? providerResult.content
            : { contentLength: providerResult.content.length }
          : { status: "ok" },
        model: providerResult?.usage.model ?? input.modelName,
        usageDetails: providerResult ? toLangfuseUsage(providerResult.usage) : undefined,
        metadata: {
          ...buildPromptTraceMetadata(input.prompt),
          provider: providerResult?.usage.provider ?? input.provider,
          captureRawPayloads: this.config.langfuse.captureRawPayloads,
        },
      });
      return result;
    } catch (error) {
      generation.update({
        level: "ERROR",
        statusMessage:
          error instanceof Error ? error.message : "Provider request failed",
      });
      throw error;
    } finally {
      generation.end();
    }
  }

  private updateObservation(): void {
    this.observation.update({ metadata: this.metadata });
  }
}

function buildSafeRunInput(request: AgentMessageRequest): Record<string, unknown> {
  return {
    workflowId: request.workflowId,
    mode: request.mode ?? "optimize_existing",
    locale: request.locale,
    activeSection: request.context?.activeSection ?? null,
    messageCount: request.messages.length,
    sectionCount: request.context?.sections.length ?? 0,
    completenessOverall: request.context?.completeness.overall ?? null,
  };
}

function buildSafePromptInput(
  prompt: AgentMessageGenerationTraceInput["prompt"],
): Record<string, unknown> {
  return {
    systemLength: prompt.system.length,
    developerLength: prompt.developer.length,
    userLength: prompt.user.length,
  };
}

export function buildAgentMessageGenerationTraceInput({
  modelName,
  provider,
  prompt,
  captureRawPayloads,
}: AgentMessageGenerationTraceInput & {
  captureRawPayloads: boolean;
}): SafeAgentMessageGenerationTraceInput {
  const promptMetadata = prompt.metadata;
  return {
    modelName,
    provider,
    ...(promptMetadata?.source === "langfuse"
      ? {
          prompt: {
            name: promptMetadata.name,
            version: promptMetadata.version,
            isFallback: promptMetadata.isFallback,
          },
        }
      : {}),
    input: captureRawPayloads ? prompt : buildSafePromptInput(prompt),
    metadata: {
      ...buildPromptTraceMetadata(prompt),
      provider: provider ?? "ai-sdk/openai-compatible",
      captureRawPayloads,
    },
  };
}

function buildPromptTraceMetadata(
  prompt: AgentMessagePrompt,
): Record<string, unknown> {
  const promptMetadata = prompt.metadata;
  if (promptMetadata?.source !== "langfuse") {
    return { promptSource: promptMetadata?.source ?? "local" };
  }

  return {
    promptSource: "langfuse",
    promptName: promptMetadata.name,
    promptLabel: promptMetadata.label,
    promptVersion: promptMetadata.version,
    promptIsFallback: promptMetadata.isFallback,
  };
}

function toLangfuseUsage(usage: AgentMessageUsage): Record<string, number> {
  return {
    input: usage.inputTokens,
    output: usage.outputTokens,
    total: usage.inputTokens + usage.outputTokens,
  };
}

function isAgentMessageProviderRunResult(
  value: unknown,
): value is AgentMessageProviderRunResult {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as { content?: unknown }).content === "string" &&
    Boolean((value as { usage?: unknown }).usage)
  );
}

function hashIdentifier(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function maskLangfusePayload(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/sk-[A-Za-z0-9_-]+/g, "sk-***")
      .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer ***");
  }

  if (Array.isArray(value)) {
    return value.map(maskLangfusePayload);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        /secret|token|apiKey|authorization/i.test(key)
          ? "***"
          : maskLangfusePayload(nestedValue),
      ]),
    );
  }

  return value;
}
