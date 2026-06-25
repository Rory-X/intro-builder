import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { emptyResumeContent } from "@intro-builder/shared/schemas";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/db", () => ({
  db: {
    update: vi.fn(),
    select: vi.fn(),
  },
}));

import { auth } from "@/lib/auth";
import { db } from "@/db";
import { saveResume } from "@/app/(app)/resume/[id]/edit/actions";

describe("saveResume", () => {
  beforeEach(() => vi.clearAllMocks());

  it("persists rich text font size marks through the server action", async () => {
    (auth as unknown as Mock).mockResolvedValue({ user: { id: "u1" } });
    const returning = vi.fn().mockResolvedValue([{ id: "r1" }]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    (db.update as unknown as Mock).mockReturnValue({ set });
    const selectWhere = vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue([
        {
          title: "title",
          content: {
            ...emptyResumeContent(),
            projects: [{
              name: "P",
              role: "",
              location: "",
              start: "",
              end: "",
              stack: [],
              link: "",
              content: {
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      {
                        type: "text",
                        text: "Hello",
                        marks: [{ type: "textStyle", attrs: { fontSize: "12px" } }],
                      },
                    ],
                  },
                ],
              },
            }],
          },
        },
      ]),
    });
    const from = vi.fn().mockReturnValue({ where: selectWhere });
    (db.select as unknown as Mock).mockReturnValue({ from });

    const content = emptyResumeContent();
    content.projects = [{
      name: "P",
      role: "",
      location: "",
      start: "",
      end: "",
      stack: [],
      link: "",
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Hello",
                marks: [{ type: "textStyle", attrs: { fontSize: "12px" } }],
              },
            ],
          },
        ],
      },
    }];

    await saveResume("r1", content, "title");

    expect(set).toHaveBeenCalled();
    expect(JSON.stringify(set.mock.calls[0][0].content)).toContain('"fontSize":"12px"');
  });

  it("rejects when the resume update does not affect any row", async () => {
    (auth as unknown as Mock).mockResolvedValue({ user: { id: "u1" } });
    const returning = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    (db.update as unknown as Mock).mockReturnValue({ set });

    await expect(saveResume("missing", emptyResumeContent(), "title")).rejects.toThrow(
      "not found",
    );
    expect(db.select).not.toHaveBeenCalled();
  });

  it("rejects when the saved content readback does not match the requested content", async () => {
    (auth as unknown as Mock).mockResolvedValue({ user: { id: "u1" } });
    const returning = vi.fn().mockResolvedValue([{ id: "r1" }]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    (db.update as unknown as Mock).mockReturnValue({ set });
    const savedContent = emptyResumeContent();
    savedContent.basics.name = "old value";
    const selectWhere = vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue([
        {
          title: "title",
          content: savedContent,
        },
      ]),
    });
    const from = vi.fn().mockReturnValue({ where: selectWhere });
    (db.select as unknown as Mock).mockReturnValue({ from });
    const nextContent = emptyResumeContent();
    nextContent.basics.name = "new value";

    await expect(saveResume("r1", nextContent, "title")).rejects.toThrow(
      "save verification failed",
    );
  });
});
