import Link from "next/link";
import Image from "next/image";

const FOOTER_COLUMNS = [
  {
    title: "产品",
    links: [
      { label: "编辑器", href: "#features" },
      { label: "模板库", href: "#templates" },
      { label: "AI 导入", href: "#features" },
      { label: "协同批注", href: "#features" },
    ],
  },
  {
    title: "资源",
    links: [
      { label: "简历指南", href: "#" },
      { label: "更新日志", href: "#changelog" },
      { label: "常见问题", href: "#" },
    ],
  },
  {
    title: "开源",
    links: [
      { label: "GitHub", href: "https://github.com" },
      { label: "技术栈", href: "#" },
      { label: "贡献指南", href: "#" },
    ],
  },
  {
    title: "法律",
    links: [
      { label: "用户协议", href: "/terms" },
      { label: "隐私政策", href: "#" },
    ],
  },
];

export function MarketingFooter() {
  return (
    <footer className="bg-gray-950 pt-16 pb-8 text-gray-400">
      <div className="mx-auto max-w-6xl px-4">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-6 md:gap-12">
          {/* Brand */}
          <div className="col-span-2">
            <div className="flex items-center gap-2">
              <Image
                src="/logo.png"
                alt="intro-builder"
                width={28}
                height={28}
              />
              <span className="text-sm font-bold text-white">intro-builder</span>
            </div>
            <p className="mt-4 max-w-xs text-sm leading-relaxed">
              面向中文互联网求职者的在线简历工作台。开源、免费、克制。
            </p>
          </div>

          {/* Link columns */}
          {FOOTER_COLUMNS.map((col) => (
            <div key={col.title}>
              <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-white">
                {col.title}
              </h4>
              <ul className="space-y-2">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-gray-500 transition-colors hover:text-white"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom */}
        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-6 text-xs sm:flex-row">
          <span>&copy; 2024 intro-builder &middot; v0.3.0</span>
          <div className="flex gap-3">
            <a
              href="https://github.com"
              target="_blank"
              rel="noreferrer"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 text-gray-500 transition-colors hover:border-white/30 hover:text-white"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
