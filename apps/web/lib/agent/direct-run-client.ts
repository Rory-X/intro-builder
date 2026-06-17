import type { AgentMessageRequest } from "@intro-builder/shared/types";

export type AgentDirectRunBootstrap = {
  status: "ok";
  streamUrl: string;
  token: string;
  tokenExpiresAt: string;
  request: AgentMessageRequest;
};

export async function fetchDirectAgentRunStream({
  requestUrl,
  requestInit,
  fetchFn = fetch,
  directEnabled = process.env.NODE_ENV !== "test",
}: {
  requestUrl: RequestInfo | URL;
  requestInit: RequestInit;
  fetchFn?: typeof fetch;
  directEnabled?: boolean;
}): Promise<Response> {
  const runBody = requestInit.body;
  if (!directEnabled || typeof runBody !== "string") {
    return fetchFn(requestUrl, requestInit);
  }

  try {
    const bootstrapResponse = await fetchFn("/api/agent/direct-runs", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: runBody,
      signal: requestInit.signal,
    });
    if (isEventStreamResponse(bootstrapResponse)) {
      return bootstrapResponse;
    }
    if (!bootstrapResponse.ok) {
      return fetchFn(requestUrl, requestInit);
    }

    const bootstrap = await readDirectRunBootstrap(bootstrapResponse);
    if (!bootstrap) {
      return fetchFn(requestUrl, requestInit);
    }

    const directResponse = await fetchFn(bootstrap.streamUrl, {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        Authorization: `Bearer ${bootstrap.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(bootstrap.request),
      signal: requestInit.signal,
    });

    if (!directResponse.ok) {
      return directResponse;
    }

    return directResponse;
  } catch (error) {
    if (isAbortError(error)) throw error;
    return fetchFn(requestUrl, requestInit);
  }
}

function isEventStreamResponse(response: Response): boolean {
  return (response.headers.get("content-type") ?? "").includes("text/event-stream");
}

async function readDirectRunBootstrap(
  response: Response,
): Promise<AgentDirectRunBootstrap | null> {
  try {
    const body = await response.json();
    if (!isRecord(body)) return null;
    if (body.status !== "ok") return null;
    if (typeof body.streamUrl !== "string" || body.streamUrl.trim() === "") {
      return null;
    }
    if (typeof body.token !== "string" || body.token.trim() === "") return null;
    if (typeof body.tokenExpiresAt !== "string") return null;
    if (!isRecord(body.request)) return null;
    return body as AgentDirectRunBootstrap;
  } catch {
    return null;
  }
}

function isAbortError(value: unknown): boolean {
  return value instanceof Error && value.name === "AbortError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
