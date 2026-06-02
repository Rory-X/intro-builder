# 文档站设计 Spec

> **日期**：2026-06-01
> **状态**：Draft
> **作者**：Agent + jiahaoqian

## 1. 目标与动机

intro-builder 当前是一个纯工具型产品（编辑简历 → 导出 PDF）。我们希望增加一个
面向**应届生/在校生**的内容板块，帮助目标用户弥合求职信息差，同时为产品引流。

**核心价值主张**：
- 提供系统化的求职知识（非零散帖子），配合 intro-builder 工具形成闭环
- 降低应届生求职时的信息不对称（暑期实习 vs 日常实习、秋招时间线等）
- 作为 SEO 引擎为简历工具带来自然流量

## 2. 目标受众

**大三/大四在校生 + 应届毕业生**，特征：
- 第一次写简历、第一次投递
- 不了解暑期实习/日常实习/秋招/春招的区别和时间节点
- 需要简历包装方法论（STAR 法则、量化成果等）
- 需要方向性指导（前端/后端/测试/产品学习路线）

## 3. 内容板块

### 3.1 求职科普（信息差）— `/docs/job-hunting/`

结构化文档，覆盖求职基础概念：
- 暑期实习 vs 日常实习：区别、时间线、转正率
- 秋招/春招时间线与节奏
- 校招 vs 社招：渠道、难度、薪资差异
- 面试流程拆解（笔试/HR面/技术面/主管面）
- 大厂 vs 中小厂的取舍

### 3.2 简历包装指南 — `/docs/resume-guide/`

方法论文档，教用户如何写出好简历：
- STAR 法则详解与实战案例
- 如何量化项目成果（没数据怎么办）
- 不同岗位简历侧重点（前端/后端/测试/产品）
- 常见简历误区与修改对照
- 项目经验包装技巧

### 3.3 学习路线 — `/docs/learning-path/`

方向性指导文档：
- 前端开发学习路线
- 后端开发学习路线
- 测试方向学习路线
- 产品经理学习路线
- （可扩展更多方向）

### 3.4 博客 — `/blog/`

时间流内容，覆盖时效性话题：
- 招聘季节点提醒
- 行业趋势分析
- 特定公司/岗位招聘信息

## 4. 技术方案

### 4.1 框架选型：fumadocs

- **fumadocs-core**：内容加载、搜索索引、路由生成
- **fumadocs-ui**：文档布局组件（侧边栏、TOC、面包屑、搜索框）
- **fumadocs-mdx**：MDX 编译与热更新

理由：
- 专为 Next.js App Router 设计，与项目技术栈完美匹配
- 内置搜索（Orama）、导航、TOC、代码高亮（Shiki）
- 基于 Tailwind CSS，可对齐现有设计系统
- 社区活跃，文档齐全

### 4.2 部署方式

**同一 Next.js 项目内**，路由级别集成：
- 文档页：`app/docs/[[...slug]]/page.tsx`
- 博客页：`app/blog/page.tsx` + `app/blog/[slug]/page.tsx`
- 与现有 `(marketing)`、`(app)` 路由组并列

### 4.3 内容管理

- 内容文件：`.mdx` 格式，存放在 `content/` 目录
- 版本管理：Git（与代码同仓库）
- 写作工具：Obsidian 或任何文本编辑器（接受 JSX 部分在 Obsidian 中不渲染）
- 目录结构由 `meta.json` 控制顺序和分组

### 4.4 路由结构

```
app/
  (marketing)/              现有落地页（不变）
  (app)/                    现有简历工具（不变）
  docs/[[...slug]]/         fumadocs 文档路由
    page.tsx                渲染文档页
    layout.tsx              文档布局（侧边栏 + TOC）
  blog/
    page.tsx                博客列表页
    [slug]/page.tsx         博客文章页
    layout.tsx              博客布局
```

### 4.5 内容目录结构

