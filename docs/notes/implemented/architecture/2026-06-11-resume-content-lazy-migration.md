# Agent Note: 简历内容用 jsonb 懒迁移，不做一次性数据回填

Status: implemented

## Problem

`resume.content` 是 Postgres `jsonb` 列，由 `packages/shared/src/schemas/resume-schema.ts` 的 Zod schema 定义形状。随着功能演进 schema 必然会加字段、改字段语义。如果直接改 schema 而不处理存量数据，线上旧简历在 parse 时会抛 Zod 错——**表现为用户打开自己几个月前的简历直接 500**，且这类错误只在存量数据上出现，本地新数据测试完全发现不了。

同时 Drizzle migration 只能改表结构，改不了 `jsonb` 里的历史内容。把数据回填写进 migration 又会让迁移不可逆、在大表上难以执行。

## Decision

内容演进走**读侧懒迁移**，分两类处理：

- **新增字段**：在 Zod schema 上用 `.default(...)` 或 `.optional().default(...)`，保证旧数据能 parse 通过；旧数据在用户第一次保存时自然升级到新形状。不写数据回填脚本。
- **重命名 / 删除字段**：在 `packages/shared/src/utils/migrate-content.ts` 的 `migrateContent(raw)` 里加读侧迁移，把旧形状转成新形状，并补样本单测。

只有**表结构**改动（加列、加索引）才走 Drizzle migration。**表结构改动 + 存量 jsonb 回填方案必须同时写进当期 plan**，不允许只改 schema 就交。

## Alternatives considered

- **一次性数据回填（migration 里 `UPDATE` 全部存量行）** — 能让库内数据形状立刻统一，读路径不需要兼容分支。但 `resumes` 表随用户增长，写 migration 时的全表更新会长时间锁表；且回填脚本一旦出 bug 影响所有历史简历，而懒迁移把风险限制在「单条记录被打开时」，可单独修复。放弃。
- **读侧严格校验，遇到旧数据报错让用户重填** — 实现最简单。但它把 schema 演进的成本转嫁给用户，且历史简历可能承载用户的真实求职资料，不可接受。
- **给 `content` 加版本号字段，按版本分支解析** — 显式、可审计。但每条记录都要手工维护版本号与迁移分支的对应关系，而懒迁移用「parse 时补齐」达到了同样效果且无需额外状态；版本号只在将来出现无法自动推导的语义断裂时才值得引入。

## Consequences

- **收益**：schema 演进不会因存量数据导致线上 500；改动是纯函数且可单测（`migrateContent` 的输入输出可锁死）。旧的纯 `string[]` 富文本格式到 TipTap JSON 的迁移就是这样完成的。
- **代价与已知上限**：库里长期存在「未升级的旧形状」记录，读路径必须一直保留兼容分支；直到某天才能真正清理。**重访触发条件**：当兼容分支累积到难以维护，或旧形状占比可忽略时，再做一次性清理（届时是独立的 plan，带明确的回填与验证步骤）。

## Verification

- 契约：`packages/shared/src/schemas/resume-schema.ts`。
- 读侧迁移：`packages/shared/src/utils/migrate-content.ts`。
- 单元测试：`apps/web/tests/unit/migrate-content.test.ts`（reader 迁移样本）、`apps/web/tests/unit/resume-schema.test.ts`（约束「旧字段 + 新字段」都能 parse）、`apps/web/tests/unit/db-connection.test.ts`。
- 回归方式：`pnpm test` 覆盖上述单测；改动 schema 后确认旧形状样本仍能 parse。
