# Monorepo 结构重构实施计划

**日期**：2026-06-11  
**Spec**：[2026-06-11-monorepo-structure-refactor.md](../specs/2026-06-11-monorepo-structure-refactor.md)  
**状态**：in_progress  
**预计工时**：8-10 小时（分 5 个阶段）

## 目标

将当前混乱的项目结构重构为标准 monorepo，实现 Web、Agent、PartyKit 三个应用的清晰分离，并抽取共享代码到 `packages/shared/`。

## 分阶段执行策略

每个阶段由独立 agent 执行，阶段间互不依赖（除非明确标注）。每个阶段完成后必须能通过基础验证。

---

## Phase 0: 准备工作（主 agent）

**负责人**：当前 agent  
**预计时间**：30 分钟  
**目标**：创建目录结构、更新 workspace 配置

### 任务

1. 创建目录结构：
   ```bash
   mkdir -p packages/shared/src/{types,schemas,utils}
   mkdir -p packages/config/{eslint,typescript}
   mkdir -p apps/web
   mkdir -p scripts/{db,dev,templates}
   ```

2. 创建 `packages/shared/package.json`：
   ```json
   {
     "name": "@intro-builder/shared",
     "version": "0.4.1",
     "private": true,
     "main": "src/index.ts",
     "types": "src/index.ts",
     "exports": {
       ".": "./src/index.ts",
       "./types": "./src/types/index.ts",
       "./schemas": "./src/schemas/index.ts",
       "./utils": "./src/utils/index.ts"
     }
   }
   ```

3. 创建 `packages/config/package.json`：
   ```json
   {
     "name": "@intro-builder/config",
     "version": "0.4.1",
     "private": true
   }
   ```

4. 更新 `pnpm-workspace.yaml`：
   ```yaml
   packages:
     - "apps/*"
     - "packages/*"
   
   onlyBuiltDependencies:
     - esbuild
   ignoredBuiltDependencies:
     - sharp
     - unrs-resolver
   ```

5. 提交：`git commit -m "chore: setup monorepo directory structure"`

### 验证

```bash
ls -la packages/shared/
ls -la packages/config/
ls -la apps/
cat pnpm-workspace.yaml
```

### 完成标准

- ✅ 目录结构创建完成
- ✅ workspace 配置更新
- ✅ 已提交

---

## Phase 1: 迁移 PartyKit（Agent 1）

**依赖**：Phase 0  
**预计时间**：30 分钟  
**目标**：将 `partykit/` 迁移到 `apps/partykit/` 并配置为独立应用

### 任务

1. 移动目录：
   ```bash
   mv partykit apps/partykit
   ```

2. 更新 `apps/partykit/package.json`：
   ```json
   {
     "name": "@intro-builder/partykit",
     "version": "0.1.0",
     "private": true,
     "main": "src/server.ts",
     "scripts": {
       "dev": "partykit dev",
       "build": "partykit build",
       "deploy": "partykit deploy",
       "typecheck": "tsc --noEmit"
     },
     "dependencies": {
       "@intro-builder/shared": "workspace:*",
       "partykit": "^0.0.111",
       "partysocket": "^1.0.2",
       "y-partykit": "^0.0.25"
     },
     "devDependencies": {
       "@types/node": "^20.19.39",
       "typescript": "^5.9.3"
     }
   }
   ```

3. 创建 `apps/partykit/tsconfig.json`：
   ```json
   {
     "extends": "../../tsconfig.json",
     "compilerOptions": {
       "module": "ES2022",
       "target": "ES2022",
       "lib": ["ES2022"],
       "moduleResolution": "bundler",
       "noEmit": true
     },
     "include": ["src/**/*"]
   }
   ```

4. 创建 `apps/partykit/README.md`：说明 PartyKit WebSocket 协同服务的职责

5. 运行 `pnpm install` 重新链接

6. 提交：`git commit -m "feat: migrate partykit to apps/partykit"`

### 验证

```bash
pnpm --filter @intro-builder/partykit typecheck
ls -la apps/partykit/
cat apps/partykit/package.json
```

### 完成标准

- ✅ `partykit/` 已移动到 `apps/partykit/`
- ✅ package.json 配置正确
- ✅ typecheck 通过
- ✅ 根目录不再有 `partykit/`
- ✅ 已提交

---

