import type { ResumeContent } from "@intro-builder/shared/schemas";
import { bulletsToDoc, emptyDoc } from "@intro-builder/shared/types";

export const demoResume: ResumeContent = {
  basics: {
    name: "张三",
    status: "在职",
    title: "前端工程师",
    email: "zhang@example.com",
    phone: "138 0000 0000",
    location: "北京",
    website: "github.com/zhangsan",
    summary: "3 年前端经验，专注 Web 性能与可访问性，熟悉 React / Next.js 技术栈。",
    photo: "/templates/placeholder-avatar.png",
  },
  education: [
    {
      school: "北京邮电大学",
      degree: "本科",
      major: "计算机科学与技术",
      location: "北京",
      start: "2018.09",
      end: "2022.06",
      gpa: "3.7/4.0",
      highlights: bulletsToDoc([
        "主修：数据结构、操作系统、计算机网络、编译原理；连续三年专业奖学金",
      ]),
    },
  ],
  experience: [
    {
      company: "字节跳动",
      title: "高级前端工程师",
      start: "2022.07",
      end: "至今",
      location: "北京",
      content: bulletsToDoc([
        "主导企业协作工具的编辑器重构，重写协同光标与分页渲染链路，核心链路加载耗时降低 40%",
        "设计并落地组件库可访问性规范，建立键盘导航与 ARIA 基线，WCAG AA 通过率从 71% 提升至 98%",
        "推动 CI 中的视觉回归测试接入，覆盖 120+ 关键组件快照，减少 UI 回退事故 60%",
      ]),
    },
    {
      company: "美团",
      title: "前端工程师",
      start: "2021.07",
      end: "2022.06",
      location: "北京",
      content: bulletsToDoc([
        "参与点评 PC 端列表页重构，首屏 LCP 从 3.2s 降至 1.4s",
        "搭建基于 Web Vitals 的前端性能监控看板，覆盖核心页面 P75 指标",
      ]),
    },
  ],
  projects: [
    {
      name: "intro-builder",
      role: "核心开发",
      location: "北京",
      start: "2024.04",
      end: "2024.06",
      stack: ["Next.js", "TypeScript", "Tailwind"],
      link: "github.com/zhangsan/intro-builder",
      content: bulletsToDoc([
        "面向求职者的开源简历生成器，支持结构化编辑、多模板套用与公开分享链接",
        "实现实时分页预览与 Puppeteer PDF 导出，预览与导出复用同一套 DOM 保证一致",
      ]),
    },
    {
      name: "可视化埋点平台",
      role: "前端负责人",
      location: "北京",
      start: "2023.03",
      end: "2023.09",
      stack: ["React", "Vite", "D3.js"],
      link: "github.com/zhangsan/track-studio",
      content: bulletsToDoc([
        "提供圈选式可视化埋点配置，业务侧无需写代码即可上报事件，接入成本降低 70%",
      ]),
    },
  ],
  research: [],
  skills: {
    type: "doc",
    content: [
      { type: "paragraph", content: [
        { type: "text", marks: [{ type: "bold" }], text: "语言：" },
        { type: "text", text: "TypeScript、JavaScript、Python、Go" },
      ]},
      { type: "paragraph", content: [
        { type: "text", marks: [{ type: "bold" }], text: "框架：" },
        { type: "text", text: "React、Next.js、Vue、Node.js" },
      ]},
      { type: "paragraph", content: [
        { type: "text", marks: [{ type: "bold" }], text: "工程：" },
        { type: "text", text: "Vite、Webpack、Playwright、Vitest、Docker" },
      ]},
      { type: "paragraph", content: [
        { type: "text", marks: [{ type: "bold" }], text: "数据与云：" },
        { type: "text", text: "PostgreSQL、Redis、GraphQL、Kubernetes、CI/CD" },
      ]},
    ],
  },
  summary: emptyDoc(),
  awards: bulletsToDoc([
    "2023 字节跳动年度新人奖（部门 Top 5%）",
    "2022 全国大学生计算机设计大赛 一等奖",
    "2021 ACM-ICPC 亚洲区域赛 银奖",
  ]),
  portfolio: emptyDoc(),
  custom: [],
  sectionOrder: [
    "basics",
    "experience",
    "education",
    "projects",
    "skills",
    "awards",
  ],
};
