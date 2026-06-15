export const SEO_CONFIG = {
  // Site basics
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
  siteName: 'intro-builder',
  siteDescription: '面向互联网求职者的在线简历工作台：结构化编辑、AI 辅助优化、求职文档、模板与 PDF 交付。',
  keywords: ['在线简历', 'AI简历', '简历诊断', '简历制作', '简历模板', 'PDF导出', '求职文档', '求职工具', 'ATS友好'],

  // Page-level metadata presets
  pages: {
    home: {
      title: 'intro-builder - 在线简历与求职工作台',
      description: '专为中文互联网求职者设计的简历工具。支持结构化编辑、实时预览、AI 诊断与润色、求职文档、模板库和 PDF 导出。',
      keywords: ['在线简历制作', 'AI简历', '求职文档', '简历诊断', '简历编辑器', '简历生成器', 'PDF简历'],
    },
    docs: {
      title: '求职指南 - intro-builder',
      description: '系统化求职知识库：从信息差弥合到简历包装，再到学习路线规划。',
      keywords: ['求职指南', '简历技巧', '面试准备', '职业规划'],
    },
    blog: {
      title: '博客 - intro-builder',
      description: '求职资讯、招聘季提醒、行业洞察。',
      keywords: ['求职资讯', '校招', '实习', '秋招', '春招'],
    },
  },
};
