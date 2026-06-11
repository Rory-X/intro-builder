# Schema v2 Contract Map

本目录只描述协议边界，不替代运行时代码真源。

## 1. 数据库存储协议

数据库表结构的真源是 `db/schema.ts` 和 Drizzle migration。`resume-table.json`
与 `templates-table.json` 只是给 Agent / Skill 阅读的列说明快照；如果它们和
`db/schema.ts` 冲突，以 `db/schema.ts` 为准。

数据库只关心表、列、索引、外键和生命周期。`resume.content` 里面的业务字段不在
DB schema 重复定义，而由 `resume-content.json` 描述。

## 2. 简历内容协议

`resume-content.json` 描述 `resume.content` 这个 JSONB payload。表单、导入、
Agent、自动保存、完整度诊断都应该围绕这个协议工作。

核心分层：

- `basic`：顶部无 icon 基础身份信息，包含姓名、求职岗位、求职状态和头像。
- `profile`：带 icon 的联系资料，包含电话、邮箱、城市、主页。
- `selfIntroduction`：自我介绍，语义上属于正文分区，不属于顶部 profile。
- `summary`：个人总结，和自我介绍是不同正文模块。
- `sectionOrder`：正文模块排序，不控制顶部 basic/profile 的布局。

## 3. 模板渲染协议

`template-slot-fields.*` 和 `html-slot-protocol.json` 描述模板 HTML/CSS 能使用的
slot 协议。模板 Skill、模板库 HTML/CSS、SlotRenderer、verifier 都应该遵守它。

模板对外暴露的是渲染视图协议，不是 `resume.content` 的内部路径。模板不应该绑定
旧的 `basics.*`，也不应该把 `profile.name/title/status` 当作标准字段。

## 4. 样式协议

`style-settings.json` 描述用户可调排版参数和 CSS 变量。模板 CSS 必须消费这些变量，
否则排版控件、智能排版和 PDF 预览会漂移。

重复内容角色使用协议 class（如 `.item-title`、`.item-date`、`.item-body`、
`.section-body`、`.contact-item`）。模板 CSS 负责视觉值；SlotRenderer 负责空值隐藏、
联系方式基础间距、头像/图标尺寸、section body 基础行高等 renderer 底座规则。不要把
这些底座规则复制进模板库 CSS。
