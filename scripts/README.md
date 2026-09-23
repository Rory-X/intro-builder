# Scripts

Monorepo 管理和维护脚本。

## 目录结构

- **db/** - 数据库相关脚本
  - `apply-favorites-migration.ts` - 应用收藏迁移
  - `check-users.ts` - 检查用户数据
  - `rollback-crimson.ts` - 回滚 Crimson 模板相关更改

- **dev/** - 开发环境脚本
  - `ensure-dev-user.ts` - 创建/确保开发用户存在
  - `set-dev-resume-template.ts` - 为开发简历设置模板

- **templates/** - 模板相关脚本
  - `patch-slot-coverage.ts` - 修补插槽覆盖率
  - `verify-lucide-whitelist.ts` - 验证 Lucide 图标白名单
  - `verify-templates.ts` - 验证所有模板配置

- **notes/** - 决策笔记的校验与归档（`docs/notes/` 的门禁）
  - `verify-agent-note-tree.ts` - 目录/分类/文件名/笔记间相对链接
  - `verify-agent-note-format.ts` - 头块骨架、必备节、implemented 禁提案标题
  - `verify-archived-agent-notes.ts` - 归档封印（SHA-256 + git 基线只增不改）
  - `archive-agent-note.ts` - 归档：物理移动 + 封印 + 入站死链报告
  - `check-note-anchors.ts` - 软报告：源码 `// Note:` 锚点，恒退出 0

- **maintain-template-db.ts** - 模板数据库维护脚本（根级别）

> **一次性脚本用完即删**：迁移 / 验证脚本在目标完成后不要留在仓库当 seed——
> 它看起来可执行、实际已过期，会误导后来的人。判断依据是实际用途，不是命名。
> 详见 `docs/notes/implemented/process/2026-06-04-delete-one-off-migration-scripts.md`。

## 使用

所有脚本通过 `tsx` 运行：

```bash
# 数据库迁移
pnpm db:migrate

# 创建开发用户
pnpm dev:ensure-user

# 验证模板
tsx scripts/templates/verify-templates.ts

# 决策笔记门禁（CI 跑这个）
pnpm notes:verify
```
