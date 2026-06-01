import { Briefcase, Mail, MapPin, Monitor, Phone, User, type LucideIcon } from "lucide-react";
import type { ResumeContent } from "@/lib/resume-schema";
import { cn } from "@/lib/utils";

const CELL = "py-0.5 text-[0.82em] leading-snug text-neutral-700";
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
    <span
      data-testid="contact-chip"
      className="inline-flex max-w-full items-center gap-1.5 whitespace-nowrap"
    >
      <Icon className="h-[1em] w-[1em] shrink-0 text-neutral-500" aria-hidden />
      <span className="truncate">{text}</span>
    </span>
  );
}

/** Professional header: name on top; contact info centered in compact rows. */
export function ProfessionalHeader({ basics }: { basics: ResumeContent["basics"] }) {
  const hasPhoto = Boolean(basics.photo?.trim());
  const phone = basics.phone?.trim() ?? "";
  const email = basics.email?.trim() ?? "";
  const website = basics.website?.trim() ? formatWebsiteLabel(basics.website) : "";
  const status = basics.status?.trim() ?? "";
  const location = basics.location?.trim() ?? "";
  const career = basics.title?.trim() ?? "";

  const showTopRow = Boolean(phone || email);
  const showBottomRow = Boolean(status || location || career);
  const showContactRows = Boolean(showTopRow || website || showBottomRow);

  return (
    <div className="w-full">
      {hasPhoto && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={basics.photo}
          alt={basics.name}
          className="absolute rounded-sm object-contain object-top"
          style={{ width: PHOTO_W, height: PHOTO_H, top: "40px", right: "40px" }}
        />
      )}
      <div className={cn(hasPhoto && "pr-[4.75rem]")}>
        <h1 className="pb-1.5 text-center text-[1.65em] font-bold leading-tight tracking-tight text-neutral-900">
          {basics.name}
        </h1>

        {showContactRows && (
          <div
            data-testid="professional-contact-block"
            className="mx-auto flex max-w-[32em] flex-col items-center gap-1.5"
          >
            {showTopRow && (
              <div
                data-testid="contact-row"
                className={cn(CELL, "flex max-w-full justify-center gap-x-8")}
              >
                {phone ? <ContactCell icon={Phone} text={phone} /> : null}
                {email ? <ContactCell icon={Mail} text={email} /> : null}
              </div>
            )}

            {website && (
              <div
                data-testid="contact-row"
                className={cn(CELL, "flex max-w-full justify-center")}
              >
                <ContactCell icon={Monitor} text={website} />
              </div>
            )}

            {showBottomRow && (
              <div
                data-testid="contact-row"
                className={cn(CELL, "flex max-w-full justify-center gap-x-8")}
              >
                {status ? <ContactCell icon={User} text={status} /> : null}
                {location ? <ContactCell icon={MapPin} text={location} /> : null}
                {career ? <ContactCell icon={Briefcase} text={career} /> : null}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
