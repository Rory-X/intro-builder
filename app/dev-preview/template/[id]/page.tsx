/**
 * DEV-ONLY: render any template id with demo content, no auth required.
 *
 * Visit /dev-preview/template/abbey or /dev-preview/template/professional.
 * Useful for eyeballing schema + Skill output before the full /templates
 * gallery lands, and for verifying frame.kind rendering on real data.
 *
 * Mounted at `app/dev-preview/...` to keep it visually segregated and easy
 * to delete. proxy.ts doesn't list this in PROTECTED so no login is enforced.
 */
import { TemplateRender } from "@/lib/templates/render-server";
import { listAllTemplatesAsync } from "@/lib/templates/registry-server";
import { demoResume } from "@/lib/demo-resume";
import { notFound } from "next/navigation";
import Link from "next/link";

export default async function DevTemplatePreview({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const all = await listAllTemplatesAsync();
  const found = all.find((t) => t.id === id);
  if (!found) notFound();

  return (
    <main className="min-h-screen bg-zinc-200 p-8">
      <header className="mx-auto mb-6 flex max-w-[800px] items-center justify-between rounded-lg bg-white px-4 py-3 shadow-sm">
        <div>
          <p className="text-xs text-zinc-500">Dev preview · 不走鉴权</p>
          <h1 className="text-lg font-semibold">
            {found.name}{" "}
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-600">
              {found.id}
            </span>{" "}
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600">
              {found.source}
            </span>
          </h1>
          {found.description ? (
            <p className="mt-1 text-sm text-zinc-600">{found.description}</p>
          ) : null}
        </div>
        <nav className="flex flex-wrap gap-1.5">
          {all.map((t) => (
            <Link
              key={t.id}
              href={`/dev-preview/template/${t.id}`}
              className={`rounded border px-2 py-1 text-xs ${
                t.id === id
                  ? "border-zinc-900 bg-zinc-900 text-white"
                  : "border-zinc-300 bg-white hover:bg-zinc-50"
              }`}
            >
              {t.name}
            </Link>
          ))}
        </nav>
      </header>

      <div className="mx-auto bg-white shadow-md">
        <TemplateRender
          id={id}
          content={demoResume}
          sectionOrder={demoResume.sectionOrder}
          showEmptyPlaceholders={false}
        />
      </div>
    </main>
  );
}
