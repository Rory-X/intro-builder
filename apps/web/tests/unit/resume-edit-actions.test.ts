import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { emptyResumeContent } from "@intro-builder/shared/schemas";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/db", () => ({
  db: {
    update: vi.fn(),
  },
}));

import { auth } from "@/lib/auth";
import { db } from "@/db";
import { saveResume } from "@/app/(app)/resume/[id]/edit/actions";

describe("saveResume", () => {
  beforeEach(() => vi.clearAllMocks());

  it("persists rich text font size marks through the server action", async () => {
    (auth as unknown as Mock).mockResolvedValue({ user: { id: "u1" } });
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where });
    (db.update as unknown as Mock).mockReturnValue({ set });

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
});
