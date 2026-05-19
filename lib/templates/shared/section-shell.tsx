import type { ResumeSectionVariant } from "./resume-section";
import { ResumeItemHeader } from "./resume-item-header";
import { wrapProfessionalEntry } from "./professional-wrap";

const PLACEHOLDER_CLASS = "text-neutral-400";

function shellWrap(
  variant: ResumeSectionVariant,
  content: React.ReactNode,
) {
  return wrapProfessionalEntry(variant, content, { muted: true });
}

type ShellProps = {
  variant: ResumeSectionVariant;
};

export function ExperienceSectionShell({ variant }: ShellProps) {
  const header =
    variant === "classic" ? (
      <ResumeItemHeader
        variant="classic"
        primary="公司名称 — 职位名称"
        dateRange="2022 – 至今"
      />
    ) : variant === "modern" ? (
      <ResumeItemHeader
        variant="modern"
        primary="职位名称 @ 公司名称"
        dateRange="2022 – 至今"
      />
    ) : (
      <ResumeItemHeader
        variant="professional"
        primary="公司名称"
        secondary="职位名称"
        tertiary="工作城市"
        dateRange="2022 – 至今"
      />
    );

  const body = (
    <div className={variant === "professional" ? PLACEHOLDER_CLASS : `mb-2.5 ${PLACEHOLDER_CLASS}`}>
      {header}
      <p className="mt-1 text-[0.92em] leading-relaxed">在此描述工作职责与核心成果…</p>
      <ul className="mt-1 list-inside list-disc text-[0.9em] leading-relaxed">
        <li>可量化的业务或技术贡献</li>
        <li>重点项目或团队协作亮点</li>
      </ul>
    </div>
  );
  return shellWrap(variant, body);
}

export function EducationSectionShell({ variant }: ShellProps) {
  const body = (
    <div className={variant === "professional" ? PLACEHOLDER_CLASS : `mb-2 ${PLACEHOLDER_CLASS}`}>
      <ResumeItemHeader
        variant={variant === "modern" ? "modern" : variant}
        primary={
          <>
            <strong>学校名称</strong>
            <span className="font-normal"> 本科 专业名称</span>
          </>
        }
        dateRange="2018 – 2022"
      />
      <p className="mt-1 text-[0.9em] leading-relaxed">荣誉、课程或科研亮点（选填）</p>
    </div>
  );
  return shellWrap(variant, body);
}

export function ProjectsSectionShell({ variant }: ShellProps) {
  const body = (
    <div className={variant === "professional" ? PLACEHOLDER_CLASS : `mb-2.5 ${PLACEHOLDER_CLASS}`}>
      <ResumeItemHeader
        variant={variant === "modern" ? "modern" : variant}
        primary="项目名称"
        secondary="React · TypeScript · Node.js"
      />
      <p className="mt-1 text-[0.92em] leading-relaxed">项目背景、你的角色与关键成果…</p>
    </div>
  );
  return shellWrap(variant, body);
}

export function SkillsSectionShell({ variant }: ShellProps) {
  const body = (
    <div className={`space-y-1 ${PLACEHOLDER_CLASS}`}>
      <p className="text-[0.92em] leading-relaxed">
        <span className="font-semibold text-neutral-500">编程语言：</span>
        JavaScript、TypeScript、Python
      </p>
      <p className="text-[0.92em] leading-relaxed">
        <span className="font-semibold text-neutral-500">框架 / 工具：</span>
        React、Next.js、Git
      </p>
    </div>
  );
  return shellWrap(variant, body);
}

export function SummarySectionShell({ variant }: { variant?: ResumeSectionVariant }) {
  const text = (
    <p className={`text-[0.95em] leading-relaxed ${PLACEHOLDER_CLASS}`}>
      用 2–3 句话概括你的背景、核心能力与求职方向…
    </p>
  );
  return variant ? shellWrap(variant, text) : text;
}

export function CustomSectionShell({
  title,
  variant,
}: {
  title: string;
  variant?: ResumeSectionVariant;
}) {
  const text = (
    <p className={`text-[0.92em] leading-relaxed ${PLACEHOLDER_CLASS}`}>
      在「{title}」中填写相关内容…
    </p>
  );
  return variant ? shellWrap(variant, text) : text;
}

export function BasicsSummaryPlaceholder() {
  return (
    <p className={`text-[0.95em] leading-relaxed ${PLACEHOLDER_CLASS}`}>
      用 2–3 句话概括你的背景、核心能力与求职方向…
    </p>
  );
}
