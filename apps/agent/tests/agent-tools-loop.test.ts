import { describe, expect, it } from "vitest";

import { createPreview, previewSnapshot } from "../src/agent/preview.js";
import { createAgentTools, type ResumeReader } from "../src/agent/tools.js";

const toolOptions = { toolCallId: "tool_1", messages: [] } as never;

describe("agent tools", () => {
  it("read_resume returns the injected real resume (read-only)", async () => {
    const preview = createPreview();
    const readResume: ResumeReader = async () => ({
      title: "我的简历",
      content: { basics: { summary: "x" } },
    });
    const tools = createAgentTools({ preview, readResume });
    const out = await tools.read_resume.execute!({}, toolOptions);
    expect(out).toMatchObject({ exists: true, title: "我的简历" });
  });

  it("read_resume reports when no resume exists", async () => {
    const tools = createAgentTools({ preview: createPreview(), readResume: async () => null });
    const out = await tools.read_resume.execute!({}, toolOptions);
    expect(out).toEqual({ exists: false });
  });

  it("upsert_section writes to the preview, not the database", async () => {
    const preview = createPreview();
    const tools = createAgentTools({ preview, readResume: async () => null });
    const out = await tools.upsert_section.execute!(
      { section: "summary", fieldPath: "basics.summary", label: "个人简介", afterPlainText: "三年后端经验" },
      toolOptions,
    );
    expect(out).toMatchObject({ ok: true, fieldPath: "basics.summary" });
    expect(previewSnapshot(preview).profileSummary).toBe("三年后端经验");
    expect(preview.operations).toHaveLength(1);
  });

  it("set_goal records title/targetRole on the preview", async () => {
    const preview = createPreview();
    const tools = createAgentTools({ preview, readResume: async () => null });
    await tools.set_goal.execute!({ title: "后端简历", targetRole: "后端工程师" }, toolOptions);
    expect(preview.title).toBe("后端简历");
    expect(preview.targetRole).toBe("后端工程师");
  });

  it("ask_user is human-in-the-loop (no execute)", () => {
    const tools = createAgentTools({ preview: createPreview(), readResume: async () => null });
    expect(tools.ask_user.execute).toBeUndefined();
  });
});
