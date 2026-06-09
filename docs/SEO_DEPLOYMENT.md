# SEO Phase 1 部署检查清单

## 前置条件

- ✅ 所有代码已合并到主分支
- ✅ 构建通过（`pnpm build` 成功）
- ✅ Lint 检查通过

## 部署前检查

### 1. 环境变量配置

在 Vercel 项目设置中添加以下环境变量：

```bash
NEXT_PUBLIC_SITE_URL=https://intro-builder.rory-x.me
```

**验证路径**: Vercel Dashboard → Project Settings → Environment Variables

### 2. 本地最终验证

```bash
# 设置生产 URL 并构建
export NEXT_PUBLIC_SITE_URL=https://intro-builder.rory-x.me
pnpm build

# 检查构建输出
ls .next/server/app/ | grep -E "robots|sitemap"
# 应该看到: robots.txt.body  robots.txt.meta  sitemap.xml.body  sitemap.xml.meta
```

## 部署后验证

### 1. 基础功能验证

```bash
# 1. 验证 robots.txt
curl https://intro-builder.rory-x.me/robots.txt

# 预期输出包含:
# User-agent: *
# Allow: /
# Disallow: /r/*
# Disallow: /api/*
# Sitemap: https://intro-builder.rory-x.me/sitemap.xml

# 2. 验证主 sitemap
curl https://intro-builder.rory-x.me/sitemap.xml

# 预期输出包含 3 个子 sitemap:
# - /sitemap-static.xml
# - /sitemap-blog.xml
# - /sitemap-docs.xml

# 3. 验证子 sitemap
curl https://intro-builder.rory-x.me/sitemap-static.xml | grep "<url>"
curl https://intro-builder.rory-x.me/sitemap-blog.xml | grep "<url>"
curl https://intro-builder.rory-x.me/sitemap-docs.xml | grep "<url>"

# 4. 验证所有 URL 使用生产域名
curl https://intro-builder.rory-x.me/sitemap-static.xml | grep "intro-builder.rory-x.me"
# 应该看到所有 <loc> 标签都使用 https://intro-builder.rory-x.me
```

### 2. Metadata 验证

```bash
# 1. 检查首页 metadata
curl https://intro-builder.rory-x.me | grep -E "<title>|<meta name=\"description\"|<meta property=\"og:|<link rel=\"canonical\""

# 预期包含:
# <title>intro-builder - 在线简历排版工具</title>
# <meta name="description" content="专为互联网求职者设计...">
# <meta property="og:title" content="...">
# <link rel="canonical" href="https://intro-builder.rory-x.me">

# 2. 检查文档页 metadata（任选一个文档路径）
curl https://intro-builder.rory-x.me/docs | grep -E "og:|canonical"

# 3. 检查博客页 metadata（如果有博客文章）
curl https://intro-builder.rory-x.me/blog/summer-internship-prep | grep -E "og:|canonical|article"
```

### 3. 隐私保护验证

```bash
# 验证公开简历页有 noindex
curl https://intro-builder.rory-x.me/r/test-slug | grep "robots"

# 预期输出:
# <meta name="robots" content="noindex, nofollow, nocache">
```

### 4. 浏览器测试

在浏览器中打开以下 URL，使用开发者工具（F12）检查：

1. **首页**: https://intro-builder.rory-x.me
   - Elements → `<head>` → 检查 meta 标签
   - 应该看到完整的 Open Graph 和 Twitter Card 标签

2. **文档页**: https://intro-builder.rory-x.me/docs
   - 检查 canonical URL 和 og:type="article"

3. **公开简历页**: https://intro-builder.rory-x.me/r/[任意slug]
   - 检查 `<meta name="robots" content="noindex, nofollow, nocache">`

## 搜索引擎提交

部署验证通过后，手动提交到三大搜索引擎：

### 1. Google Search Console

