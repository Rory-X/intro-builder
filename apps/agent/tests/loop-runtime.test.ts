import type { streamText } from "ai";
import { describe, expect, it } from "vitest";

import type { AgentMessageRequest } from "../src/agent-messages";
import { validateAgentToolOutput } from "../src/agent-tools";
import { createDraft, upsertSection } from "../src/workflows/draft";
import {
  assembleLoopResult,
  buildLoopSystemPrompt,
  createInitialLoopDraft,
  runResumeLoop,
} from "../src/workflows/loop-runtime";

function createFromZeroRequest(): AgentMessageRequest {
  return {
    resumeId: null,
    mode: "create_from_zero",
    locale: "zh-CN",
    workflowId: "create-from-zero",
    messages: [{ id: "m1", role: "user", content: "帮我从零做一份后端工程师简历" }],
    context: null,
  };
}

describe("loop runtime", () => {
  it("assembles draft operations into a standard parse result", () => {
    const draft = createDraft();
    upsertSection(draft, {
      toolCallId: "call_1",
      section: "experience",
      fieldPath: "experience.0.content",
      label: "后端工程师 · 蜂鸟科技",
      afterPlainText: "用 Kubernetes 把发布回滚从 15min 降到 90s。",
    });

    const result = assembleLoopResult({
      draft,
      finalText: "已为你起草工作经历，请预览。",
      requestId: "req_1",
    });

    expect(result.message.content).toBe("已为你起草工作经历，请预览。");
    expect(result.message.id).toBe("msg_req_1");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.proposedOperations).toHaveLength(1);
    expect(result.draftResume?.sections).toHaveLength(1);

    const validation = validateAgentToolOutput({
      toolCalls: result.toolCalls,
      proposedOperations: result.proposedOperations,
    });
    expect(validation.ok).toBe(true);
  });

  it("drives tools against the shared draft and streams visible text", async () => {
    const request = createFromZeroRequest();
    const draft = createInitialLoopDraft(request);
    const deltas: string[] = [];

    // Fake streamText: invokes a write tool (mutating the shared draft), then
    // streams two visible text deltas — simulating one AI SDK loop step.
    const fakeStreamText = ((options: {
      tools: { upsert_section: { execute: (i: unknown, o: unknown) => Promise<unknown> } };
    }) => ({
      textStream: (async function* () {
        await options.tools.upsert_section.execute(
          {
            section: "summary",
            fieldPath: "basics.summary",
            label: "个人简介",
            afterPlainText: "三年后端经验，擅长 Go 与云原生。",
          },
          { toolCallId: "call_1" },
        );
        yield "已为你";
        yield "起草个人简介。";
      })(),
    })) as unknown as typeof streamText;

    const result = await runResumeLoop({
      model: {} as never,
      request,
      draft,
      onTextDelta: (delta) => deltas.push(delta),
      streamTextImpl: fakeStreamText,
    });

    expect(result.text).toBe("已为你起草个人简介。");
    expect(deltas).toEqual(["已为你", "起草个人简介。"]);
    expect(draft.operations).toHaveLength(1);
    expect(draft.operations[0].fieldPath).toBe("basics.summary");
  });

  it("falls back to a default message when the model streams no text", async () => {
    const request = createFromZeroRequest();
    const draft = createInitialLoopDraft(request);
    const fakeStreamText = (() => ({
      // eslint-disable-next-line require-yield
      textStream: (async function* () {})(),
    })) as unknown as typeof streamText;

    const result = await runResumeLoop({
      model: {} as never,
      request,
      draft,
      streamTextImpl: fakeStreamText,
    });
    expect(result.text).toContain("草稿");
  });

  it("system prompt frames a create-from-zero draft sandbox", () => {
    const prompt = buildLoopSystemPrompt(createFromZeroRequest());
    expect(prompt).toContain("从零创建");
    expect(prompt).toContain("草稿");
    expect(prompt).toContain("zh-CN");
  });
});