## Phase 2: 抽取 shared 代码（Agent 2）

**依赖**：Phase 0  
**预计时间**：2 小时  
**目标**：将共享的 schema、类型、utils 迁移到 `packages/shared/`

### 任务清单

#### 2.1 迁移 schemas
```bash
cp lib/resume-schema.ts packages/shared/src/schemas/resume-schema.ts
```

#### 2.2 迁移 types
```bash
# 创建类型文件
packages/shared/src/types/resume.ts     # ResumeData, Section 等
packages/shared/src/types/agent.ts      # AgentMessageRequest/Response
packages/shared/src/types/tiptap.ts     # TipTapJSON
```

从以下文件抽取：
- `lib/types.ts` → `types/resume.ts`
- `lib/agent/agent-message-contract.ts` → `types/agent.ts`
- `lib/tiptap-types.ts` → `types/tiptap.ts`

#### 2.3 迁移 utils
```bash
packages/shared/src/utils/tiptap.ts     # TipTap JSON 工具
packages/shared/src/utils/slug.ts       # slug 生成
```

从以下文件抽取：
- `lib/migrate-content.ts` → `utils/tiptap.ts`
- `lib/slug.ts` → `utils/slug.ts`

#### 2.4 创建导出文件
```typescript
// packages/shared/src/index.ts
export * from './schemas/resume-schema'
export * from './types/resume'
export * from './types/agent'
export * from './types/tiptap'
export * from './utils/tiptap'
export * from './utils/slug'
```

```typescript
// packages/shared/src/types/index.ts
export * from './resume'
export * from './agent'
export * from './tiptap'
```

```typescript
// packages/shared/src/schemas/index.ts
export * from './resume-schema'
```

```typescript
// packages/shared/src/utils/index.ts
export * from './tiptap'
export * from './slug'
```

#### 2.5 添加 tsconfig
```json
// packages/shared/tsconfig.json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "composite": true,
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

#### 2.6 运行 pnpm install

### 验证

```bash
pnpm --filter @intro-builder/shared typecheck
cat packages/shared/src/index.ts
cat packages/shared/package.json
```

### 完成标准

- ✅ schemas、types、utils 已迁移
- ✅ 导出文件创建完成
- ✅ typecheck 通过
- ✅ 已提交 `git commit -m "feat: extract shared code to packages/shared"`

---

## Phase 3: 迁移 Web 应用（Agent 3）

**依赖**：Phase 0, Phase 2  
**预计时间**：1 小时  
**目标**：将 Next.js 应用迁移到 `apps/web/`

### 任务

#### 3.1 移动核心目录
```bash
mv app apps/web/app
mv components apps/web/components
mv lib apps/web/lib
mv hooks apps/web/hooks
mv db apps/web/db
mv public apps/web/public
mv content apps/web/content
mv tests apps/web/tests
```

#### 3.2 移动配置文件
```bash
mv proxy.ts apps/web/proxy.ts
mv next.config.ts apps/web/next.config.ts
mv vitest.config.ts apps/web/vitest.config.ts
mv eslint.config.mjs apps/web/eslint.config.mjs
mv postcss.config.mjs apps/web/postcss.config.mjs
mv source.config.ts apps/web/source.config.ts
mv drizzle.config.ts apps/web/drizzle.config.ts
mv components.json apps/web/components.json
```

#### 3.3 复制环境变量模板
```bash
cp .env.example apps/web/.env.example
```

#### 3.4 创建 apps/web/package.json
从根 package.json 提取 Web 相关依赖，添加：
```json
{
  "name": "@intro-builder/web",
  "version": "0.4.1",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@intro-builder/shared": "workspace:*",
    // ... 其他依赖从根 package.json 复制
  }
}
```

#### 3.5 创建 apps/web/tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [
      {
        "name": "next"
      }
    ],
    "baseUrl": ".",
    "paths": {
      "@/*": ["./*"],
      "@shared/*": ["../../packages/shared/src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

#### 3.6 运行 pnpm install

### 验证

```bash
ls -la apps/web/
pnpm --filter @intro-builder/web typecheck
cat apps/web/package.json
```

### 完成标准

- ✅ 所有 Next.js 文件已迁移到 `apps/web/`
- ✅ package.json 配置正确
- ✅ tsconfig 路径映射正确
- ✅ 根目录清理完成
- ✅ 已提交 `git commit -m "feat: migrate web app to apps/web"`

---

## Phase 4: 更新导入路径（Agent 4）

**依赖**：Phase 2, Phase 3  
**预计时间**：3 小时  
**目标**：将 Web 中对共享代码的引用更新为从 `@intro-builder/shared` 导入

### 任务

#### 4.1 更新 resume-schema 导入
```bash
# 查找所有引用
grep -r "from '@/lib/resume-schema'" apps/web/

