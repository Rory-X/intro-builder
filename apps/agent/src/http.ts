import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import type { TelemetrySettings } from "ai";

import { EventType, type BaseEvent } from "@ag-ui/core";
import { EventEncoder } from "@ag-ui/encoder";

import {
  authenticateAgentRequest,
  type AgentReplayStore,
  type AuthenticatedAgentSession,
} from "./auth.js";
import {
  appendAgUiContextStatusEvents,
  createOpenAICompatibleAgentMessageProvider,
  extractStreamingAgentMessageContent,
  parseAgentMessageProviderResponse,
  toAgUiAgentEvents,
  workflowRuntimeEventsToAgUiEvents,
  validateAgentMessageRequest,
  type AgentMessageUsage,
  type AgentMessagePrompt,
  type AgentMessageProvider,
  type AgentMessageParseResult,
  type AgentMessageRequest,
  type AgentQuestionRequest,
} from "./agent-messages.js";
import {
  createAgentMessagePromptResolver,
  type AgentMessagePromptResolver,
} from "./prompts/agent-message-prompt-resolver.js";
import { buildAgentContextStatus } from "./workflows/context-status.js";
import {
  assembleLoopResult,
  createInitialLoopDraft,
  createLoopModel,
  LOOP_MAX_STEPS,
  runResumeLoop,
  type LoopStepEvent,
} from "./workflows/loop-runtime.js";
import { buildAgentResumeWorkspace } from "./workflows/resume-workspace.js";
import {
  buildAgUiAskInterruptEvents,
  buildWorkflowRuntimeEvents,
} from "./workflows/workflow-runtime.js";
import {
  buildAiCacheKey,
  getAiCacheTtlSeconds,
  type AiCacheEntry,
  type AiCacheScope,
  type AiCacheStore,
} from "./ai-cache.js";
import type { AgentToolCall, ResumeOperation } from "./agent-tools.js";
import type { AgentConfig } from "./config.js";
import { createErrorEnvelope } from "./errors.js";
import {
  createAgentObservability,
  type AgentMessageParseTrace,
  type AgentMessageTrace,
  type AgentObservability,
} from "./observability.js";
import { checkRateLimit, type RateLimitRedis } from "./rate-limit.js";
import type { RedisReadyResult } from "./redis.js";
import {
  polishRichText,
  RichTextPolishProviderError,
  validateRichTextPolishRequest,
  type RichTextPolishProvider,
  type RichTextPolishRunResult,
} from "./rich-text-polish.js";
import {
  buildResumeHelperPrompt,
  parseResumeHelperProviderResponse,
  validateResumeHelperRequest,
  type ResumeHelperProvider,
  type ResumeHelperResult,
  type ResumeHelperUsage,
} from "./resume-helpers.js";
import {
  agentRequestWithStoreSnapshot,
  createAgentSessionRecorder,
  deriveAgentSessionId,
  type AgentSessionRecorder,
  type AgentSessionStore,
} from "./session-store.js";

export type CreateAgentServerOptions = {
  config: AgentConfig;
  now?: () => Date;
  uptimeSeconds?: () => number;
  redisReady?: () => Promise<RedisReadyResult>;
  replayStore?: AgentReplayStore;
  rateLimitStore?: RateLimitRedis;
  aiCacheStore?: AiCacheStore;
  richTextPolishProvider?: RichTextPolishProvider;
  resumeHelperProvider?: ResumeHelperProvider;
  agentMessageProvider?: AgentMessageProvider;
  agentMessagePromptResolver?: AgentMessagePromptResolver;
  observability?: AgentObservability;
  sessionStore?: AgentSessionStore;
  createRequestId?: () => string;
};

type HealthStatus = "ok" | "ready";
type RequestContext = {
  requestId: string;
  corsHeaders?: Record<string, string>;
};
type RichTextPolishCacheValue = RichTextPolishRunResult;
type ResumeHelperCacheValue = {
  helperId: string;
  result: ResumeHelperResult;
  usage: ResumeHelperUsage;
};
type AgentMessageCacheValue = {
  message: { id: string; role: "assistant"; content: string };
  toolCalls: AgentToolCall[];
  proposedOperations: ResumeOperation[];
  questions?: AgentQuestionRequest[];
  usage: AgentMessageUsage;
};

