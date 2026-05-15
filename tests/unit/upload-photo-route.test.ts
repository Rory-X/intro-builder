import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@vercel/blob", () => ({ put: vi.fn() }));

import { auth } from "@/lib/auth";
import { PUT } from "@/app/api/upload-photo/route";

function photoRequest(file: File): Request {
  const form = new FormData();
  form.set("file", file);
  return new Request("http://localhost/api/upload-photo", {
    method: "PUT",
    body: form,
  });
}

describe("upload photo route", () => {
  const originalToken = process.env.BLOB_READ_WRITE_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.BLOB_READ_WRITE_TOKEN;
  });

  afterEach(() => {
    process.env.BLOB_READ_WRITE_TOKEN = originalToken;
  });

  it("requires authentication", async () => {
    (auth as unknown as Mock).mockResolvedValue(null);

    const response = await PUT(photoRequest(new File(["x"], "avatar.png", { type: "image/png" })));

    expect(response.status).toBe(401);
  });

  it("returns a 503 configuration error when Blob is not configured", async () => {
    (auth as unknown as Mock).mockResolvedValue({ user: { id: "u1" } });

    const response = await PUT(photoRequest(new File(["x"], "avatar.png", { type: "image/png" })));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toMatch(/BLOB_READ_WRITE_TOKEN/);
  });
});
