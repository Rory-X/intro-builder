import { render, screen, waitFor, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ResumeContent } from "@intro-builder/shared/schemas";
import { MentorEditorClient } from "@/components/collab/mentor-editor-client";

let messageHandler: ((message: Record<string, unknown>) => void) | null = null;

vi.mock("@/hooks/use-collab-provider", () => ({
  useCollabProvider: () => ({
    ydoc: {},
    provider: {},
    isConnected: true,
    presenceUsers: [
      { userId: "owner", displayName: "作者", role: "owner", color: "#2563EB" },
      { userId: "mentor", displayName: "导师", role: "mentor", color: "#8B5CF6" },
    ],
    sendJson: vi.fn(),
    addJsonMessageListener: (handler: (message: Record<string, unknown>) => void) => {
      messageHandler = handler;
      return () => {
        messageHandler = null;
      };
    },
  }),
}));

vi.mock("@/hooks/use-collab-form-sync", () => ({
  useCollabFormSync: () => ({
    highlightedFields: new Set(),
    changeLog: [],
    isSyncing: true,
  }),
}));

vi.mock("@/hooks/use-annotations", () => ({
  useAnnotations: () => ({
    annotations: [],
    addAnnotation: vi.fn(),
  }),
}));

vi.mock("@/components/preview/live-preview", () => ({
  LivePreview: () => <div data-testid="live-preview">preview</div>,
}));

vi.mock("@/components/collab/voice-chat-controls", () => ({
  VoiceChatControls: () => null,
}));

describe("MentorEditorClient ended state", () => {
  it("switches to an ended screen when PartyKit broadcasts session-ended", async () => {
    window.sessionStorage.setItem("collab:token", "token");
    window.sessionStorage.setItem("collab:roomId", "room");
    window.sessionStorage.setItem("collab:displayName", "导师");

    render(
      <MentorEditorClient
        resumeTitle="测试简历"
        initialContent={minimalContent()}
        resolvedTemplate={{
          id: "classic",
          name: "Classic",
          description: "",
          tags: [],
          html: "<div></div>",
          css: "",
          defaultStyleSettings: {},
        }}
        mode="edit"
      />,
    );

    await waitFor(() => expect(messageHandler).toBeTruthy());
    await act(async () => {
      messageHandler?.({ type: "session-ended", reason: "owner-ended" });
    });

    expect(await screen.findByText("协作已结束")).toBeInTheDocument();
    expect(screen.getByText("作者已结束本次协作，请联系对方重新邀请。")).toBeInTheDocument();
  });
});

function minimalContent(): ResumeContent {
  return {
    basics: { name: "张三", email: "", phone: "", location: "", headline: "", links: [] },
    experience: [],
    education: [],
    projects: [],
    skills: [],
    custom: {},
    sectionOrder: ["basics"],
    styleSettings: {},
  } as ResumeContent;
}