# 批量替换
find apps/web -type f \( -name "*.ts" -o -name "*.tsx" \) -exec sed -i '' "s|from '@/lib/resume-schema'|from '@intro-builder/shared/schemas'|g" {} +
```

#### 4.2 更新 types 导入
```bash
# lib/types.ts 中的类型
find apps/web -type f \( -name "*.ts" -o -name "*.tsx" \) -exec sed -i '' "s|from '@/lib/types'|from '@intro-builder/shared/types'|g" {} +
```

#### 4.3 更新 agent contract 导入
```bash
find apps/web -type f \( -name "*.ts" -o -name "*.tsx" \) -exec sed -i '' "s|from '@/lib/agent/agent-message-contract'|from '@intro-builder/shared/types'|g" {} +
```

#### 4.4 更新 TipTap 导入
```bash
find apps/web -type f \( -name "*.ts" -o -name "*.tsx" \) -exec sed -i '' "s|from '@/lib/tiptap-types'|from '@intro-builder/shared/types'|g" {} +
find apps/web -type f \( -name "*.ts" -o -name "*.tsx" \) -exec sed -i '' "s|from '@/lib/migrate-content'|from '@intro-builder/shared/utils'|g"  +
```

#### 4.5 更新 slug 导入
```bash
find apps/web -type f \( -name "*.ts" -o -name "*.tsx" \) -exec sed -i '' "s|from '@/lib/slug'|from '@intro-builder/shared/utils'|g"  +
```

#### 4.6 删除旧文件
```bash
rm apps/web/lib/resume-schema.ts
rm apps/web/lib/types.ts
rm apps/web/lib/agent/agent-message-contract.ts
rm apps/web/lib/tiptap-types.ts
rm apps/web/lib/migrate-content.ts
rm apps/web/lib/slug.ts
```

### 验证

```bash
pnpm --filter @intro-builder/web typecheck
pnpm --filter @intro-builder/web lint
grep -r "from '@/lib/resume-schema'" apps/web/ || echo "All replaced"
grep -r "from '@/lib/types'" apps/web/ || echo "All replaced"
```

### 完成标准

- ✅ 所有共享代码导入已更新
- ✅ 旧文件已删除
- ✅ typecheck 通过
- ✅ lint 通过
- ✅ 已提交 `git commit -m "refactor: update imports to use @intro-builder/shared"`

---

## Phase 5: 清理根目录和更新文档（Agent 5）

**依赖**：Phase 1, Phase 3, Phase 4  
**预计时间**：1 小时  
**目标**：清理根目录、更新根 package.json、重组 scripts、更新文档

### 任务

#### 5.1 重组 scripts
```bash
mv scripts/apply-favorites-migration.ts scripts/db/
mv scripts/check-users.ts scripts/db/
mv scripts/ensure-dev-user.ts scripts/dev/
mv scripts/patch-slot-coverage.ts scripts/templates/
mv scripts/rollback-crimson.ts scripts/db/
mv scripts/set-dev-resume-template.ts scripts/dev/
mv scripts/verify-lucide-whitelist.ts scripts/templates/
mv scripts/verify-templates.ts scripts/templates/
```

创建 `scripts/README.md` 说明各脚本用途。

#### 5.2 更新根 package.json
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
    "build:web": "pnpm --filter @intro-builder/web build",
    "build:agent": "pnpm --filter @intro-builder/agent build",
    
    "test": "pnpm --recursive test",
    "lint": "pnpm --recursive lint",
    "typecheck": "pnpm --recursive typecheck",
    
    "verify": "pnpm lint && pnpm typecheck && pnpm test && pnpm build",
    
    "db:migrate": "tsx scripts/db/apply-favorites-migration.ts",
    "dev:ensure-user": "tsx scripts/dev/ensure-dev-user.ts"
  },
  "devDependencies": {
    "typescript": "^5.9.3",
    "tsx": "^4.22.3"
  }
}
```

