import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

// db mock：insert(收藏) / delete(取消) / select(读列表) 三条链路，每个用例
// 用 mockReturnValue 装好需要的形状。
vi.mock("@/db", () => ({
  db: {
    insert: vi.fn(),
    delete: vi.fn(),
    select: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { auth } from "@/lib/auth";
import { db } from "@/db";
import { revalidatePath } from "next/cache";
import {
  toggleTemplateFavorite,
  getFavoriteTemplateIds,
} from "@/app/(app)/templates/actions";

function setupInsert() {
  const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoNothing });
  (db.insert as unknown as Mock).mockReturnValue({ values });
  return { values, onConflictDoNothing };
}

function setupDelete() {
  const where = vi.fn().mockResolvedValue(undefined);
  (db.delete as unknown as Mock).mockReturnValue({ where });
  return { where };
}

describe("toggleTemplateFavorite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (auth as unknown as Mock).mockResolvedValue({ user: { id: "u1" } });
  });

  it("favorite=true：insert 收藏行并 onConflictDoNothing（连点不报错）", async () => {
    const { values, onConflictDoNothing } = setupInsert();

    const res = await toggleTemplateFavorite("professional", true);

    expect(res).toEqual({ success: true });
    expect(values).toHaveBeenCalledWith({ userId: "u1", templateId: "professional" });
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
    expect(db.delete as unknown as Mock).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/templates");
  });

  it("收藏模板 id 不依赖 templates 表（纯字符串写入，无外键路径）", async () => {
    const { values } = setupInsert();

    await toggleTemplateFavorite("classic", true);

    // 直接把 templateId 当字符串写入，证明 action 不对 templates 表做任何校验/JOIN
    expect(values).toHaveBeenCalledWith({ userId: "u1", templateId: "classic" });
  });

  it("favorite=false：delete 对应收藏行", async () => {
    const { where } = setupDelete();

    const res = await toggleTemplateFavorite("modern", false);

    expect(res).toEqual({ success: true });
    expect(where).toHaveBeenCalledTimes(1);
    expect(db.insert as unknown as Mock).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/templates");
  });

  it("未鉴权：返回 success:false（不抛错），且不碰 DB", async () => {
    (auth as unknown as Mock).mockResolvedValue(null);

    const res = await toggleTemplateFavorite("professional", true);

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/unauthorized/);
    expect(db.insert as unknown as Mock).not.toHaveBeenCalled();
    expect(db.delete as unknown as Mock).not.toHaveBeenCalled();
  });
});

describe("getFavoriteTemplateIds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("返回该用户收藏的 templateId 数组", async () => {
    const where = vi
      .fn()
      .mockResolvedValue([{ templateId: "professional" }, { templateId: "abbey-stub" }]);
    const from = vi.fn().mockReturnValue({ where });
    (db.select as unknown as Mock).mockReturnValue({ from });

    const ids = await getFavoriteTemplateIds("u1");

    expect(ids).toEqual(["professional", "abbey-stub"]);
  });
});
