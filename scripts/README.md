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

- **maintain-template-db.ts** - 模板数据库维护脚本（根级别）

## 使用

所有脚本通过 `tsx` 运行：

```bash
# 数据库迁移
pnpm db:migrate

# 创建开发用户
pnpm dev:ensure-user

# 验证模板
tsx scripts/templates/verify-templates.ts
```