export function createAgentServer({
  config,
  now = () => new Date(),
  uptimeSeconds = () => Math.floor(process.uptime()),
  redisReady = async () => ({ ok: true }),
  replayStore,
  rateLimitStore,
  aiCacheStore,
  richTextPolishProvider,
  resumeHelperProvider,
  agentMessageProvider,
  agentMessagePromptResolver = createAgentMessagePromptResolver(config),
  observability = createAgentObservability(config),
  sessionStore,
  createRequestId = defaultCreateRequestId,
}: CreateAgentServerOptions): Server {
  return createServer((request, response) => {
    void routeRequest(
      request,
      response,
      config,
      now,
      uptimeSeconds,
      redisReady,
      replayStore,
      rateLimitStore,
      aiCacheStore,
      richTextPolishProvider,
      resumeHelperProvider,
      agentMessageProvider,
      agentMessagePromptResolver,
      observability,
      sessionStore,
      createRequestId,
    ).catch((error: unknown) => {
      if (response.headersSent) {
        response.end();
        return;
      }

      const context = {
        requestId: resolveRequestId(request, createRequestId),
      };
      sendError(response, 500, context, {
        error: "internal_error",
        message: error instanceof Error ? error.message : "Internal error",
      });
    });
  });
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: AgentConfig,
  now: () => Date,
  uptimeSeconds: () => number,
  redisReady: () => Promise<RedisReadyResult>,
  replayStore: AgentReplayStore | undefined,
  rateLimitStore: RateLimitRedis | undefined,
  aiCacheStore: AiCacheStore | undefined,
  richTextPolishProvider: RichTextPolishProvider | undefined,
  resumeHelperProvider: ResumeHelperProvider | undefined,
  agentMessageProvider: AgentMessageProvider | undefined,
  agentMessagePromptResolver: AgentMessagePromptResolver,
  observability: AgentObservability,
  sessionStore: AgentSessionStore | undefined,
  createRequestId: () => string,
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://agent.local");
  const corsHeaders = resolveCorsHeaders(request, config);
  const context = {
    requestId: resolveRequestId(request, createRequestId),
    ...(corsHeaders ? { corsHeaders } : {}),
  };

  if (method === "OPTIONS" && url.pathname === "/v1/agent/chat") {
    return sendCorsPreflight(response, context);
  }

  if (url.pathname === "/health") {
    if (method !== "GET") return methodNotAllowed(response, context);

    return sendStatus(response, "ok", config, now, uptimeSeconds, context);
  }

  if (url.pathname === "/ready") {
    if (method !== "GET") return methodNotAllowed(response, context);

    const redis = await redisReady();
    if (!redis.ok) {
      return sendError(response, 503, context, {
        error: "dependency_unavailable",
        message: redis.message,
        dependency: "redis",
      });
    }

    return sendStatus(response, "ready", config, now, uptimeSeconds, context);
  }

  if (url.pathname === "/v1/session") {
    if (method !== "GET") return methodNotAllowed(response, context);

    const auth = await authenticateAgentRequest({
      authorizationHeader: headerValue(request.headers.authorization),
      expectedScope: "agent:session",
      config,
      replayStore,
      now: now(),
    });

    if (!auth.ok) {
      logAuthFailure(auth, context, url.pathname, method);
      return sendError(response, auth.statusCode, context, {
        error: auth.error,
        message: auth.message,
        dependency: auth.dependency,
      });
    }

    return sendAgentSession(response, auth.session, context);
  }

  if (url.pathname === "/v1/rich-text/polish") {
    if (method !== "POST") return methodNotAllowed(response, context, "POST");

    const auth = await authenticateAgentRequest({
      authorizationHeader: headerValue(request.headers.authorization),
      expectedScope: "rich_text:polish",
      config,
      replayStore,
      now: now(),
    });

    if (!auth.ok) {
      logAuthFailure(auth, context, url.pathname, method);
      return sendError(response, auth.statusCode, context, {
        error: auth.error,
        message: auth.message,
        dependency: auth.dependency,
      });
    }

    const body = await readJsonBody(request);
    if (!body.ok) {
      return sendError(response, 400, context, {
        error: "bad_request",
        message: body.message,
      });
    }

    const validation = validateRichTextPolishRequest(body.value);
    if (!validation.ok) {
      return sendError(response, validation.statusCode, context, {
        error: validation.error,
        message: validation.message,
      });
    }

    if (auth.session.resumeId !== validation.request.resumeId) {
      return sendError(response, 403, context, {
        error: "forbidden",
        message: "Token resumeId does not match request resumeId",
      });
    }

    if (!richTextPolishProvider) {
      return sendError(response, 503, context, {
        error: "dependency_unavailable",
        message: "Rich text polish provider is not configured",
        dependency: "provider",
      });
    }

    const cacheKey = buildScopedCacheKey({
      scope: "rich_text:polish",
      session: auth.session,
      resumeId: validation.request.resumeId,
      config,
      input: validation.request,
    });
    const cached = await readAiCache<RichTextPolishCacheValue>(
      aiCacheStore,
      cacheKey,
    );
    if (cached) {
      return sendJson(
        response,
        200,
        {
          status: "ok",
          requestId: context.requestId,
          result: cached.value.result,
          usage: cached.value.usage,
          cached: true,
          cachedAt: cached.createdAt,
        },
        context,
      );
    }

    if (rateLimitStore) {
      try {
        const rateLimit = await checkRateLimit({
          redis: rateLimitStore,
          scope: "rich_text:polish",
          identityHash: hashIdentity(auth.session.userId),
          limit: config.rateLimitMaxRequests,
          windowSeconds: config.rateLimitWindowSeconds,
          now: now(),
        });
        if (!rateLimit.allowed) {
          return sendError(response, 429, context, {
            error: "rate_limited",
            message: "Too many rich text polish requests",
            retryAfterSeconds: rateLimit.retryAfterSeconds,
          });
        }
      } catch {
        return sendError(response, 503, context, {
          error: "dependency_unavailable",
          message: "Rate limit store is unavailable",
          dependency: "redis",
        });
      }
    }

    try {
      const polished = await polishRichText({
        request: validation.request,
        provider: richTextPolishProvider,
        session: auth.session,
        requestId: context.requestId,
      });
      await writeAiCache(aiCacheStore, cacheKey, polished, "rich_text:polish", now);

      return sendJson(
        response,
        200,
        {
          status: "ok",
          requestId: context.requestId,
          result: polished.result,
          usage: polished.usage,
        },
        context,
      );
    } catch (error) {
      if (error instanceof RichTextPolishProviderError) {
        return sendError(response, error.code === "provider_timeout" ? 504 : 503, context, {
          error: error.code,
          message: error.message,
          dependency: error.code === "dependency_unavailable" ? "provider" : undefined,
        });
      }
      return sendError(response, 500, context, {
        error: "internal_error",
        message: error instanceof Error ? error.message : "Internal error",
      });
    }
  }

  if (url.pathname === "/v1/agent/chat") {
    if (method !== "POST") return methodNotAllowed(response, context, "POST");

    const auth = await authenticateAgentRequest({
      authorizationHeader: headerValue(request.headers.authorization),
      expectedScope: "agent:chat",
      config,
      replayStore,
      now: now(),
    });

    if (!auth.ok) {
      logAuthFailure(auth, context, url.pathname, method);
      return sendError(response, auth.statusCode, context, {
        error: auth.error,
        message: auth.message,
        dependency: auth.dependency,
      });
    }

    const body = await readJsonBody(request);
    if (!body.ok) {
      return sendError(response, 400, context, {
        error: "bad_request",
        message: body.message,
      });
    }

    const validation = validateAgentMessageRequest(body.value);
    if (!validation.ok) {
      return sendError(response, validation.statusCode, context, {
        error: validation.error,
        message: validation.message,
      });
    }

    if (!agentMessageRequestMatchesSession(auth.session, validation.request)) {
      return sendError(response, 403, context, {
        error: "forbidden",
        message: "Token resumeId does not match request resumeId",
      });
    }

    const storedSnapshot = await loadAgentSessionSnapshotForRequest({
      sessionStore,
      request: validation.request,
      session: auth.session,
      context,
    });
    const agentRequest = agentRequestWithStoreSnapshot(
      validation.request,
      storedSnapshot,
    );

    const threadId = agentMessageThreadId(agentRequest);
    const cacheResumeId = agentMessageCacheResumeId(agentRequest);

    const requestModelName = agentRequest.modelConfig?.modelName ?? config.modelName;
    const activeAgentMessageProvider =
      agentRequest.modelConfig
        ? createOpenAICompatibleAgentMessageProvider(
            {
              ...config,
              modelBaseUrl: agentRequest.modelConfig.baseUrl,
              modelApiKey: agentRequest.modelConfig.apiKey,
              modelName: agentRequest.modelConfig.modelName,
            },
          )
        : agentMessageProvider;

    if (!activeAgentMessageProvider) {
      return sendError(response, 503, context, {
        error: "dependency_unavailable",
        message: "Agent message provider is not configured",
        dependency: "provider",
      });
    }

    if (
      acceptsAgUiSse(request)
    ) {
      const loopModel = resolveLoopModel(agentRequest, config);
      if (loopModel) {
        return streamAgentLoopEvents({
        response,
        context,
        request: agentRequest,
        requestId: context.requestId,
        threadId,
        model: loopModel,
        accept: headerValue(request.headers.accept),
        telemetry: {
          isEnabled: config.langfuse.enabled,
          functionId: "agent.loop",
          metadata: {
            requestId: context.requestId,
            provider: "ai-sdk/openai-compatible",
            mode: agentRequest.mode ?? "create_from_zero",
          },
        },
        recorder: createSessionRecorderForRequest({
          sessionStore,
          request: agentRequest,
          session: auth.session,
          requestId: context.requestId,
          now,
          initialSnapshot: storedSnapshot,
          context,
        }),
      });
    }
  }

    return observability.traceAgentMessageRun(
      {
        request: agentRequest,
        session: auth.session,
        requestId: context.requestId,
        cacheStatus: "miss",
      },
      async (trace) => {
        const cacheKey = buildScopedCacheKey({
          scope: "agent:chat",
          session: auth.session,
          resumeId: cacheResumeId,
          config,
          input: safeAgentCacheInput(agentRequest),
          modelName: agentRequest.modelConfig?.modelName,
        });
        const cached = await readAiCache<AgentMessageCacheValue>(
          aiCacheStore,
          cacheKey,
        );
        if (cached) {
          trace.recordCache("hit");
          trace.recordParseResult(agentMessageCacheParseTrace(cached.value));
          trace.recordRunOutput(agentMessageCacheRunOutput(cached.value));

          return sendAgUiEvents(
            response,
            toAgUiAgentEvents({
              requestId: context.requestId,
              threadId,
              request: agentRequest,
              result: {
                message: cached.value.message,
                toolCalls: cached.value.toolCalls,
                proposedOperations: cached.value.proposedOperations,
                ...(cached.value.questions ? { questions: cached.value.questions } : {}),
              },
            }),
            context,
            headerValue(request.headers.accept),
            createSessionRecorderForRequest({
              sessionStore,
              request: agentRequest,
              session: auth.session,
              requestId: context.requestId,
              now,
              initialSnapshot: storedSnapshot,
              context,
            }),
          );
        }
        trace.recordCache("miss");

        if (rateLimitStore) {
          try {
            const rateLimit = await checkRateLimit({
              redis: rateLimitStore,
              scope: "agent:chat",
              identityHash: hashIdentity(auth.session.userId),
              limit: config.rateLimitMaxRequests,
              windowSeconds: config.rateLimitWindowSeconds,
              now: now(),
            });
            if (!rateLimit.allowed) {
              trace.recordRunOutput({
                status: "error",
                error: "Too many Agent chat requests",
              });
              return sendError(response, 429, context, {
                error: "rate_limited",
                message: "Too many Agent chat requests",
                retryAfterSeconds: rateLimit.retryAfterSeconds,
              });
            }
          } catch {
            trace.recordRunOutput({
              status: "error",
              error: "Rate limit store is unavailable",
            });
            return sendError(response, 503, context, {
              error: "dependency_unavailable",
              message: "Rate limit store is unavailable",
              dependency: "redis",
            });
          }
        }

        const prompt = await agentMessagePromptResolver.resolve({
          ...agentRequest,
          requestId: context.requestId,
        });

        try {
          if (acceptsAgUiSse(request)) {
            // === True Agent Loop Path ===
            // AI SDK streamText + tools loop over DraftState sandbox.
            const draft = createInitialLoopDraft(agentRequest);
            const modelSettings = agentRequest.modelConfig
              ? {
                  baseUrl: agentRequest.modelConfig.baseUrl,
                  apiKey: agentRequest.modelConfig.apiKey,
                  modelName: agentRequest.modelConfig.modelName,
                }
              : {
                  baseUrl: config.modelBaseUrl,
                  apiKey: config.modelApiKey,
                  modelName: config.modelName,
                } as { baseUrl: string; apiKey: string; modelName: string };

            const sessionRecorder = createSessionRecorderForRequest({
              sessionStore,
              request: agentRequest,
              session: auth.session,
              requestId: context.requestId,
              now,
              initialSnapshot: storedSnapshot,
              context,
            });
            const loopModel = createLoopModel(modelSettings);

            try {
              const loopResult = await runResumeLoop({
              model: loopModel,
              request: agentRequest,
              draft,
              maxSteps: LOOP_MAX_STEPS,
              onStepFinish: (stepEvent) => {
                for (const { toolCall, proposedOperations } of stepEvent.toolCalls) {
                  if (sessionRecorder) {
                    sessionRecorder.record({
                      type: EventType.TOOL_CALL_START,
                      toolCallId: toolCall.id,
                      toolCallName: toolCall.name,
                      parentMessageId: `msg_${context.requestId}`,
                    });
                    sessionRecorder.record({
                      type: EventType.TOOL_CALL_ARGS,
                      toolCallId: toolCall.id,
                      delta: JSON.stringify(toolCall.input),
                    });
                    sessionRecorder.record({
                      type: EventType.TOOL_CALL_END,
                      toolCallId: toolCall.id,
                    });
                    sessionRecorder.record({
                      type: EventType.TOOL_CALL_RESULT,
                      messageId: `${toolCall.id}_result`,
                      toolCallId: toolCall.id,
                      role: "tool",
                      content: JSON.stringify({ toolCall, proposedOperations }),
                    });
                    }
                }
              },
              telemetry: config.langfuse.enabled
                ? {
                    isEnabled: true,
                    functionId: "agent.loop",
                    metadata: {
                      requestId: context.requestId,
                      provider: "ai-sdk/openai-compatible",
                      mode: agentRequest.mode ?? "optimize_existing",
                    },
                  }
                : undefined,
            });

            // Write AI cache
            const assembleId = randomUUID();
            const parsedResult = assembleLoopResult({
              draft,
              finalText: loopResult.text,
              requestId: assembleId,
            });

            const cacheValue: AgentMessageCacheValue = {
              message: parsedResult.message,
              toolCalls: parsedResult.toolCalls,
              proposedOperations: parsedResult.proposedOperations,
              usage: { provider: "ai-sdk/openai-compatible", model: modelSettings.modelName, inputTokens: 0, outputTokens: 0 },
            };
            await writeAiCache(aiCacheStore, cacheKey, cacheValue, "agent:chat", now);

            // Handle resume_ask interrupt
            if (loopResult.isAskPending) {
              const askTc = draft.toolCalls.find((tc) => tc.name === "resume_ask");
              const question = askTc?.input?.question
                ? String(askTc.input.question)
                : "请补充更多信息";
              const field = askTc?.input?.field
                ? String(askTc.input.field)
                : undefined;

              const workspace = buildAgentResumeWorkspace({
                request: agentRequest,
                requestId: context.requestId,
                result: parsedResult,
              });

              return sendAgUiEvents(
                response,
                buildAgUiAskInterruptEvents({
                  requestId: context.requestId,
                  threadId,
                  question,
                  field,
                  workspace,
                }),
                context,
                headerValue(request.headers.accept),
                sessionRecorder,
              );
            }

            const tailEvents = buildWorkflowRuntimeEvents({
              requestId: context.requestId,
              threadId,
              request: agentRequest,
              result: parsedResult,
            });
            const filtered = workflowRuntimeEventsToAgUiEvents(
              tailEvents.filter(
                (event) =>
                  event.type !== "run_started" &&
                  event.type !== "state_snapshot" &&
                  event.type !== "assistant_text_delta",
              ),
            );
            return sendAgUiEvents(
              response,
              filtered,
            context,
            headerValue(request.headers.accept),
            sessionRecorder,
          );
            } catch (loopErr) {
              const msg = loopErr instanceof Error ? loopErr.message : "Agent loop failed";
              return sendAgUiEvents(
                response,
                toAgUiRunErrorEvents({
                  requestId: context.requestId,
                  threadId,
                  message: msg,
                  code: "dependency_unavailable",
                }),
                context,
                headerValue(request.headers.accept),
              );
            }
          }
        } catch (error) {
          if (error instanceof RichTextPolishProviderError) {
            trace.recordRunOutput({ status: "error", error: error.message });
            if (acceptsAgUiSse(request)) {
              return sendAgUiEvents(
                response,
                toAgUiRunErrorEvents({
                  requestId: context.requestId,
                  threadId,
                  message: error.message,
                  code: error.code,
                }),
                context,
                headerValue(request.headers.accept),
              );
            }

            return sendError(
              response,
              error.code === "provider_timeout" ? 504 : 503,
              context,
              {
                error: error.code,
                message: error.message,
                dependency:
                  error.code === "dependency_unavailable" ? "provider" : undefined,
              },
            );
          }
          const message =
            error instanceof Error ? error.message : "Provider request failed";
          trace.recordRunOutput({ status: "error", error: message });
          if (acceptsAgUiSse(request)) {
            return sendAgUiEvents(
              response,
              toAgUiRunErrorEvents({
                requestId: context.requestId,
                threadId,
                message,
                code: "dependency_unavailable",
              }),
              context,
              headerValue(request.headers.accept),
            );
          }

          return sendError(response, 500, context, {
            error: "internal_error",
            message: error instanceof Error ? error.message : "Internal error",
          });
        }
      },
    );
  }

  const resumeHelperMatch = url.pathname.match(/^\/v1\/resume\/helpers\/([^/]+)$/);
  if (resumeHelperMatch) {
    if (method !== "POST") return methodNotAllowed(response, context, "POST");
    const helperId = decodeURIComponent(resumeHelperMatch[1]);

    const auth = await authenticateAgentRequest({
      authorizationHeader: headerValue(request.headers.authorization),
      expectedScope: "resume:helper",
      config,
      replayStore,
      now: now(),
    });

    if (!auth.ok) {
      logAuthFailure(auth, context, url.pathname, method);
      return sendError(response, auth.statusCode, context, {
        error: auth.error,
        message: auth.message,
        dependency: auth.dependency,
      });
    }

    const body = await readJsonBody(request);
    if (!body.ok) {
      return sendError(response, 400, context, {
        error: "bad_request",
        message: body.message,
      });
    }

    const validation = validateResumeHelperRequest(helperId, body.value);
    if (!validation.ok) {
      return sendError(response, validation.statusCode, context, {
        error: validation.error,
        message: validation.message,
      });
    }

    if (auth.session.resumeId !== validation.request.resumeId) {
      return sendError(response, 403, context, {
        error: "forbidden",
        message: "Token resumeId does not match request resumeId",
      });
    }

    if (!resumeHelperProvider) {
      return sendError(response, 503, context, {
        error: "dependency_unavailable",
        message: "Resume helper provider is not configured",
        dependency: "provider",
      });
    }

    const cacheKey = buildScopedCacheKey({
      scope: "resume:helper",
      session: auth.session,
      resumeId: validation.request.resumeId,
      config,
      input: validation.request,
    });
    const cached = await readAiCache<ResumeHelperCacheValue>(
      aiCacheStore,
      cacheKey,
    );
    if (cached) {
      return sendJson(
        response,
        200,
        {
          status: "ok",
          requestId: context.requestId,
          helperId: cached.value.helperId,
          result: cached.value.result,
          usage: cached.value.usage,
          cached: true,
          cachedAt: cached.createdAt,
        },
        context,
      );
    }

    if (rateLimitStore) {
      try {
        const rateLimit = await checkRateLimit({
          redis: rateLimitStore,
          scope: "resume:helper",
          identityHash: hashIdentity(auth.session.userId),
          limit: config.rateLimitMaxRequests,
          windowSeconds: config.rateLimitWindowSeconds,
          now: now(),
        });
        if (!rateLimit.allowed) {
          return sendError(response, 429, context, {
            error: "rate_limited",
            message: "Too many resume helper requests",
            retryAfterSeconds: rateLimit.retryAfterSeconds,
          });
        }
      } catch {
        return sendError(response, 503, context, {
          error: "dependency_unavailable",
          message: "Rate limit store is unavailable",
          dependency: "redis",
        });
      }
    }

    const prompt = buildResumeHelperPrompt({
      ...validation.request,
      requestId: context.requestId,
    });

    try {
      const providerResult = await resumeHelperProvider.run({
        request: validation.request,
        prompt,
        session: auth.session,
        requestId: context.requestId,
      });
      const parsed = parseResumeHelperProviderResponse(providerResult.content);
      if (!parsed.ok) {
        return sendError(response, 503, context, {
          error: "dependency_unavailable",
          message: parsed.message,
          dependency: "provider",
        });
      }
      const cacheValue: ResumeHelperCacheValue = {
        helperId: validation.request.helperId,
        result: parsed.result,
        usage: providerResult.usage,
      };
      await writeAiCache(aiCacheStore, cacheKey, cacheValue, "resume:helper", now);

      return sendJson(
        response,
        200,
        {
          status: "ok",
          requestId: context.requestId,
          helperId: validation.request.helperId,
          result: parsed.result,
          usage: providerResult.usage,
        },
        context,
      );
    } catch (error) {
      if (error instanceof RichTextPolishProviderError) {
        return sendError(response, error.code === "provider_timeout" ? 504 : 503, context, {
          error: error.code,
          message: error.message,
          dependency: error.code === "dependency_unavailable" ? "provider" : undefined,
        });
      }
      return sendError(response, 500, context, {
        error: "internal_error",
        message: error instanceof Error ? error.message : "Internal error",
      });
    }
  }

  return sendError(response, 404, context, {
    error: "not_found",
    message: "Route not found",
  });
}

