"use client";

import { useState } from "react";
import { publishTemplateToRemote } from "./actions";

export function PublishButton({
  templateId,
  templateName,
}: {
  templateId: string;
  templateName: string;
}) {
  const [state, setState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handlePublish() {
    setState("loading");
    setMessage("");
    const result = await publishTemplateToRemote(templateId);
    setState(result.ok ? "ok" : "error");
    setMessage(result.message);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
      <button
        onClick={handlePublish}
        disabled={state === "loading"}
        style={{
          padding: "4px 12px",
          fontSize: "12px",
          fontWeight: 600,
          border: "none",
          borderRadius: "4px",
          cursor: state === "loading" ? "not-allowed" : "pointer",
          background:
            state === "ok"
              ? "#86efac"
              : state === "error"
                ? "#fca5a5"
                : "#3b82f6",
          color: state === "ok" || state === "error" ? "#1a1a1a" : "#ffffff",
          opacity: state === "loading" ? 0.6 : 1,
        }}
      >
        {state === "loading" ? "⏳ Syncing..." : state === "ok" ? "✅ Published" : state === "error" ? "❌ Failed" : "📤 Publish to Remote"}
      </button>
      {message && (
        <span style={{ fontSize: "11px", color: state === "ok" ? "#166534" : "#991b1b" }}>
          {message}
        </span>
      )}
    </div>
  );
}
