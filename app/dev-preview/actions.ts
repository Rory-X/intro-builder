"use server";

import { db } from "@/db";
import { templates } from "@/db/schema";
import { eq } from "drizzle-orm";
import postgres from "postgres";

const REMOTE_DB_URL =
  "postgresql://neondb_owner:npg_JPu0GHxNhi9z@ep-blue-hall-aoz2r2jj-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";

const SKIP_IDS = ["professional", "classic", "modern"];

export async function publishTemplateToRemote(id: string): Promise<{
  ok: boolean;
  message: string;
}> {
  if (SKIP_IDS.includes(id)) {
    return { ok: false, message: `${id} 是已发布模板，不允许覆盖` };
  }

  const rows = await db
    .select()
    .from(templates)
    .where(eq(templates.id, id))
    .limit(1);

  if (rows.length === 0) {
    return { ok: false, message: `模板 ${id} 不存在` };
  }

  const t = rows[0];

  try {
    const remote = postgres(REMOTE_DB_URL, { idle_timeout: 5 });

    await remote`
      INSERT INTO templates (
        id, name, description, "thumbnailUrl", status, "createdAt", "updatedAt",
        category, features, html, css, "defaultStyleSettings", "sectionIcons",
        "bannerImageUrl", "isDefault"
      ) VALUES (
        ${t.id}, ${t.name}, ${t.description}, ${t.thumbnailUrl}, 'published',
        ${t.createdAt}, ${new Date()}, ${t.category},
        ${JSON.stringify(t.features)}, ${t.html}, ${t.css},
        ${JSON.stringify(t.defaultStyleSettings)}, ${JSON.stringify(t.sectionIcons)},
        ${t.bannerImageUrl}, ${t.isDefault}
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        "thumbnailUrl" = EXCLUDED."thumbnailUrl",
        status = EXCLUDED.status,
        category = EXCLUDED.category,
        features = EXCLUDED.features,
        html = EXCLUDED.html,
        css = EXCLUDED.css,
        "defaultStyleSettings" = EXCLUDED."defaultStyleSettings",
        "sectionIcons" = EXCLUDED."sectionIcons",
        "bannerImageUrl" = EXCLUDED."bannerImageUrl",
        "isDefault" = EXCLUDED."isDefault",
        "updatedAt" = EXCLUDED."updatedAt"
    `;

    await remote.end();
    return { ok: true, message: `${t.name} 同步成功` };
  } catch (err) {
    console.error(`[publish] Failed to sync ${id}:`, err);
    return { ok: false, message: `同步失败: ${(err as Error).message}` };
  }
}
