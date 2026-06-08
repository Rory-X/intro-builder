"use client";

import type { ReactNode } from "react";
import {
  AssistantRuntimeProvider as AssistantUiRuntimeProvider,
  type ChatModelAdapter,
  type ThreadMessage,
  useLocalRuntime,
} from "@assistant-ui/react";

export type AgentRuntimeProviderProps = {
  children: ReactNode;
  sendMessage: (
    content: string,
    options: { abortSignal: AbortSignal },
  ) => Promise<string>;
};

export function AgentRuntimeProvider({
  children,
  sendMessage,
}: AgentRuntimeProviderProps) {
  const adapter: ChatModelAdapter = {
    async run({ messages, abortSignal }) {
      const content = getLastUserText(messages);
      const text = await sendMessage(content, { abortSignal });
      return {
        content: [{ type: "text", text }],
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