function buildScopedCacheKey({
  scope,
  session,
  resumeId,
  config,
  input,
  modelName,
}: {
  scope: AiCacheScope;
  session: AuthenticatedAgentSession;
  resumeId: string;
  config: AgentConfig;
  input: unknown;
  modelName?: string;
}): string {
  return buildAiCacheKey({
    scope,
    userId: session.userId,
    resumeId,
    modelName: modelName ?? config.modelName,
    input,
  });
}

const CREATE_FROM_ZERO_THREAD_ID = "agent_create_from_zero";

function agentMessageRequestMatchesSession(
  session: AuthenticatedAgentSession,
  request: AgentMessageRequest,
): boolean {
  if (request.resumeId === null) {
    if (session.resumeId !== undefined) return false;
  } else if (session.resumeId !== request.resumeId) {
    return false;
  }

  const sessionContext = request.sessionContext;
  if (!sessionContext) return true;
  if (sessionContext.resumeId !== request.resumeId) return false;
  if (sessionContext.mode !== (request.mode ?? "optimize_existing")) return false;
  if (sessionContext.workflowId !== request.workflowId) return false;

  return (
    sessionContext.sessionId ===
    deriveAgentSessionId({
      resumeId: request.resumeId,
      userId: session.userId,
      threadId: sessionContext.threadId,
    })
  );
}