#### 5.3 更新 AGENTS.md

在「仓库地图」部分更新为：
```markdown
## 3. 仓库地图

\`\`\`
apps/
  web/                # Next.js 主站
    app/              # App Router 路由
    components/       # UI 组件
    lib/              # Web 专用工具
    hooks/            # React hooks
    db/               # Drizzle schema & migrations
    proxy.ts          # 鉴权拦截
  agent/              # Agent 微服务
    src/              # Agent 服务代码
    Dockerfile        # Docker 部署
  partykit/           # WebSocket 协同服务
    src/              # PartyKit server
packages/
  shared/             # 跨应用共享代码
    src/
      types/          # 共享类型
      schemas/        # Zod schemas
      utils/          # 通用工具
  config/             # 共享配置
docs/                 # 文档
scripts/              # monorepo 脚本
  db/                 # 数据库相关
  dev/                # 开发环境
  templates/          # 模板验证
\`\`\`
```

#### 5.4 更新 README.md

添加 monorepo 说明：
```markdown
## 项目结构

本项目采用 pnpm workspace monorepo 结构：

- `apps/web/` - Next.js 主站
- `apps/agent/` - Agent 微服务
- `apps/partykit/` - WebSocket 协同服务
- `packages/shared/` - 共享代码（types、schemas、utils）
- `packages/config/` - 共享配置

## 开发

\`\`\`bash
pnpm install          # 安装依赖
pnpm dev              # 启动所有应用
pnpm dev:web          # 只启动 Web
pnpm dev:agent        # 只启动 Agent
pnpm verify           # 运行所有检查
\`\`\`
```

#### 5.5 删除根目录旧文件
```bash
# 这些已经移到 apps/web/
rm -f next.config.ts vitest.config.ts eslint.config.mjs
rm -f postcss.config.mjs source.config.ts drizzle.config.ts
rm -f components.json proxy.ts
```

### 验证

```bash
pnpm verify
ls -la scripts/
cat README.md
cat AGENTS.md
```

### 完成标准

- ✅ scripts 重组完成
- ✅ 根 package.json 更新
- ✅ AGENTS.md 更新
- ✅ README.md 更新
- ✅ 根目录清理完成
- ✅ `pnpm verify` 全部通过
- ✅ 已提交 `git commit -m "chore: cleanup root and update docs"`

---

## 最终验证清单

在所有 Phase 完成后，执行：

```bash
# 1. 依赖链接
pnpm install

# 2. 类型检查
pnpm typecheck

# 3. Lint
pnpm lint

# 4. 测试
pnpm test

# 5. 构建
pnpm build

# 6. 本地启动
pnpm dev:web
pnpm dev:agent
```

所有命令必须成功。

---

## Agent 分配

| Phase | Agent | 预计时间 | 并行 |
|---|---|---|---|
| Phase 0 | 主 agent | 30min | - |
| Phase 1 | Agent 1 | 30min | ✅ 可与 Phase 2 并行 |
| Phase 2 | Agent 2 | 2h | ✅ 可与 Phase 1 并行 |
| Phase 3 | Agent 3 | 1h | ❌ 依赖 Phase 2 |
| Phase 4 | Agent 4 | 3h | ❌ 依赖 Phase 3 |
| Phase 5 | Agent 5 | 1h | ❌ 依赖 Phase 4 |

**并行策略**：Phase 1 和 Phase 2 可以同时启动。

---

## 回滚策略

如果某个 Phase 失败：

1. 查看该 Phase 的 git commit
2. `git revert <commit-hash>`
3. 修复问题后重新执行该 Phase

---

## 完成后的后续工作（不在本 plan）

- [ ] 引入 Turborepo
- [ ] 更新 CI/CD 路径
- [ ] 更新 Vercel 配置
- [ ] 更新 Docker 构建
- [ ] 添加 Changesets

---

## 状态追踪

- [ ] Phase 0: 准备工作
- [ ] Phase 1: 迁移 PartyKit
- [ ] Phase 2: 抽取 shared 代码
- [ ] Phase 3: 迁移 Web 应用
- [ ] Phase 4: 更新导入路径
- [ ] Phase 5: 清理根目录和更新文档
- [ ] 最终验证通过
