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
  loadResumeVersionForRestore,
} from "@/app/(app)/resume/[id]/edit/actions";

function selectRows(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy, limit });
  const from = vi.fn().mockReturnValue({ where });
  (db.select as unknown as Mock).mockReturnValue({ from });
  return { from, where, orderBy, limit };
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

  it("读取待恢复的历史版本时只做读取与校验，不直接写库", async () => {
    /*
     * 旧实现是「先 insert 备份版本 → 再 update 正文」两条独立 SQL。
     * 那让恢复成为第二个不受 revision 保护的写入口，也让「备份」与「正文变更」
     * 可能各自成功一半。现在这个 action 只负责读，写入统一交给提交模块
     * （见 submitResumeVersionRestore 与 commitResumeRestore）。
     *
     * 因此这里断言的是「读到了正确内容」且**没有发生写入** —— 写入路径一旦被
     * 重新加回到这个函数里，set/insert 就会被调用，测试立刻失败。
     */
    const content = emptyResumeContent();
    content.basics.name = "历史姓名";
    selectRows([
      {
        id: "v1",
        resumeId: "r1",
        userId: "u1",
        title: "历史简历",
        templateId: "professional",
        content,
      },
    ]);
    const set = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    (db.update as unknown as Mock).mockReturnValue({ set });
    const values = vi.fn().mockResolvedValue(undefined);
    (db.insert as unknown as Mock).mockReturnValue({ values });

    const restored = await loadResumeVersionForRestore("r1", "v1");

    expect(restored.title).toBe("历史简历");
    expect(restored.templateId).toBe("professional");
    expect(restored.content.basics.name).toBe("历史姓名");
    // 关键：这个函数不得再写库。
    expect(set).not.toHaveBeenCalled();
    expect(values).not.toHaveBeenCalled();
  });
});
