import { db } from "@/db";
import { templates } from "@/db/schema";
import { PublishButton } from "./publish-button";

export const dynamic = "force-dynamic";

export default async function DevPreviewIndexPage() {
  const rows = await db
    .select({
      id: templates.id,
      name: templates.name,
      description: templates.description,
      status: templates.status,
      category: templates.category,
    })
    .from(templates)
    .orderBy(templates.createdAt);

  return (
    <div
      style={{
        padding: "20px",
        fontFamily: "system-ui, sans-serif",
        background: "#f5f5f5",
        minHeight: "100vh",
      }}
    >
      <h1 style={{ fontSize: "24px", fontWeight: 700, marginBottom: "8px" }}>
        Dev Preview — All Templates ({rows.length})
      </h1>
      <p style={{ color: "#666", marginBottom: "20px" }}>
        Click a card to preview. Use <b>Publish</b> to sync a single template to the remote database.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: "12px",
        }}
      >
        {rows.map((t) => {
          const isPublished = t.status === "published";
          const isSkipped = ["professional", "classic", "modern"].includes(t.id);
          return (
            <div
              key={t.id}
              style={{
                padding: "14px 16px",
                background: isPublished ? "#f0fdf4" : "#fffbeb",
                border: `2px solid ${isPublished ? "#86efac" : "#fcd34d"}`,
                borderRadius: "8px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              <a
                href={`/dev-preview/template/${t.id}`}
                style={{ textDecoration: "none", color: "#1a1a1a", flex: 1 }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: "16px" }}>
                    {t.name}
                  </span>
                  <span
                    style={{
                      fontSize: "11px",
                      padding: "2px 8px",
                      borderRadius: "4px",
                      background: isPublished ? "#bbf7d0" : "#fde68a",
                      color: isPublished ? "#166534" : "#92400e",
                    }}
                  >
                    {isPublished ? "PUB" : "DRAFT"}
                  </span>
                </div>
                <div style={{ fontSize: "13px", color: "#666", marginTop: "4px" }}>
                  {t.description}
                </div>
                <div
                  style={{
                    fontSize: "11px",
                    color: "#999",
                    marginTop: "4px",
                    fontFamily: "monospace",
                  }}
                >
                  {t.id} · {t.category ?? "general"}
                </div>
              </a>
              {!isSkipped && (
                <PublishButton templateId={t.id} templateName={t.name} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
