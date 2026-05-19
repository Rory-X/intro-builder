import { Briefcase, Mail, MapPin, Monitor, Phone, User, type LucideIcon } from "lucide-react";
import type { ResumeContent } from "@/lib/resume-schema";
import { cn } from "@/lib/utils";

const CELL = "text-[0.82em] leading-snug text-neutral-700";
const STACK = "flex flex-col gap-1.5";
const PHOTO_W = "4rem";
const PHOTO_H = "5.25rem";

function formatWebsiteLabel(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (/^个人知识库[:：]/.test(trimmed)) return trimmed;
  return `个人知识库：${trimmed.replace(/^https?:\/\//i, "")}`;
}

function ContactCell({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5">
      <Icon className="h-3.5 w-3.5 shrink-0 text-neutral-500" aria-hidden />
      <span className="[overflow-wrap:anywhere]">{text}</span>
    </span>
  );
}

function ContactStack({
  items,
  align,
}: {
  items: Array<{ icon: LucideIcon; text: string } | null>;
  align: "start" | "end";
}) {
  const visible = items.filter((item): item is { icon: LucideIcon; text: string } => item != null);
  if (visible.length === 0) return null;

  return (
    <div className={cn(STACK, align === "end" && "items-end")}>
      {visible.map((item) => (
        <ContactCell key={item.text} icon={item.icon} text={item.text} />
      ))}
    </div>
  );
}

/** Professional header: name on top; contact info in 3 columns (L / center / R stacks). */
export function ProfessionalHeader({ basics }: { basics: ResumeContent["basics"] }) {
  const hasPhoto = Boolean(basics.photo?.trim());
  const phone = basics.phone?.trim() ?? "";
  const email = basics.email?.trim() ?? "";
  const website = basics.website?.trim() ? formatWebsiteLabel(basics.website) : "";
  const status = basics.status?.trim() ?? "";
  const location = basics.location?.trim() ?? "";
  const career = basics.title?.trim() ?? "";

  const leftStack = [
    phone ? { icon: Phone, text: phone } : null,
    location ? { icon: MapPin, text: location } : null,
    status ? { icon: User, text: status } : null,
  ];
  const rightStack = [
    email ? { icon: Mail, text: email } : null,
    career ? { icon: Briefcase, text: career } : null,
  ];
  const showContactRow =
    leftStack.some(Boolean) || website || rightStack.some(Boolean);

  return (
    <div className="relative w-full">
      {hasPhoto && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={basics.photo}
          alt={basics.name}
          className="absolute top-0 right-0 rounded-sm object-contain object-top"
          style={{ width: PHOTO_W, height: PHOTO_H }}
        />
      )}
      <div className={cn(hasPhoto && "pr-[4.75rem]")}>
        <table className="w-full border-collapse" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "33%" }} />
            <col style={{ width: "34%" }} />
            <col style={{ width: "33%" }} />
          </colgroup>
          <tbody>
            <tr>
              <td colSpan={3} className="pb-1.5 text-center align-bottom">
                <h1 className="text-[1.65em] font-bold leading-tight tracking-tight text-neutral-900">
                  {basics.name}
                </h1>
              </td>
            </tr>

            {showContactRow && (
              <tr>
                <td className={cn(CELL, "align-top py-0.5 text-left")}>
                  <ContactStack items={leftStack} align="start" />
                </td>
                <td className={cn(CELL, "align-middle py-0.5 text-center")}>
                  {website ? <ContactCell icon={Monitor} text={website} /> : null}
                </td>
                <td className={cn(CELL, "align-top py-0.5 text-right")}>
                  <ContactStack items={rightStack} align="end" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
