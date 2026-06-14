import type {
  AgentMessageParseResult,
  AgentMessageRequest,
  AgentQuestionRequest,
  AgentWorkflowCursor,
} from "../agent-messages.js";
import type { AgentToolCall, ResumeOperation } from "../agent-tools.js";
import {
  buildAgentContextStatus,
  type AgentContextStatusSnapshot,
} from "./context-status.js";
import {
  buildAgentResumeWorkspace,
  type AgentResumeWorkspaceSnapshot,
} from "./resume-workspace.js";

type ParsedAgentResult = Extract<
  AgentMessageParseResult,
  { ok: true }
>["result"];

export type AgentWorkflowRunOutcome =
  | { type: "success" }
  | {
      type: "interrupt";
      interrupts: AgentWorkflowInterrupt[];
    };

export type AgentWorkflowInterrupt =
  | {
      id: string;
      reason: "input_required";
      message: string;
      responseSchema: Record<string, unknown>;
      metadata: { kind: "question"; field: string | null };
    }
  | {
      id: string;
      reason: "approval_required";
      message: string;
      toolCallId: string;
      metadata: { operation: ResumeOperation };
    };

export type AgentWorkflowRuntimeEvent =
  | { type: "run_started"; requestId: string; threadId: string }
  | {
      type: "state_snapshot";
      snapshot: {
        contextStatus: AgentContextStatusSnapshot | null;
        workspace: AgentResumeWorkspaceSnapshot | null;
        workflow: AgentWorkflowCursor;
      };
    }
  | {
      type: "context_status";
      messageId: string;
      status: AgentContextStatusSnapshot;
    }
  | { type: "assistant_text_delta"; messageId: string; delta: string }
  | { type: "tool_started"; messageId: string; toolCall: AgentToolCall }
  | {
      type: "tool_result";
      messageId: string;
      toolCall: AgentToolCall;
      proposedOperations: ResumeOperation[];
    }
  | {
      type: "workspace_snapshot";
      messageId: string;
      workspace: AgentResumeWorkspaceSnapshot;
    }
  | {
      type: "workflow_cursor";
      cursor: AgentWorkflowCursor;
    }
  | { type: "message_end"; messageId: string }
  | {
      type: "run_finished";
      requestId: string;
      threadId: string;
      outcome: AgentWorkflowRunOutcome;
    };

export function buildWorkflowRuntimeEvents({
  requestId,
  threadId,
  request,
  result,
}: {
  requestId: string;
  threadId: string;
  request?: AgentMessageRequest;
  result: ParsedAgentResult;
}): AgentWorkflowRuntimeEvent[] {
  const messageId = result.message.id;
  const outcome = buildWorkflowRunOutcome(result);
  const events: AgentWorkflowRuntimeEvent[] = [
    { type: "run_started", requestId, threadId },
  ];

  if (request) {
    events.push({
      type: "state_snapshot",
      snapshot: {
        contextStatus: request.sessionSnapshot?.contextStatus ?? null,
        workspace: request.sessionSnapshot?.workspace ?? null,
        workflow: request.sessionSnapshot?.workflow ?? initialWorkflowCursor(request),
      },
    });
    events.push({
      type: "context_status",
      messageId: `msg_context_${requestId}`,
      status: buildAgentContextStatus(request),
    });
  }

  for (const delta of splitRuntimeTextDeltas(result.message.content)) {
    events.push({ type: "assistant_text_delta", messageId, delta });
  }

  for (const toolCall of result.toolCalls) {
    events.push({ type: "tool_started", messageId, toolCall });
    events.push({
      type: "tool_result",
      messageId: `${toolCall.id}_result`,
      toolCall,
      proposedOperations: result.proposedOperations.filter(
        (operation) => operation.toolCallId === toolCall.id,
      ),
    });
  }

  if (request) {
    events.push({
      type: "workspace_snapshot",
      messageId: `msg_workspace_${requestId}`,
      workspace: buildAgentResumeWorkspace({ request, requestId, result }),
    });
    events.push({
      type: "workflow_cursor",
      cursor: buildWorkflowCursor({ request, result }),
    });
  }

  events.push({ type: "message_end", messageId });
  events.push({
    type: "run_finished",
    requestId,
    threadId,
    outcome,
  });

  return events;
}

function buildWorkflowCursor({
  request,
  result,
}: {
  request: AgentMessageRequest;
  result: ParsedAgentResult;
}): AgentWorkflowCursor {
  const previous = request.sessionSnapshot?.workflow ?? initialWorkflowCursor(request);
  const completedNodeIds = previous.completedNodeIds.includes(previous.nodeId)
    ? previous.completedNodeIds
    : [...previous.completedNodeIds, previous.nodeId];

  return {
    workflowId: request.workflowId ?? previous.workflowId,
    nodeId: nextWorkflowNodeId(result),
    loopCount: previous.loopCount + 1,
    completedNodeIds,
  };
}

function initialWorkflowCursor(request: AgentMessageRequest): AgentWorkflowCursor {
  return {
    workflowId: request.workflowId,
    nodeId: "intake_goal",
    loopCount: 0,
    completedNodeIds: [],
  };
}

function nextWorkflowNodeId(result: ParsedAgentResult): string {
  if ((result.questions ?? []).length > 0) return "await_user_input";
  if (result.proposedOperations.length > 0) return "await_change_approval";
  return "final_review";
}

function buildWorkflowRunOutcome(
  result: ParsedAgentResult,
): AgentWorkflowRunOutcome {
  const questionInterrupts = (result.questions ?? []).map(toQuestionInterrupt);
  const approvalInterrupts = result.proposedOperations.map((operation) => ({
    id: operation.id,
    reason: "approval_required" as const,
    message: `${operation.label}: ${operation.changeSummary}`,
    toolCallId: operation.toolCallId,
    metadata: { operation },
  }));

  const interrupts = [...questionInterrupts, ...approvalInterrupts];
  if (interrupts.length === 0) return { type: "success" };

  return {
    type: "interrupt",
    interrupts,
  };
}

function toQuestionInterrupt(
  question: AgentQuestionRequest,
): AgentWorkflowInterrupt {
  return {
    id: question.id,
    reason: "input_required",
    message: question.message,
    responseSchema: question.responseSchema ?? defaultQuestionResponseSchema(),
    metadata: {
      kind: "question",
      field: question.field ?? null,
    },
  };
}

function defaultQuestionResponseSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      answer: { type: "string", minLength: 1 },
    },
    required: ["answer"],
  };
}

function splitRuntimeTextDeltas(content: string): string[] {
  const characters = Array.from(content);
  if (characters.length <= 18) return [content];

  const deltas: string[] = [];
  for (let index = 0; index < characters.length; index += 18) {
    deltas.push(characters.slice(index, index + 18).join(""));
  }
  return deltas;
}
