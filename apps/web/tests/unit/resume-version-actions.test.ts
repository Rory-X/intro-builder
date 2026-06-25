import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { emptyResumeContent } from "@intro-builder/shared/schemas";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/db", () => ({
  db: {
    insert: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
  },
}));

import { auth } from "@/lib/auth";
import { db } from "@/db";
import {
  createResumeVersion,
  listResumeVersions,
  restoreResumeVersion,
} from "@/app/(app)/resume/[id]/edit/actions";

function selectRows(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy, limit });
  const from = vi.fn().mockReturnValue({ where });
  (db.select as unknown as Mock).mockReturnValue({ from });
  return { from, where, orderBy, limit };
}

function selectRowsSequence(...rowSets: unknown[][]) {
  for (const rows of rowSets) {
    const limit = vi.fn().mockResolvedValue(rows);
    const orderBy = vi.fn().mockReturnValue({ limit });
    const where = vi.fn().mockReturnValue({ orderBy, limit });
    const from = vi.fn().mockReturnValue({ where });
    (db.select as unknown as Mock).mockReturnValueOnce({ from });
  }
}

describe("resume version actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (auth as unknown as Mock).mockResolvedValue({ user: { id: "u1", name: "文希" } });
  });

  it("creates a version snapshot after validating ownership and content", async () => {
    selectRows([{ id: "r1", userId: "u1" }]);
    const values = vi.fn().mockResolvedValue(undefined);
    (db.insert as unknown as Mock).mockReturnValue({ values });

    const content = emptyResumeContent();
    const result = await createResumeVersion({
      resumeId: "r1",
      title: "我的简历",
      templateId: "professional",
      content,
      source: "agent",
      operationCount: 2,
      summary: "AI 修改了 2 处内容",
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeId: "r1",
        userId: "u1",
        title: "我的简历",
        templateId: "professional",
        content,
        source: "agent",
        actorName: "文希",
        operationCount: 2,
        summary: "AI 修改了 2 处内容",
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        resumeId: "r1",
        source: "agent",
        sourceLabel: "通过对话",
        actorName: "文希",
        operationCount: 2,
        summary: "AI 修改了 2 处内容",
        createdAt: expect.any(String),
      }),
    );
  });

  it("lists version metadata with Chinese source labels", async () => {
    const createdAt = new Date("2026-06-23T02:18:00.000Z");
    selectRows([
      {
        id: "v1",
        resumeId: "r1",
        source: "agent",
        actorName: "Mem",
        operationCount: 1,
        summary: "AI 修改",
        createdAt,
      },
    ]);

    await expect(listResumeVersions("r1")).resolves.toEqual([
      {
        id: "v1",
        resumeId: "r1",
        source: "agent",
        sourceLabel: "通过对话",
        actorName: "Mem",
        operationCount: 1,
        summary: "AI 修改",
        createdAt: createdAt.toISOString(),
      },
    ]);
  });

  it("restores a historical version and creates a new restore version", async () => {
    const content = emptyResumeContent();
    content.basics.name = "历史姓名";
    const currentContent = emptyResumeContent();
    currentContent.basics.name = "当前姓名";
    selectRowsSequence(
      [
        {
          id: "v1",
          resumeId: "r1",
          userId: "u1",
          title: "历史简历",
          templateId: "professional",
          content,
        },
      ],
      [
        {
          title: "当前简历",
          templateId: "professional",
          content: currentContent,
        },
      ],
    );
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where: updateWhere });
    (db.update as unknown as Mock).mockReturnValue({ set });
    const values = vi.fn().mockResolvedValue(undefined);
    (db.insert as unknown as Mock).mockReturnValue({ values });

    await restoreResumeVersion("r1", "v1");

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "历史简历",
        templateId: "professional",
        content,
      }),
    );
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        resumeId: "r1",
        userId: "u1",
        title: "当前简历",
        content: currentContent,
        source: "restore",
        parentVersionId: "v1",
        operationCount: 1,
        summary: "恢复历史版本前自动备份",
      }),
    );
  });

  it("rejects unauthenticated version access", async () => {
    (auth as unknown as Mock).mockResolvedValue(null);

    await expect(listResumeVersions("r1")).rejects.toThrow(/unauthorized/);
  });
});
