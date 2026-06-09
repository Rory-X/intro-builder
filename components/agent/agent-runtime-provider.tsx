"use client";

import type { ReactNode } from "react";
import {
  AssistantRuntimeProvider as AssistantUiRuntimeProvider,
  type ChatModelAdapter,
  type ChatModelRunOptions,
  type ThreadMessage,
  useLocalRuntime,
} from "@assistant-ui/react";

export type AgentRuntimeProviderProps = {
  children: ReactNode;
  sendMessage: (
    content: string,
    options: {
      abortSignal: AbortSignal;
      messages: readonly ThreadMessage[];
      runConfig: ChatModelRunOptions["runConfig"];
    },
  ) => AsyncIterable<string>;
};

export function AgentRuntimeProvider({
  children,
  sendMessage,
}: AgentRuntimeProviderProps) {
  const adapter: ChatModelAdapter = {
    async *run({ messages, abortSignal, runConfig }) {
      const content = getLastUserText(messages);
      let latestText = "";

      for await (const text of sendMessage(content, { abortSignal, messages, runConfig })) {
        latestText = text;
        yield {
          content: [{ type: "text", text }],
        };
      }

      yield {
        content: [{ type: "text", text: latestText }],
        status: { type: "complete", reason: "stop" },
      };
    },
  };
  const runtime = useLocalRuntime(adapter);

  return (
    <AssistantUiRuntimeProvider runtime={runtime}>
      {children}
    </AssistantUiRuntimeProvider>
  );
}

function getLastUserText(messages: readonly ThreadMessage[]): string {
  const userMessage = [...messages].reverse().find((message) => message.role === "user");
  if (!userMessage) return "";

  return userMessage.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
}