function agentMessageThreadId(request: AgentMessageRequest): string {
  return request.sessionContext?.threadId ?? request.resumeId ?? CREATE_FROM_ZERO_THREAD_ID;
}

function agentMessageCacheResumeId(request: AgentMessageRequest): string {
  return request.sessionContext?.sessionId ?? request.resumeId ?? CREATE_FROM_ZERO_THREAD_ID;
}

async function loadAgentSessionSnapshotForRequest({
  sessionStore,
  request,
  session,
  context,
}: {
  sessionStore: AgentSessionStore | undefined;
  request: AgentMessageRequest;
  session: AuthenticatedAgentSession;
  context: RequestContext;
}) {
  if (!sessionStore || !request.sessionContext) return null;
  try {
    return await sessionStore.loadSnapshot({
      session,
      context: request.sessionContext,
    });
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "agent_session_snapshot_load_failed",
        requestId: context.requestId,
        sessionId: request.sessionContext.sessionId,
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    return null;
  }
}

function createSessionRecorderForRequest({
  sessionStore,
  request,
  session,
  requestId,
  now,
  initialSnapshot,
  context,
}: {
  sessionStore: AgentSessionStore | undefined;
  request: AgentMessageRequest;
  session: AuthenticatedAgentSession;
  requestId: string;
  now: () => Date;
  initialSnapshot: Awaited<ReturnType<typeof loadAgentSessionSnapshotForRequest>>;
  context: RequestContext;
}): AgentSessionRecorder | null {
  if (!sessionStore || !request.sessionContext) return null;
  return createAgentSessionRecorder({
    store: sessionStore,
    session,
    context: request.sessionContext,
    runId: requestId,
    now,
    initialSnapshot,
    onError: (error) => {
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "agent_session_persist_failed",
          requestId: context.requestId,
          sessionId: request.sessionContext?.sessionId,
          message: error instanceof Error ? error.message : "Unknown error",
        }),
      );
    },
  });
}

