# Template Slot Fields Reference

供 template-studio skill、SlotRenderer 和校验脚本使用。本文档描述模板 HTML 中
`data-bind` 可用的展示字段。模板绑定的是渲染视图协议，不是 `resume.content`
内部字段路径。

## 核心边界

- `basic.*`：顶部基础身份信息，包含姓名、求职岗位、求职状态、头像。无 icon。
- `profile.contacts`：带 icon 的联系资料循环，包含电话、邮箱、城市、主页。
- `sectionOrder` / `section.*` / `section.items` / `item.*`：正文渲染协议。
- 自我介绍是正文模块，通过 `section.body` 渲染；它和个人总结 `summary` 是两个不同模块。
- 模板不得使用旧 `basics.*`，也不得使用 `profile.name/title/status/summary`。

## 1. Basic：顶部身份信息

| Binding | 类型 | 说明 |
| --- | --- | --- |
| `basic.name` | string | 姓名 |
| `basic.title` | string | 求职岗位 / 目标职位 |
| `basic.status` | string | 求职状态 |
| `basic.photo` | image | 头像 URL，只能用于 `<img data-bind="basic.photo">` |

`basic.title` 和 `basic.status` 必须在同一行、同样式展示。状态不属于联系方式，不加
icon，也不放进 `profile.contacts`。

```html
<header class="tpl-header">
  <img data-bind="basic.photo" class="avatar" alt="头像" />
  <h1><slot data-bind="basic.name"></slot></h1>
  <p class="headline">
    <slot data-bind="basic.title"></slot>
    <span class="headline-sep"> · </span>
    <slot data-bind="basic.status"></slot>
  </p>
</header>
```

## 2. Profile Contacts：带 Icon 联系资料

联系方式只能通过 `profile.contacts` 循环展示。渲染器从 `profile.phone`、
`profile.email`、`profile.location`、`profile.website` 派生列表。

```html
<slot data-bind="profile.contacts" data-template="contact-item">
  <template id="contact-item">
    <a class="contact" href="#">
      <slot data-bind="contact.icon"></slot>
      <slot data-bind="contact.label"></slot>
    </a>
  </template>
</slot>
```

| Binding | 类型 | 说明 |
| --- | --- | --- |
| `contact.type` | string | `phone` / `email` / `location` / `website` |
| `contact.icon` | icon | Phone / Mail / MapPin / Globe |
| `contact.label` | string | 显示文本 |
| `contact.href` | string | 可点击链接；location 为空 |

## 3. Section：正文分区

正文通过 `sectionOrder` 循环渲染。`data-template="section"` 必须同时提供
`section-list` 和 `section-block` 两个模板：结构化模块走 list，富文本块走 block。

```html
<slot data-bind="sectionOrder" data-template="section">
  <template id="section-list">
    <section>
      <h2><slot data-bind="section.title"></slot></h2>
      <slot data-bind="section.items" data-template="item"></slot>
    </section>
  </template>

  <template id="section-block">
    <section>
      <h2><slot data-bind="section.title"></slot></h2>
      <div class="section-body">
        <slot data-bind="section.body"></slot>
      </div>
    </section>
  </template>
</slot>
```

| Binding | 类型 | 说明 |
| --- | --- | --- |
| `section.id` | string | 正文分区 ID，如 `selfIntroduction`、`experience`、`summary` |
| `section.title` | string | 分区标题 |
| `section.icon` | icon | 分区图标 |
| `section.kind` | string | `list` 或 `block` |
| `section.body` | rich-text | block 模块正文 |
| `section.items` | loop | list 模块条目循环 |

自我介绍使用 `section.id = selfIntroduction`，内容来自 `selfIntroduction`；个人总结使用
`section.id = summary`，内容来自 `summary`。两者不合并。

## 4. Item：正文条目

`item.*` 是统一条目视图，由 adapter 从 experience、education、projects、research
派生。模板不直接绑定 `experience.company` 这类原始字段。

| Binding | 类型 | 说明 |
| --- | --- | --- |
| `item.title` | string | 公司、学校、项目或研究名称 |
| `item.subtitle` | string | 职位、学位专业、项目角色或研究角色 |
| `item.meta` | string | 技术栈、GPA 等补充信息 |
| `item.dateRange` | string | 时间范围 |
| `item.location` | string | 地点 |
| `item.bullets` | rich-text | 条目正文 |
| `item.tags` | string[] | 标签数组 |
| `item.link` | string | 项目 / 论文 / 成果链接 |

```html
<template id="item">
  <article class="item">
    <div class="item-head">
      <strong><slot data-bind="item.title"></slot></strong>
      <span><slot data-bind="item.dateRange"></slot></span>
    </div>
    <div class="item-sub">
      <span><slot data-bind="item.subtitle"></slot></span>
      <span><slot data-bind="item.location"></slot></span>
    </div>
    <div class="item-meta">
      <slot data-bind="item.meta"></slot>
      <a href="#"><slot data-bind="item.link"></slot></a>
    </div>
    <slot data-bind="item.bullets"></slot>
  </article>
</template>
```

## 5. 模板检查清单

- [ ] 顶部使用 `basic.name`、`basic.title`、`basic.status`。
- [ ] `basic.title` 和 `basic.status` 同行、同样式、无 icon。
- [ ] 头像使用 `<img data-bind="basic.photo">`。
- [ ] 联系方式使用 `profile.contacts` 循环和 `contact.*`。
- [ ] 不使用 `basics.*`、`basics.icon.*`。
- [ ] 不使用 `profile.name/title/status/summary`。
- [ ] 自我介绍和个人总结都走正文 section，不放在顶部 profile。
- [ ] `sectionOrder` 模板拆分为 `*-list` 和 `*-block`。
- [ ] block 模板包含 `section.body`。
- [ ] item 模板包含 `item.location`、`item.link`、`item.bullets`。
