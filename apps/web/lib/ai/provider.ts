import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { stepCountIs, streamText, type ModelMessage, type ToolSet } from "ai";

import { assertServerRuntime } from "./server-guard";
import { validateProviderUrl } from "./provider-policy";
import type { SdkStreamPart } from "./stream-adapter";

/**
 * Provider 装配层（P04 任务 2 + 7）。
 *
 * 把「用户填的 BYOK 配置」变成编排层可用的 `streamModel`。这一层是**唯一**
 * 把用户可控的 URL 与 apiKey 交给网络的地方，因此它的职责刻意收窄为三件事：
 *
 * 1. **出站前校验**。地址必须先过 `validateProviderUrl`（默认拒绝：非 https、
 *    userinfo、本机/内网/metadata）。校验不通过就**不创建 provider、不发起请求** ——
 *    先把 SDK 客户端建出来再校验，等于已经把一个 SSRF 原语递了出去。
 * 2. **密钥不外泄**。错误信息里可能带上完整 URL（其中可能含 query 形式的 key），
 *    因此这里统一改写错误消息，只保留脱敏后的主机名。
 * 3. **预算与取消必须真的透传**。`abortSignal` 传丢 → 取消无效；
 *    `maxSteps` 传丢 → 步数无上限。两者都不会报错，只会「表现得很奇怪」。
 *
 * 本模块**不做**协议解释：SDK 的 `fullStream` 片段原样透出，由
 * `stream-adapter` 负责翻译成业务事件。两个转换点会让同一段流被解释两遍。
 */

assertServerRuntime("lib/ai/provider.ts");

/** 用户自带模型配置。字段与 `lib/agent/model-settings-storage.ts` 一致。 */
export type ProviderConfig = {
  baseUrl: string;
  apiKey: string;
  modelName: string;
};

/** 初始化结果。失败时只给出可安全展示的 code 与 message。 */
export type ProviderInitResult =
  | { ok: true; streamModel: ProviderStreamModel }
  | { ok: false; code: string; message: string };

/** 与 `RunDeps["streamModel"]` 的形状一致，可直接注入编排层。 */
export type ProviderStreamModel = (input: {
  system: string;
  messages: unknown[];
  tools: unknown;
  abortSignal: AbortSignal;
  maxSteps: number;
}) => AsyncIterable<SdkStreamPart>;

/**
 * 错误脱敏：把消息里出现的 apiKey 与完整 baseUrl 换掉。
 *
 * 必要性：SDK / fetch 的错误常把目标 URL 拼进消息，而 BYOK 的 baseUrl 允许
 * 带 query（有些代理用 `?key=`）。这些字符串会流进日志与响应，
 * 等于把用户的密钥写进可观测系统。
 */
function redact(message: string, config: ProviderConfig): string {
  let out = message;
  if (config.apiKey) {
    // 全局替换：同一密钥可能在消息里出现多次。
    out = out.split(config.apiKey).join("[已脱敏]");
  }
  if (config.baseUrl) {
    out = out.split(config.baseUrl).join(sanitizeHost(config.baseUrl));
  }
  return out;
}

/** 只保留协议与主机名，丢掉路径与 query（它们可能含凭据）。 */
function sanitizeHost(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "[已脱敏的地址]";
  }
}

/** 把任意抛出物转成脱敏后的 Error。 */
function toRedactedError(error: unknown, config: ProviderConfig): Error {
  const raw = error instanceof Error ? error.message : String(error);
  return new Error(`模型调用失败：${redact(raw, config)}`);
}

/**
 * 创建 `streamModel`。
 *
 * 配置不合法时返回 `{ ok: false }` 而**不抛异常**：调用方（路由）需要把
 * 「配置错误」变成 4xx 响应，而不是让它冒泡成 500 —— 那是用户输入问题，
 * 不是服务端故障。
 */
export function createProviderStreamer(config: ProviderConfig): ProviderInitResult {
  const baseUrl = config.baseUrl?.trim() ?? "";
  const apiKey = config.apiKey?.trim() ?? "";
  const modelName = config.modelName?.trim() ?? "";

  if (!baseUrl) return { ok: false, code: "missing_base_url", message: "请填写模型服务地址" };
  if (!apiKey) return { ok: false, code: "missing_api_key", message: "请填写模型服务密钥" };
  if (!modelName) return { ok: false, code: "missing_model_name", message: "请填写模型名称" };

  /*
   * 校验必须在**创建 provider 之前**。
   *
   * 这里不是「先建好再检查」—— 创建 SDK 客户端本身没有网络行为，但一旦有人
   * 后续在别处提前发起请求，校验就形同虚设。把校验放在构造路径的最前面，
   * 让「不合法的地址不可能存在一个可用的 streamModel」成为结构性事实。
   */
  const policy = validateProviderUrl(baseUrl);
  if (!policy.ok) {
    return { ok: false, code: policy.code, message: policy.message };
  }

  const normalized: ProviderConfig = { baseUrl, apiKey, modelName };

  const provider = createOpenAICompatible({
    name: "intro-ai-run-openai-compatible",
    baseURL: baseUrl,
    apiKey,
    includeUsage: true,
  });

  const streamModel: ProviderStreamModel = (input) => {
    /*
     * 用生成器包装而不是直接返回 `streamText(...).fullStream`。
     *
     * 原因：`streamText()` 抛出的错误发生在**调用时**，而此时调用方已经在
     * 编排层的 `for await` 里。用生成器能让两类错误走同一条路（都在迭代中抛出），
     * 并在这里统一脱敏 —— 返回裸 stream 的话，同步抛出会绕过包装。
     */
    return (async function* () {
      let fullStream: AsyncIterable<SdkStreamPart>;
      try {
        const result = streamText({
          model: provider(modelName),
          temperature: 0.2,
          system: input.system,
          messages: input.messages as ModelMessage[],
          /*
           * 用 `ToolSet` 而不是 `as never`：后者会把泛型推成 `never`，
           * 连带让 `stopWhen` 的类型不匹配（实测 `TS2322`）。
           * 工具的具体类型由 `lib/ai/tools/registry.ts` 在装配时保证，
           * 这里只需要「一组具名工具」这个事实。
           */
          tools: input.tools as ToolSet,
          /*
           * 步数预算。传丢会变成「模型可以无限调用工具」——
           * 不会报错，只会烧额度直到平台超时，因此这里显式绑定。
           */
          stopWhen: stepCountIs(input.maxSteps),
          /*
           * 取消信号。这是「关闭连接 / 点取消能让模型停下」的唯一来源；
           * 数据库 fence 只拦提交，不拦已经在跑的模型调用。
           */
          abortSignal: input.abortSignal,
        });
        fullStream = result.fullStream as AsyncIterable<SdkStreamPart>;
      } catch (error) {
        throw toRedactedError(error, normalized);
      }

      try {
        for await (const part of fullStream) {
          yield part;
        }
      } catch (error) {
        throw toRedactedError(error, normalized);
      }
    })();
  };

  return { ok: true, streamModel };
}
