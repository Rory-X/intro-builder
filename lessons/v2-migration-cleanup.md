# v2 重构完成后需清理的一次性文件

## 问题

`scripts/seed-builtin-templates.ts` 是 v2 模板重构的迁移脚本——把旧的 React 硬编码模板转写为 HTML+CSS 塞进 DB。这不是持续需要的 seed，重构完成后应删除。

## 清理清单

重构上线验证无误后，以下文件/目录一并清理：

- `scripts/seed-builtin-templates.ts` — 一次性迁移脚本
- `db/seed/template-abbey-stub.ts` — 早期 stub seed
- `docs/schema-v2/` — 设计文档（归档或删）
- `lib/templates/professional/`、`classic/`、`modern/` 旧 React 组件（被 DB HTML+CSS 取代后）

## 教训

不要把迁移脚本当作"seed 脚本保留在仓库是标准做法"——先看文件的实际用途再判断去留。
