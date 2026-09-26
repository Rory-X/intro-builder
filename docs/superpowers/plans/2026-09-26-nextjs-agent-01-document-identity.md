# P01：稳定文档身份与命令契约

状态：**已完成**（2026-09-26，基于 `050d5bb5e`）。依赖：[规格](../specs/2026-09-26-nextjs-agent-consolidation.md)。输出供 P02 使用，不切换 Agent 运行路线。

## 完成记录

- **落地**：条目 `id` 兼容字段（**无 schema default**）、封闭语义命令契约
  （`packages/shared/src/schemas/resume-mutation.ts`）、确定性身份补齐、
  纯 prepare 应用器、旧 operation 兼容映射、全部创建入口接入稳定 ID。
- **关键决定与取舍**：见[决策笔记](../../notes/implemented/architecture/2026-09-26-stable-item-identity-and-mutation-commands.md)。
- **验证**：`pnpm test` 117 文件 / 737 测试通过；`pnpm typecheck` / `pnpm lint`
  （0 error，warning 与改动前基线同为 12）/ `pnpm build` / `pnpm notes:verify` 全通过。
- **未做（归 P02）**：持久 CAS 落库。因此当前只声称「身份计算完成」，
  **不声称**新身份已被服务端写入保护。
- **实测发现**：`react-hook-form` 的 `fields[i].id` 是 RHF 内部渲染 key，
  **不是**业务 `id`（`getValues()` 里的才是）。生成业务 ID 必须走
  `apps/web/lib/resume-mutations/item-id.ts`，不能复用 `fields[i].id`。
- **接口修正**：`title` / `templateId` 是 resume **行**的列而非 content 字段，
  prepare 通过 `rowPatch` 单独返回，不塞进 `nextContent`。

## 独立模型复核记录

复核人：`deepseek-v4-flash-ioa`（tt 提供方），2026-09-26。只读复核，未修改仓库。

> **覆盖度说明**：本切片原本计划请两个不同模型各跑一次独立复核；
> `cursor-local` 提供方两次启动均失败且无产出，因此两份已交付的报告同源于一个模型。
> 各条发现均已由我独立复现确认，但「两个独立视角」这一目标未达成。

**判定：部分成立** —— 身份机制本身成立，但编辑页的初始化顺序会让存量文档被清空。

复核确认成立的部分（自建探针独立验证）：
- 确定性身份补齐（同一输入重复调用得到同一套 ID）。
- 重复 ID 被拒绝，而不是悄悄改名。
- 旧文档读时兼容：不报错，且**不会**每次 parse 产生新 ID。
- 命令契约封闭：`__proto__` / `a.b` / `ownerId` 等任意属性路径被拒绝。
- 手写 SHA-256 与 `node:crypto` 在中文、emoji、55/56/57/64 字节边界上**逐字节一致**。

复核发现并已修复的缺陷：
1. **存量 v1 文档正文被静默清空（阻断）**：编辑页把原始 jsonb 交给身份初始化，
   `ResumeContent.parse` 会剥掉 v1 的 `experience[].bullets` 并把 `content` 填成空 doc，
   随后 CAS 写回库 —— 用户文案消失。修法：读侧迁移前移到编排层入口
   （`initializeIdentitiesInStore` 先跑 `migrateContent`），而不是靠各调用方记得。
2. **孤立代理的 SHA-256 与 `node:crypto` 不一致**：手写实现按 CESU-8 风格把孤立代理
   编成三字节，而标准行为（`TextEncoder`/`Buffer`）替换为 U+FFFD。
   经 `hashValue` 不可达（`JSON.stringify` 会转义），但 `sha256Hex` 是导出 API，
   且文件头承诺跨端一致 —— 已按标准修正，并加对照 `node:crypto` 的回归测试。

复核者指出的**测试取样偏差**：本切片的身份逻辑有覆盖，但
「补齐身份会经过 `ResumeContent.parse`」这条路径没有被任何测试覆盖到旧格式数据 ——
所以「存量文档被清空」逃过了 1016 个单测。

结论：**门禁全绿只说明「已写下的断言成立」，不说明「没有未被想到的缺陷」。**

完整发现与未修项：
[复核发现笔记](../../notes/implemented/bug-fix/2026-09-26-independent-review-findings-p01-p04.md)。

## 文件范围

现有：`packages/shared/src/schemas/resume-schema.ts`、`packages/shared/src/utils/migrate-content.ts`、共享 exports、`apps/web/lib/agent/apply-operation.ts`、各 array editor 的新增条目构造、导入/复制入口。
拟新增：`packages/shared/src/schemas/resume-mutation.ts`、`apps/web/lib/resume-mutations/identity.ts`、`prepare.ts`；测试放 Web `tests/unit/resume-mutation-contract.test.ts`、`resume-item-identity.test.ts`、`resume-mutation-prepare.test.ts`。

## 任务

1. **建立条目身份兼容样本。** Red：旧 experience/project/education/research 无 ID 仍可读；带 ID 多次 parse 和 reorder 不改变；custom 不被重写。Green：增加兼容 ID 字段，新增条目生成一次 ID。不能在 schema default 中随机生成。
2. **实现初始化的纯计算。** 输入 resumeId+旧 content，输出补齐 ID 的 content 和 changed 标记；固定样本验证重复调用一致、不改文案/顺序、重复 ID 拒绝、同字段复制生成新 ID。此处只计算，持久 CAS 在 P02；不写只读页面。
3. **定义封闭命令联合。** 覆盖字段更新、插入/删除、条目排序、模块顺序/显示、样式、模板/标题。目标用 itemId；旧值条件、mutationId、expectedRevision 必填。为非法字段、重复排序 ID、删除错目标写反例。Zod 主版本以 shared 已安装版本为准，不顺手升级。
4. **实现纯 prepare。** 从当前结构化 content 找到稳定目标，校验前置条件，返回 nextContent、真实 before/after、changedTargets、inverse；不能信任模型提供的 beforePlainText。保留原样无变化返回 no-op。空正文/样式数值/TipTap marks 按业务 schema 校验。
5. **旧操作仅做兼容映射。** 只有具备同一已确认基准 revision 的即时旧 operation 可映射；历史纯下标提案显示「内容已更新，请重新生成」，不从当前数组猜 ID。新增、删除和多项依赖有明确顺序。复现 A/B 重排用例先失败后通过。
6. **盘点所有构造方与文档。** 搜索 array `append/insert`、resume import/duplicate 和 fixtures，逐个记录迁移情况。更新现有懒迁移 Note 的事实，保留原决定；新增 proposed/implemented Note 与此行为同批提交。
7. **验证和发布。** 跑 focused、全套 DoD；预览/PDF/导入旧数据冒烟。此切片不启用跨请求 Agent 新提案，直到所有 writer 支持身份。提交建议 `feat(resume): add stable item identities and mutation contracts`。

## 验收命令

```bash
pnpm --filter @intro-builder/web exec vitest run tests/unit/resume-schema.test.ts tests/unit/migrate-content.test.ts tests/unit/agent-apply-operation.test.ts tests/unit/resume-item-identity.test.ts tests/unit/resume-mutation-contract.test.ts tests/unit/resume-mutation-prepare.test.ts
```

然后执行[总门禁](2026-09-26-nextjs-agent-execution.md)。没有真实持久 CAS 前，只能声称身份计算完成。

## 风险与回滚

旧客户端 parse 可能剥离新 ID，必须由后续服务器写入口保护；P01 additive schema 不删除旧字段。公开数据读取不产生写入。若历史记录不能可靠对齐，降级旧式展示并禁用单项撤销，不能发明身份映射。