```
content/
  docs/
    index.mdx                        文档站首页/概览
    meta.json                        顶层导航顺序
    job-hunting/                     求职科普
      meta.json
      index.mdx
      internship-types.mdx
      recruitment-timeline.mdx
      campus-vs-social.mdx
    resume-guide/                    简历包装指南
      meta.json
      index.mdx
      star-method.mdx
      quantify-results.mdx
      frontend-resume.mdx
      backend-resume.mdx
    learning-path/                   学习路线
      meta.json
      index.mdx
      frontend.mdx
      backend.mdx
      testing.mdx
  blog/
    2026-06-01-summer-internship-prep.mdx
```

## 5. 导航与入口设计

| 入口 | 说明 |
|---|---|
| 顶部导航栏 | 现有 header 新增「求职指南」和「博客」链接 |
| 落地页 CTA | marketing 首页加一个「求职指南」卡片区域 |
| 文档侧边栏 | fumadocs 自动生成，由 meta.json 控制 |
| 编辑器内关联（后续） | 编辑简历时可展示相关文档 tips（非 MVP） |

## 6. 样式对齐策略

- fumadocs-ui 基于 Tailwind CSS 变量主题化
- 复用 `app/globals.css` 中已有的色板（`--primary`、`--background` 等）
- 通过 fumadocs 的 `tailwind.config` 集成或 CSS 变量映射对齐品牌色
- 暗色模式复用现有 `next-themes` 配置
- 字体/间距/圆角与现有产品保持一致

## 7. 功能清单

| 功能 | 实现方式 | 优先级 |
|---|---|---|
| 全文搜索 | fumadocs 内置 Orama 搜索 | P0 |
| 侧边栏导航 | fumadocs DocsLayout | P0 |
| 目录（TOC） | fumadocs 自动提取标题 | P0 |
| 代码高亮 | Shiki（fumadocs 默认） | P0 |
| 暗色模式 | 复用 next-themes | P0 |
| SEO（sitemap + OG） | fumadocs + Next.js metadata API | P0 |
| 自定义 MDX 组件 | `<Callout>`, `<Steps>`, `<Card>` 等 | P1 |
| 博客时间线 | 自建列表页 + fumadocs MDX 渲染 | P1 |
| 博客标签/分类 | frontmatter tag + 过滤 | P2 |
| 编辑器内关联推荐 | 读文档 frontmatter 做关联 | P3 |

## 8. MVP 范围

第一个可发布切片：
1. fumadocs 集成（依赖安装、配置、路由搭建）
2. 文档布局（侧边栏 + TOC + 搜索）
3. 各板块 1-2 篇示范文章（验证端到端流程）
4. 博客列表页 + 1 篇示范博客
5. 顶部导航入口
6. 暗色模式适配
7. 基础 SEO（metadata + sitemap）

## 9. 不在范围内（YAGNI）

- 评论系统 / 用户互动
- 国际化（i18n）
- 付费内容 / 会员墙
- AI 辅助写作
- RSS feed（可后续补充）
- 编辑器内关联推荐（后续迭代）

## 10. 风险与缓解

| 风险 | 缓解措施 |
|---|---|
| fumadocs 与 Next.js 16 兼容性 | fumadocs 社区活跃，v16+ 明确支持 App Router；集成前先跑 smoke test |
| 依赖体积膨胀 | fumadocs tree-shake 友好；监控 `pnpm build` 产物大小 |
| 样式冲突 | fumadocs-ui 用 CSS 变量隔离；先在独立布局里验证 |
| 内容产出瓶颈 | MVP 只要求每板块 1-2 篇；框架先行，内容可持续补充 |

## 11. 成功标准

- [ ] `pnpm build` 通过，文档/博客路由可正常访问
- [ ] 搜索功能可检索所有文档内容
- [ ] 暗色模式视觉一致
- [ ] 落地页 + 顶部导航可直达文档站
- [ ] Lighthouse SEO 评分 ≥ 90