function safeAgentCacheInput(request: AgentMessageRequest): unknown {
  const { modelConfig: _modelConfig, ...safeRequest } = request;
  void _modelConfig;
  return {
    ...safeRequest,
    modelConfig: request.modelConfig
      ? {
          baseUrlHash: hashIdentity(request.modelConfig.baseUrl),
          modelName: request.modelConfig.modelName,
        }
      : undefined,
  };
}

async function readAiCache<T>(
  store: AiCacheStore | undefined,
  key: string,
): Promise<AiCacheEntry<T> | null> {
  if (!store) return null;

  try {
    return await store.get<T>(key);
  } catch {
    return null;
  }
}

async function writeAiCache<T>(
  store: AiCacheStore | undefined,
  key: string,
  value: T,
  scope: AiCacheScope,
  now: () => Date,
): Promise<void> {
  if (!store) return;

  try {
    await store.set(
      key,
      {
        createdAt: now().toISOString(),
        value,
      },
      getAiCacheTtlSeconds(scope),
    );
  } catch {
    // Cache writes should never turn a successful model call into a failed request.
  }
}

function sendStatus(
  response: ServerResponse,
  status: HealthStatus,
  config: AgentConfig,
  now: () => Date,
  uptimeSeconds: () => number,
  context: RequestContext,
): void {
  sendJson(
    response,
    200,
    {
      status,
      service: config.serviceName,
      version: config.version,
      uptimeSeconds: uptimeSeconds(),
      timestamp: now().toISOString(),
      ...(status === "ready"
        ? {
            dependencies: {
              redis: "ready",
            },
          }
        : {}),
    },
    context,
  );
}

