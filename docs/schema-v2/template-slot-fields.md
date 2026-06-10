# Template Slot Fields Reference

> 供 template-studio skill 和校验脚本使用。描述模板 HTML 中 `data-bind` 可用的全部字段。

## 核心概念

- **表单字段来源**：所有数据来自 `ResumeContent`（定义在 `lib/resume-schema.ts`），模板只负责"显示"而非定义数据结构。
- **新模板统一用 `profile.*` 前缀**：`basics.*` 是旧模板兼容写法，新模板不要使用。
- **字段非必填**：以下字段是模板 HTML **应该留出的显示位置**，用户没填时为空即可，模板不应因字段为空而出现布局塌陷。

---

## 命名空间总览

| 命名空间 | 用途 | 循环/单值 |
|----------|------|-----------|
| `profile.*` | 基础信息（姓名、头衔、状态、头像） | 单值 |
| `profile.contacts` | 联系方式列表（电话、邮箱、城市、主页） | 循环 |
| `contact.*` | 单条联系方式（在 `profile.contacts` 循环内使用） | 单值 |
| `sectionOrder` | 简历分区顺序 | 循环 |
| `section.*` | 当前分区的元信息 | 单值 |
| `section.items` | 当前分区的条目列表 | 循环 |
| `item.*` | 单条经历/项目/教育条目 | 单值 |

---

## 1. Profile（基础信息）

新模板统一使用 `profile.*`，不要使用 `basics.*`。

| Binding | 类型 | 说明 |
|---------|------|------|
| `profile.name` | string | 姓名 |
| `profile.title` | string | 求职方向 / 职位头衔；模板顶部必须留显示位置 |
| `profile.status` | string | 求职状态（如"在看机会"）；模板顶部必须留显示位置 |
| `profile.photo` | image | 头像 URL。**必须用 `<img data-bind="profile.photo">`，不能用 `<slot>`** |
| `profile.summary` | string | 自我介绍 |

### 头像用法

```html
<!-- 正确 -->
<img data-bind="profile.photo" class="avatar" alt="头像" />

<!-- 错误：slot 不能渲染图片 -->
<slot data-bind="profile.photo"></slot>
```

### 城市显示

城市**不在** `profile.*` 直接暴露。城市通过 `profile.contacts` / `contact.*` 循环显示（type=location），避免和联系方式区域重复出现。

---

## 2. Contacts（联系方式循环）

联系方式由渲染器从 basics 自动派生（phone → Phone, email → Mail, location → MapPin, website → Globe），模板通过循环展示：

```html
<slot data-bind="profile.contacts" data-template="contact-item">
  <template id="contact-item">
    <span class="contact">
      <slot data-bind="contact.icon"></slot>
      <slot data-bind="contact.label"></slot>
    </span>
  </template>
</slot>
```

| Binding | 类型 | 说明 |
|---------|------|------|
| `contact.icon` | icon | Lucide 图标（自动匹配 type） |
| `contact.label` | string | 显示文本（电话号码 / 邮箱 / 城市 / URL） |

---

## 3. Section Order（分区循环）

```html
<slot data-bind="sectionOrder" data-template="section-block">
  <template id="section-block">
    <section>
      <h2><slot data-bind="section.title"></slot></h2>
      <slot data-bind="section.body"></slot>
      <slot data-bind="section.items" data-template="item-block">
        <template id="item-block">
          <!-- item.* bindings here -->
        </template>
      </slot>
    </section>
  </template>
</slot>
```

| Binding | 类型 | 说明 |
|---------|------|------|
| `section.title` | string | 分区标题（如"工作经历""教育背景"） |
| `section.body` | rich-text | 分区级富文本内容；模板必须留显示位置，block section 会优先走此槽 |
| `section.items` | loop | 该分区下的条目列表 |

---

## 4. Item（条目字段）

每个条目由渲染器从 experience/education/projects/research 统一映射而来：

| Binding | 类型 | 来源 | 说明 |
|---------|------|------|------|
| `item.title` | string | company / school / project name | 主标题（公司/学校/项目名） |
| `item.subtitle` | string | title / degree+major / role | 副标题（职位/学位/角色） |
| `item.dateRange` | string | start – end | 时间范围 |
| `item.location` | string | location | 地点（城市/远程）；模板必须留显示位置 |
| `item.meta` | string | stack.join(" · ") / gpa | 技术栈 / GPA 等补充信息 |
| `item.link` | string | link | 项目链接 / 论文链接；模板必须留显示位置，空值时隐藏 |
| `item.bullets` | rich-text | content / highlights | 详细描述（TipTap 富文本） |

### 完整条目模板示例

```html
<template id="item-block">
  <div class="item">
    <div class="item-header">
      <span class="item-title"><slot data-bind="item.title"></slot></span>
      <span class="item-subtitle"><slot data-bind="item.subtitle"></slot></span>
      <span class="item-date"><slot data-bind="item.dateRange"></slot></span>
    </div>
    <div class="item-meta-row">
      <span class="item-location"><slot data-bind="item.location"></slot></span>
      <span class="item-meta"><slot data-bind="item.meta"></slot></span>
      <a class="item-link" href="#"><slot data-bind="item.link"></slot></a>
    </div>
    <div class="item-content">
      <slot data-bind="item.bullets"></slot>
    </div>
  </div>
</template>
```

---

## 5. 旧写法兼容（basics.*）

以下字段仍可用但**新模板不应使用**：

| 旧 Binding | 等价新写法 |
|------------|-----------|
| `basics.name` | `profile.name` |
| `basics.title` | `profile.title` |
| `basics.email` | 通过 `contact.label` 显示 |
| `basics.phone` | 通过 `contact.label` 显示 |
| `basics.location` | 通过 `contact.label` 显示 |
| `basics.website` | 通过 `contact.label` 显示 |
| `basics.status` | `profile.status` |
| `basics.summary` | `profile.summary` |
| `basics.photo` | `profile.photo`（img 标签） |
| `basics.icon.*` | 通过 `contact.icon` 自动处理 |

---

## 6. AI 生成模板检查清单

新模板 HTML 应满足以下条件：

- [ ] 使用 `profile.*` 而非 `basics.*`
- [ ] 头像用 `<img data-bind="profile.photo">`
- [ ] 联系方式用 `profile.contacts` 循环 + `contact.icon` / `contact.label`
- [ ] 城市不在 profile 区单独显示（已含在 contacts 里）
- [ ] `profile.title` 和 `profile.status` 都有显示位置
- [ ] `item.location` 有显示位置（用户填了地点不应丢失）
- [ ] `item.meta` 有显示位置（技术栈/GPA 不应丢失）
- [ ] `item.link` 有显示位置（项目链接不应丢失）
- [ ] `section.body` 有显示位置；同一 section 模板里可同时保留 `section.items`，引擎会避免 block 模块双渲染
- [ ] 所有字段为空时布局不塌陷
