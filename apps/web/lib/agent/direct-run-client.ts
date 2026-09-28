/**
 * panel 的运行请求只打到 Next.js 的 `/api/agent/direct-runs`。
 *
 * 这个函数曾经在拿到引导 JSON 之后，用 JWT 去请求独立 Agent 服务。
 * 那一跳已经去掉：响应是什么就原样返回，不再读取 streamUrl。
 */
export async function openPanelRunStream({
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

  return fetchFn("/api/agent/direct-runs", {
    method: "POST",
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
    },
    body: runBody,
    signal: requestInit.signal,
  });
}