1. 访问: https://search.google.com/search-console
2. 添加资源: `https://intro-builder.rory-x.me`
3. 验证所有权（DNS 或 HTML 文件方式）
4. 提交 sitemap: `https://intro-builder.rory-x.me/sitemap.xml`
5. 监控"覆盖率"报告，确认页面被索引（通常需要 1-2 周）

### 2. 百度站长平台

1. 访问: https://ziyuan.baidu.com/site/index
2. 添加站点: `https://intro-builder.rory-x.me`
3. 验证站点所有权
4. 提交 sitemap（百度对 sitemap 支持有限）
5. 可选：使用"链接提交 → 主动推送"API 加速收录

### 3. Bing Webmaster Tools

1. 访问: https://www.bing.com/webmasters
2. 添加站点: `https://intro-builder.rory-x.me`
3. 可从 Google Search Console 导入配置
4. 提交 sitemap: `https://intro-builder.rory-x.me/sitemap.xml`
5. 使用"URL 检查"工具测试个别页面

## 验证 URL 列表

快速访问表：

- Robots: https://intro-builder.rory-x.me/robots.txt
- 主 Sitemap: https://intro-builder.rory-x.me/sitemap.xml
- 静态页 Sitemap: https://intro-builder.rory-x.me/sitemap-static.xml
- 博客 Sitemap: https://intro-builder.rory-x.me/sitemap-blog.xml
- 文档 Sitemap: https://intro-builder.rory-x.me/sitemap-docs.xml

## 监控与后续

### 短期监控（1-2 周）

- [ ] Google Search Console：检查"覆盖率" → 确认已收录页面数
- [ ] 百度站长：检查"索引量" → 确认抓取频次
- [ ] Bing Webmaster：检查"索引页数"

### 中期优化（1-3 个月）

- [ ] 分析 Search Console 的"效果"报告 → 查看哪些关键词带来流量
- [ ] 根据点击率（CTR）优化 title 和 description
- [ ] 检查是否有爬虫错误或 404 页面

### 后续工作（Phase 2）

完成 Phase 1 后，可以继续：

- **Phase 2 - 社交分享优化**:
  - 动态 OG 图生成器（`@vercel/og` + ImageResponse）
  - 微信分享优化（防缓存）
  
- **Phase 3 - 结构化数据**:
  - JSON-LD（Organization、WebSite、Article、BreadcrumbList）
  - 面包屑导航
  - FAQ/HowTo schema（针对文档内容）

## 常见问题

### Q1: robots.txt 返回 404
**A**: 检查 Vercel 构建日志，确认 `app/robots.ts` 被正确编译。重新部署。

### Q2: sitemap 中的 URL 还是 localhost
**A**: 检查 Vercel 环境变量是否正确配置 `NEXT_PUBLIC_SITE_URL`。重新部署。

### Q3: 公开简历页还是被 Google 收录了
**A**: robots.txt 和 noindex 需要时间生效（1-2 周）。可以在 Google Search Console 使用"移除 URL"工具加速。

### Q4: 百度不收录 sitemap
**A**: 百度对 sitemap 支持较弱，建议使用"主动推送"API 或"手动提交"功能。

### Q5: 社交分享时看不到卡片
**A**: Phase 1 只添加了 metadata，没有 OG 图片。等 Phase 2 完成后会有动态图生成。

## Definition of Done

Phase 1 完成标志：

- ✅ `/robots.txt` 可访问，正确禁止 `/r/*`
- ✅ `/sitemap.xml` 可访问，包含 3 个子 sitemap
- ✅ 所有子 sitemap 可访问，包含正确的 URL
- ✅ 所有 sitemap URL 使用生产域名 `https://intro-builder.rory-x.me`
- ✅ 首页有完整 metadata
- ✅ 文档/博客页有独立 metadata
- ✅ 公开简历页有 noindex
- ✅ 已提交到 Google/百度/Bing 站长平台

## 支持

如有问题，参考：
- 设计文档: `docs/superpowers/specs/2026-06-07-seo-phase1.md`
- 实施计划: `docs/superpowers/plans/2026-06-07-seo-phase1.md`