function sendAgentSession(
  response: ServerResponse,
  session: AuthenticatedAgentSession,
  context: RequestContext,
): void {
  sendJson(
    response,
    200,
    {
      status: "ok",
      subject: session.userId,
      resumeId: session.resumeId ?? null,
      scope: session.scope,
      expiresAt: session.expiresAt.toISOString(),
      requestId: context.requestId,
    },
    context,
  );
}

function methodNotAllowed(
  response: ServerResponse,
  context: RequestContext,
  allow = "GET",
): void {
  response.setHeader("Allow", allow);
  sendError(response, 405, context, {
    error: "method_not_allowed",
    message: "Method not allowed",
  });
}

function sendError(
  response: ServerResponse,
  statusCode: number,
  context: RequestContext,
  error: {
    error: Parameters<typeof createErrorEnvelope>[0]["error"];
    message: string;
    dependency?: string;
    retryAfterSeconds?: number;
  },
): void {
  sendJson(
    response,
    statusCode,
    createErrorEnvelope({
      ...error,
      requestId: context.requestId,
    }),
    context,
  );
}

function sendCorsPreflight(
  response: ServerResponse,
  context: RequestContext,
): void {
  response.statusCode = context.corsHeaders ? 204 : 403;
  response.setHeader("X-Request-Id", context.requestId);
  applyCorsHeaders(response, context);
  response.setHeader("Content-Length", "0");
  response.end();
}

function resolveCorsHeaders(
  request: IncomingMessage,
  config: AgentConfig,
): Record<string, string> | null {
  const origin = headerValue(request.headers.origin);
  if (!origin || !config.corsOrigins.includes(origin)) return null;
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization,content-type,accept,x-request-id",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function applyCorsHeaders(
  response: ServerResponse,
  context: RequestContext,
): void {
  if (!context.corsHeaders) return;
  for (const [key, value] of Object.entries(context.corsHeaders)) {
    response.setHeader(key, value);
  }
}

function logAuthFailure(
  auth: {
    statusCode: number;
    error: string;
    message: string;
    dependency?: string;
    diagnosticReason?: string;
  },
  context: RequestContext,
  path: string,
  method: string,
): void {
  console.warn(
    JSON.stringify({
      level: "warn",
      event: "agent_auth_failure",
      requestId: context.requestId,
      path,
      method,
      statusCode: auth.statusCode,
      error: auth.error,
      message: auth.message,
      ...(auth.dependency ? { dependency: auth.dependency } : {}),
      ...(auth.diagnosticReason
        ? { diagnosticReason: auth.diagnosticReason }
        : {}),
    }),
  );
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
  context: RequestContext,
): void {
  const payload = JSON.stringify(body);

  response.statusCode = statusCode;
  response.setHeader("X-Request-Id", context.requestId);
  applyCorsHeaders(response, context);
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(payload));
  response.end(payload);
}

async function sendAgUiEvents(
  response: ServerResponse,
  events: BaseEvent[],
  context: RequestContext,
  accept?: string,
  recorder?: AgentSessionRecorder | null,
): Promise<void> {
  const encoder = new EventEncoder({ accept });

  response.statusCode = 200;
  response.setHeader("X-Request-Id", context.requestId);
  applyCorsHeaders(response, context);
  response.setHeader("Content-Type", encoder.getContentType());
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.flushHeaders();

  for (const event of events) {
    recorder?.record(event);
    response.write(encoder.encodeBinary(event));
    if (event.type === EventType.TEXT_MESSAGE_CONTENT) {
      await delay(12);
    }
  }
  await recorder?.close();
  response.end();
}

