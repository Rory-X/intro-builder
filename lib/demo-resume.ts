import type { ResumeContent } from "@/lib/resume-schema";
import { bulletsToDoc } from "@/lib/tiptap-types";

export const demoResume: ResumeContent = {
  basics: {
    name: "张三",
    title: "前端工程师",
    email: "zhang@example.com",
    phone: "138 0000 0000",
    location: "北京",
    website: "github.com/zhangsan",
    summary: "3 年前端经验，专注 Web 性能与可访问性，熟悉 React / Next.js 技术栈。",
    photo: "",
  },
  education: [
    {
      school: "北京邮电大学",
      degree: "本科",
      major: "计算机科学与技术",
      start: "2018.09",
      end: "2022.06",
      gpa: "3.7/4.0",
      highlights: { type: "doc", content: [] },
    },
  ],
  experience: [
    {
      company: "字节跳动",
      title: "前端工程师",
      start: "2022.07",
      end: "至今",
      location: "北京",
      content: bulletsToDoc([
        "主导企业协作工具的编辑器重构，核心链路加载耗时降低 40%",
        "设计并落地组件库可访问性规范，WCAG AA 通过率 98%",
        "推动 CI 中的视觉回归测试接入，减少 UI 回退事故 60%",
      ]),
    },
    {
      company: "美团",
      title: "前端实习生",
      start: "2021.07",
      end: "2021.12",
      location: "北京",
      content: bulletsToDoc([
        "参与点评 PC 端列表页重构，首屏 LCP 从 3.2s 降至 1.4s",
      ]),
    },
  ],
  projects: [
    {
      name: "intro-builder",
      stack: ["Next.js", "TypeScript", "Tailwind"],
      link: "github.com/zhangsan/intro-builder",
      content: bulletsToDoc([
        "面向求职者的开源简历生成器，支持多模板与公开分享链接",
      ]),
    },
  ],
  skills: [
    { category: "语言", items: ["TypeScript", "JavaScript", "Python"] },
    { category: "框架", items: ["React", "Next.js", "Vue"] },
    { category: "工具", items: ["Vite", "Playwright", "Docker"] },
  ],
  custom: [],
  sectionOrder: ["basics", "experience", "education", "projects", "skills", "custom"],
};
