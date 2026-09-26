/**
 * 从请求体读取模型配置（P05 任务 5）。
 *
 * 三条约束，逐条对应一个真实问题：
 *
 * 1. **配置随请求传，服务端不落库**。浏览器从 session 里取当前 key 随请求带上，
 *    服务端只在本次调用内使用 —— 落库会让用户的密钥进入我们的存储，
 *    而 BYOK 的语义是「用户自带、我们用完即弃」。
 * 2. **缺少配置时明确告知，不回退已退役的服务**。旧实现会转发到 Agent 微服务，
 *    那个服务正是本切片要退役的对象。回退会让「退役」永远无法完成，
 *    也会让用户看到「明明没配模型却能润色」这种难以解释的行为。
 * 3. **不信任形状**。三个字段都必须是去空白后的非空字符串；
 *    地址策略由 `validateProviderUrl` 单独负责（它更严格：https、公网、非 metadata）。
 */

type ModelConfigLike = {
  baseUrl?: unknown;
  apiKey?: unknown;
  modelName?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** 解析结果。`null` 表示配置缺失或不完整。 */
export type RequestModelConfig = {
  baseUrl: string;
  apiKey: string;
  modelName: string;
};

/**
 * 从请求体里取模型配置。
 *
 * 接受 `modelConfig` 字段（与浮窗、启动路由一致），保持各入口形状统一 ——
 * 前端不需要为不同能力记住不同的字段名。
 */
export function readModelConfigFromRequest(body: unknown): RequestModelConfig | null {
  if (!isRecord(body)) return null;
  const raw = body.modelConfig;
  if (!isRecord(raw)) return null;

  const config = raw as ModelConfigLike;
  const baseUrl = nonEmptyString(config.baseUrl);
  const apiKey = nonEmptyString(config.apiKey);
  const modelName = nonEmptyString(config.modelName);
  if (!baseUrl || !apiKey || !modelName) return null;

  return { baseUrl, apiKey, modelName };
}