async function streamAgentMessageEvents({
  response,
  context,
  provider,
  request,
  prompt,
  session,
  requestId,
  cacheKey,
  aiCacheStore,
  now,
  accept,
  trace,
  modelName,
  recorder,
}: {
  response: ServerResponse;
  context: RequestContext;
  provider: AgentMessageProvider;
  request: AgentMessageRequest;
  prompt: AgentMessagePrompt;
  session: AuthenticatedAgentSession;
  requestId: string;
  cacheKey: string;
  aiCacheStore: AiCacheStore | undefined;
  now: () => Date;
  accept?: string;
  trace: AgentMessageTrace;
  modelName?: string;
  recorder?: AgentSessionRecorder | null;
}): Promise<void> {
  const encoder = new EventEncoder({ accept });
  const threadId = agentMessageThreadId(request);
  const messageId = `msg_${requestId}`;
  let content = "";
  let emittedContent = "";
  let usage: AgentMessageUsage = {
    provider: "unknown",
    model: "unknown",
    inputTokens: 0,
    outputTokens: 0,
  };
  let textStarted = false;

  response.statusCode = 200;
  response.setHeader("X-Request-Id", requestId);
  applyCorsHeaders(response, context);
  response.setHeader("Content-Type", encoder.getContentType());
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.flushHeaders();

  const writeEvent = (event: BaseEvent) => {
    recorder?.record(event);
    response.write(encoder.encodeBinary(event));
  };

  writeEvent({ type: EventType.RUN_STARTED, threadId, runId: requestId });
  writeEvent({
    type: EventType.STATE_SNAPSHOT,
    snapshot: {
      contextStatus: request.sessionSnapshot?.contextStatus ?? null,
      workspace: request.sessionSnapshot?.workspace ?? null,
      workflow: request.sessionSnapshot?.workflow ?? {
        workflowId: request.workflowId,
        nodeId: "intake_goal",
        loopCount: 0,
        completedNodeIds: [],
      },
    },
  });
  const contextStatusEvents: BaseEvent[] = [];
  appendAgUiContextStatusEvents(contextStatusEvents, {
    messageId: `msg_context_${requestId}`,
    status: buildAgentContextStatus(request),
  });
  for (const event of contextStatusEvents) {
    writeEvent(event);
  }

  try {
    await trace.traceGeneration(
      {
        modelName,
        provider: "ai-sdk/openai-compatible",
        prompt,
      },
      async () => {
        for await (const chunk of provider.stream!({
          request,
          prompt,
          session,
          requestId,
        })) {
          if (chunk.type === "usage") {
            usage = chunk.usage;
            continue;
          }

          content += chunk.delta;
          const visibleContent = extractStreamingAgentMessageContent(content);
          const delta = visibleContent.slice(emittedContent.length);
          if (!delta) continue;

          if (!textStarted) {
            writeEvent({
              type: EventType.TEXT_MESSAGE_START,
              messageId,
              role: "assistant",
            });
            textStarted = true;
          }
          writeEvent({
            type: EventType.TEXT_MESSAGE_CONTENT,
            messageId,
            delta,
          });
          emittedContent = visibleContent;
        }

        return { content, usage };
      },
    );

    const parsed = parseAgentMessageProviderResponse(content, { requestId });
    if (!parsed.ok) {
      trace.recordParseResult({ ok: false, message: parsed.message });
      trace.recordRunOutput({ status: "error", error: parsed.message });
      writeEvent({
        type: EventType.RUN_ERROR,
        threadId,
        runId: requestId,
        message: parsed.message,
        code: "dependency_unavailable",
      });
      await recorder?.close();
      response.end();
      return;
    }
    trace.recordParseResult(agentMessageResultParseTrace(parsed.result));

    const remainingContent = parsed.result.message.content.slice(
      emittedContent.length,
    );
    if (!textStarted) {
      writeEvent({
        type: EventType.TEXT_MESSAGE_START,
        messageId,
        role: "assistant",
      });
      textStarted = true;
    }
    if (remainingContent) {
      writeEvent({
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId,
        delta: remainingContent,
      });
    }

    const cacheValue: AgentMessageCacheValue = {
      message: parsed.result.message,
      toolCalls: parsed.result.toolCalls,
      proposedOperations: parsed.result.proposedOperations,
      ...(parsed.result.questions ? { questions: parsed.result.questions } : {}),
      usage,
    };
    await writeAiCache(aiCacheStore, cacheKey, cacheValue, "agent:chat", now);
    trace.recordRunOutput(agentMessageResultRunOutput(parsed.result));

    for (const event of toStreamingRuntimeTailEvents({
      requestId,
      threadId,
      request,
      messageId,
      result: parsed.result,
    })) {
      writeEvent(event);
    }
    await recorder?.close();
    response.end();
  } catch (error) {
    trace.recordRunOutput({
      status: "error",
      error: error instanceof Error ? error.message : "Provider request failed",
    });
    writeEvent({
      type: EventType.RUN_ERROR,
      threadId,
      runId: requestId,
      message: error instanceof Error ? error.message : "Provider request failed",
      code:
        error instanceof RichTextPolishProviderError
          ? error.code
          : "dependency_unavailable",
    });
    await recorder?.close();
    response.end();
  }
}

function resolveLoopModel(
  request: AgentMessageRequest,
  config: AgentConfig,
): ReturnType<typeof createLoopModel> | null {
  const settings = request.modelConfig
    ? {
        baseUrl: request.modelConfig.baseUrl,
        apiKey: request.modelConfig.apiKey,
        modelName: request.modelConfig.modelName,
      }
    : config.modelBaseUrl && config.modelApiKey && config.modelName
      ? {
          baseUrl: config.modelBaseUrl,
          apiKey: config.modelApiKey,
          modelName: config.modelName,
        }
      : null;
  return settings ? createLoopModel(settings) : null;
}

