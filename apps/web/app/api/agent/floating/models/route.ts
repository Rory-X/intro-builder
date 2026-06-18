import OpenAI from "openai";

import { currentUserId } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type FloatingModelsBody = {
  baseUrl?: string;
  apiKey?: string;
};

type ModelListResponse = {
  data?: Array<{ id?: unknown }>;
};

export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) {
    return Response.json({ error: "未登录" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as FloatingModelsBody | null;
  const baseUrl = body?.baseUrl?.trim();
  const apiKey = body?.apiKey?.trim();
  if (!baseUrl || !apiKey) {
    return Response.json(
      { error: "请填写模型服务地址和访问密钥" },
      { status: 400 },
    );
  }

  try {
    const client = new OpenAI({ apiKey, baseURL: baseUrl });
    const response = (await client.models.list()) as ModelListResponse;
    const seen = new Set<string>();
    const models =
      response.data
        ?.map((model) => (typeof model.id === "string" ? model.id.trim() : ""))
        .filter((id) => {
          if (!id || seen.has(id)) return false;
          seen.add(id);
          return true;
        })
        .map((id) => ({ id, label: id })) ?? [];

    return Response.json({ models });
  } catch {
    return Response.json(
      { error: "获取模型失败，请检查服务地址和访问密钥" },
      { status: 502 },
    );
  }
}
