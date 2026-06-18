import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

vi.mock("@/lib/auth-helpers", () => ({ currentUserId: vi.fn() }));

const listMock = vi.fn();

vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(function MockOpenAI() {
    return {
      models: {
        list: listMock,
      },
    };
  }),
}));

import OpenAI from "openai";
import { currentUserId } from "@/lib/auth-helpers";
import { POST, runtime } from "@/app/api/agent/floating/models/route";

describe("POST /api/agent/floating/models", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the Node runtime", () => {
    expect(runtime).toBe("nodejs");
  });

  it("requires a Web user session", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue(null);

    const response = await POST(jsonRequest(validBody()));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "未登录" });
  });

  it("requires model service address and access key", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");

    const response = await POST(jsonRequest({ baseUrl: "", apiKey: "" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "请填写模型服务地址和访问密钥",
    });
    expect(OpenAI).not.toHaveBeenCalled();
    expect(listMock).not.toHaveBeenCalled();
  });

  it("lists models using only the request-scoped connection settings", async () => {
    (currentUserId as unknown as Mock).mockResolvedValue("user_123");
    listMock.mockResolvedValue({
      data: [
        { id: "gpt-4.1-mini" },
        { id: "gpt-4.1" },
        { id: "" },
        { id: "gpt-4.1-mini" },
      ],
    });

    const response = await POST(jsonRequest(validBody()));

    expect(response.status).toBe(200);
    expect(OpenAI).toHaveBeenCalledWith({
      apiKey: "sk-request",
      baseURL: "https://models.example.test/v1",
    });
    expect(listMock).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({
      models: [
        { id: "gpt-4.1-mini", label: "gpt-4.1-mini" },
        { id: "gpt-4.1", label: "gpt-4.1" },
      ],
    });
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/agent/floating/models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validBody() {
  return {
    baseUrl: "https://models.example.test/v1",
    apiKey: "sk-request",
  };
}
