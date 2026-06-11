# Monorepo 结构重构设计

**日期**：2026-06-11  
**状态**：draft  
**负责人**：架构重构

## 问题陈述

当前项目结构混乱，Next.js Web 应用代码散落在根目录，与 monorepo 其他部分混在一起：

1. **根目录污染**：`app/`、`components/`、`lib/` 等 Next.js 内容与 `apps/agent/`、`partykit/` 同级
2. **partykit 未 app 化**：`partykit/` 仍在根目录，未纳入统一的 `apps/*` 管理
3. **缺少共享层**：Agent、Web、PartyKit 之间没有 `packages/shared/` 抽取公共代码
4. **scripts 混乱**：数据库、开发、模板验证脚本堆在一起
5. **路径别名不统一**：各应用独立配置，难以维护

## 目标

将项目重构为标准 monorepo 结构：

```
intro-builder/
├── apps/
│   ├── web/          # Next.js 主站
│   ├── agent/        # Agent 微服务
│   └── partykit/     # WebSocket 协同
├── packages/
│   ├── shared/       # 共享类型、schema、utils
│   └── config/       # 共享配置（tsconfig、eslint）
├── scripts/          # monorepo 脚本
├── docs/             # 文档
└── package.json      # workspace 根
```

## 非目标

- 不改变产品功能
- 不改变 API 契约
- 不升级依赖版本
- 不改变部署流程（先保持 Vercel/Docker 配置不变）

## 设计原则

1. **渐进式迁移**：分阶段执行，每个阶段可独立验证
2. **零停机**：保证每次 commit 都能跑通 `pnpm verify`
3. **最小依赖图**：`packages/shared/` 不依赖任何 app
4. **明确边界**：Web、Agent、PartyKit 职责清晰

## 详细设计

### 1. apps/web/ 迁移

**迁移内容**：
```
根目录 → apps/web/
├── app/
├── components/
├── lib/
├── hooks/
├── db/
├── public/
├── content/
├── tests/
├── proxy.ts
├── next.config.ts
├── tsconfig.json
├── vitest.config.ts
├── eslint.config.mjs
├── postcss.config.mjs
├── source.config.ts
├── drizzle.config.ts
├── components.json
└── .env.example
```

**保留在根目录**：
- `docs/`
- `scripts/`（会重新组织）
- `package.json`（workspace 根）
- `pnpm-workspace.yaml`
- `.github/`
- `.gitignore`
- `README.md`
- `AGENTS.md`

### 2. apps/partykit/ 迁移

```bash
mv partykit/ apps/partykit/
```

新增 `apps/partykit/package.json`：
```json
{
  "name": "@intro-builder/partykit",
  "private": true,
  "scripts": {
    "dev": "partykit dev",
    "build": "partykit build",
    "deploy": "partykit deploy"
  },
  "dependencies": {
    "@intro-builder/shared": "workspace:*",
    "partykit": "^0.0.111"
  }
}
```

### 3. packages/shared/ 创建

**目录结构**：
```
packages/shared/
├── src/
│   ├── types/
│   │   ├── resume.ts
│   │   ├── agent.ts
│   │   └── tiptap.ts
│   ├── schemas/
│   │   └── resume-schema.ts
│   ├── utils/
│   │   ├── tiptap.ts
│   │   └── slug.ts
│   └── index.ts
├── package.json
└── tsconfig.json
```

**抽取策略**：
- ✅ Zod schemas：`lib/resume-schema.ts` → `packages/shared/src/schemas/`
- ✅ 类型定义：`lib/types.ts`、`lib/agent/agent-message-contract.ts` → `packages/shared/src/types/`
- ✅ TipTap 工具：`lib/tiptap-types.ts`、`lib/migrate-content.ts` → `packages/shared/src/utils/`
- ✅ Slug 生成：`lib/slug.ts` → `packages/shared/src/utils/`
- ❌ React 组件：保留在 `apps/web/components/`
- ❌ Server Actions：保留在 `apps/web/app/`
- ❌ DB schema：保留在 `apps/web/db/`

### 4. packages/config/ 创建

```
packages/config/
├── eslint/
│   └── index.mjs
├── typescript/
│   ├── base.json
│   ├── nextjs.json
│   └── node.json
└── package.json
```

### 5. scripts/ 重组

```
scripts/
├── db/
│   ├── migrate.ts
│   ├── seed.ts
│   └── check-users.ts
├── dev/
│   └── ensure-dev-user.ts
├── templates/
│   └── verify-templates.ts
└── README.md
```

### 6. 根 package.json 简化

```json
{
  "name": "intro-builder",
  "version": "0.4.1",
  "private": true,
  "scripts": {
    "dev": "pnpm --parallel --filter './apps/*' dev",
    "dev:web": "pnpm --filter @intro-builder/web dev",
    "dev:agent": "pnpm --filter @intro-builder/agent dev",
    "dev:partykit": "pnpm --filter @intro-builder/partykit dev",
    
    "build": "pnpm --filter './apps/*' build",
    "test": "pnpm --recursive test",
    "lint": "pnpm --recursive lint",
    "typecheck": "pnpm --recursive typecheck",
    
    "verify": "pnpm lint && pnpm typecheck && pnpm test && pnpm build"
  },
  "devDependencies": {
    "typescript": "^5.9.3"
  }
}
```

## 路径映射调整

### apps/web/tsconfig.json
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./*"],
      "@shared/*": ["../../packages/shared/src/*"]
    }
  }
}
```

### 导入调整示例
```typescript
// 之前
import { resumeSchema } from '@/lib/resume-schema'
import type { ResumeData } from '@/lib/types'

// 之后
import { resumeSchema } from '@intro-builder/shared/schemas'
import type { ResumeData } from '@intro-builder/shared/types'
```

## 验证标准

每个阶段完成后必须通过：
```bash
pnpm install          # 依赖重新链接
pnpm lint             # 全部通过
pnpm typecheck        # 全部通过
pnpm test             # 全部通过
pnpm build            # 全部构建成功
```

## 部署影响

### Vercel (Web)
- 需要指定根目录为 `apps/web/`
- 环境变量保持不变
- 构建命令：`cd ../.. && pnpm install && cd apps/web && pnpm build`

### Docker (Agent)
- 更新 `apps/agent/Dockerfile` 的 COPY 路径
- `docker build -f apps/agent/Dockerfile .`

### PartyKit
- 更新部署命令：`pnpm --filter @intro-builder/partykit deploy`

## 风险

1. **路径引用爆炸**：Web 有 ~500+ 文件使用 `@/` 导入，需批量替换
   - 缓解：先移动文件结构，路径调整分批进行
2. **CI/CD 路径断裂**：GitHub Actions 可能引用旧路径
   - 缓解：迁移前先更新 `.github/workflows/`
3. **本地开发环境失效**：团队成员需要重新 `pnpm install`
   - 缓解：在 PR 中明确说明

## 后续优化（不在本次范围）

- 引入 Turborepo 加速构建
- 添加 Changesets 管理版本
- 统一 Docker Compose 开发环境
- 抽取 `packages/ui/` 共享 UI 组件

## 成功标准

- ✅ 所有代码迁移到 `apps/` 和 `packages/`
- ✅ 根目录只保留 workspace 配置和文档
- ✅ `pnpm verify` 通过
- ✅ 本地 `pnpm dev:web` 可正常启动
- ✅ 本地 `pnpm dev:agent` 可正常启动
- ✅ 文档（AGENTS.md、README.md）已更新