async function streamAgentLoopEvents({
  response,
  context,
  request,
  requestId,
  threadId,
  model,
  accept,
  telemetry,
  recorder,
}: {
  response: ServerResponse;
  context: RequestContext;
  request: AgentMessageRequest;
  requestId: string;
  threadId: string;
  model: ReturnType<typeof createLoopModel>;
  accept?: string;
  telemetry?: TelemetrySettings;
  recorder?: AgentSessionRecorder | null;
}): Promise<void> {
  const encoder = new EventEncoder({ accept });
  const messageId = `msg_${requestId}`;
  let textStarted = false;

  response.statusCode = 200;
  response.setHeader("X-Request-Id", requestId);
  applyCorsHeaders(response, context);
  response.setHeader("Content-Type", encoder.getContentType());
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.flushHeaders();

  const writeEvent = (event: BaseEvent) => {
    recorder?.record(event);
    response.write(encoder.encodeBinary(event));
  };

  writeEvent({ type: EventType.RUN_STARTED, threadId, runId: requestId });
  writeEvent({
    type: EventType.STATE_SNAPSHOT,
    snapshot: {
      contextStatus: request.sessionSnapshot?.contextStatus ?? null,
      workspace: request.sessionSnapshot?.workspace ?? null,
      workflow: request.sessionSnapshot?.workflow ?? {
        workflowId: request.workflowId,
        nodeId: "intake_goal",
        loopCount: 0,
        completedNodeIds: [],
      },
    },
  });
  const contextStatusEvents: BaseEvent[] = [];
  appendAgUiContextStatusEvents(contextStatusEvents, {
    messageId: `msg_context_${requestId}`,
    status: buildAgentContextStatus(request),
  });
  for (const event of contextStatusEvents) {
    writeEvent(event);
  }

  const ensureTextStarted = () => {
    if (textStarted) return;
    writeEvent({
      type: EventType.TEXT_MESSAGE_START,
      messageId,
      role: "assistant",
    });
    textStarted = true;
  };

  const draft = createInitialLoopDraft(request);
  try {
    const { text } = await runResumeLoop({
      model,
      request,
      draft,
      telemetry,
      onTextDelta: (delta) => {
        ensureTextStarted();
        writeEvent({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta });
      },
    });
    ensureTextStarted();

    const result = assembleLoopResult({ draft, finalText: text, requestId });
    for (const event of toStreamingRuntimeTailEvents({
      requestId,
      threadId,
      request,
      messageId,
      result,
    })) {
      writeEvent(event);
    }
    await recorder?.close();
    response.end();
  } catch (error) {
    writeEvent({
      type: EventType.RUN_ERROR,
      threadId,
      runId: requestId,
      message: error instanceof Error ? error.message : "Agent loop failed",
      code: "dependency_unavailable",
    });
    await recorder?.close();
    response.end();
  }
}

function toStreamingRuntimeTailEvents({
  requestId,
  threadId,
  request,
  messageId,
  result,
}: {
  requestId: string;
  threadId: string;
  request: AgentMessageRequest;
  messageId: string;
  result: Extract<AgentMessageParseResult, { ok: true }>["result"];
}): BaseEvent[] {
  return toAgUiAgentEvents({
    requestId,
    threadId,
    request,
    result: {
      ...result,
      message: {
        ...result.message,
        id: messageId,
      },
    },
  }).filter((event) => {
    if (
      event.type === EventType.RUN_STARTED ||
      event.type === EventType.STATE_SNAPSHOT ||
      event.type === EventType.TEXT_MESSAGE_START ||
      event.type === EventType.TEXT_MESSAGE_CONTENT
    ) {
      return false;
    }

    if (event.type === EventType.ACTIVITY_SNAPSHOT) {
      return (event as { activityType?: unknown }).activityType !== "context_status";
    }

    if (event.type === EventType.STATE_DELTA) {
      const delta = (event as { delta?: unknown }).delta;
      if (!Array.isArray(delta)) return true;
      return !delta.every(
        (patch) => isRecord(patch) && patch.path === "/contextStatus",
      );
    }

    return true;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toAgUiRunErrorEvents({
  requestId,
  threadId,
  message,
  code,
}: {
  requestId: string;
  threadId: string;
  message: string;
  code: string;
}): BaseEvent[] {
  return [
    { type: EventType.RUN_STARTED, threadId, runId: requestId },
    { type: EventType.RUN_ERROR, threadId, runId: requestId, message, code },
  ];
}

function agentMessageResultParseTrace(result: {
  toolCalls: AgentToolCall[];
  proposedOperations: ResumeOperation[];
}): AgentMessageParseTrace {
  return {
    ok: true,
    toolCallCount: result.toolCalls.length,
    proposedOperationCount: result.proposedOperations.length,
    interruptReasons:
      result.proposedOperations.length > 0 ? ["approval_required"] : [],
  };
}

function agentMessageResultRunOutput(result: {
  toolCalls: AgentToolCall[];
  proposedOperations: ResumeOperation[];
}) {
  return {
    status: "ok" as const,
    toolCallCount: result.toolCalls.length,
    proposedOperationCount: result.proposedOperations.length,
  };
}

function agentMessageCacheParseTrace(
  cacheValue: AgentMessageCacheValue,
): AgentMessageParseTrace {
  return agentMessageResultParseTrace({
    toolCalls: cacheValue.toolCalls,
    proposedOperations: cacheValue.proposedOperations,
  });
}

function agentMessageCacheRunOutput(cacheValue: AgentMessageCacheValue) {
  return agentMessageResultRunOutput({
    toolCalls: cacheValue.toolCalls,
    proposedOperations: cacheValue.proposedOperations,
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function resolveRequestId(
  request: IncomingMessage,
  createRequestId: () => string,
): string {
  const incoming = request.headers["x-request-id"];
  const requestId = Array.isArray(incoming) ? incoming[0] : incoming;

  if (requestId && requestId.trim() !== "") {
    return requestId;
  }

  return createRequestId();
}

function headerValue(header: string | string[] | undefined): string | undefined {
  return Array.isArray(header) ? header[0] : header;
}

function acceptsAgUiSse(request: IncomingMessage): boolean {
  const accept = headerValue(request.headers.accept);
  return Boolean(accept?.split(",").some((value) => {
    const mediaType = value.split(";")[0]?.trim().toLowerCase();
    return mediaType === "text/event-stream";
  }));
}

function defaultCreateRequestId(): string {
  return `req_${randomUUID()}`;
}

async function readJsonBody(
  request: IncomingMessage,
): Promise<{ ok: true; value: unknown } | { ok: false; message: string }> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return { ok: false, message: "Request body is required" };

  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, message: "Request body must be valid JSON" };
  }
}

function hashIdentity(identity: string): string {
  return createHash("sha256").update(identity).digest("hex").slice(0, 24);
}
