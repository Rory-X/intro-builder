# Next.js 简历助手改造执行入口

日期：2026-09-26。状态：方案已形成；各实施切片未开始。

本文件是多个可发布切片的导航与执行约束，不把全部改造伪装成一个 PR。使用顺序：先读[规格](../specs/2026-09-26-nextjs-agent-consolidation.md)，再按下表取一个切片执行。

执行实现前还必须读[契约附录](../specs/2026-09-26-nextjs-agent-contracts.md)，其中定义命令字段、Run/attempt、outbox 与路由迁移；不能在不同切片各自发明协议。

## 1. 方向已确定

- 唯一在线执行路线：Next.js + 现有 Vercel AI SDK v6。保留现有悬浮/停靠 UI，旧 AG-UI 面板和独立微服务退出线上后归档。
- 聊天、润色、诊断、模块建议全部迁入 Web，不能遗留隐性微服务调用。
- 修改和留痕一起提交；稳定条目身份；服务端提交回执驱动已保存状态。
- 改善提示词和实际建议质量，使用评测决定是否优于旧稿。
- 只移除线上链路/部署入口，旧代码和配置保留可核查归档。
- SSH 清理仅针对验证后的目标容器，不删共享网络或数据卷。

## 2. 当前交付与执行前提

已完成：只读代码核查、三个行为复现、部署盘点、本文档族、[静态 PoC](../pocs/2026-09-26-nextjs-agent-workspace.html)。PoC 状态测试通过，未进行浏览器视觉验收，不宣称生产 UI 已通过。

未完成：业务实现、数据库迁移、真实模型评测、生产切流、旧代码归档移动、工作流停用、容器删除。

执行前记录当前 HEAD、`origin/main` 和 dirty 状态。文档基线是 `050d5bb5e`，如代码已变化，先核对表中入口和结论，不机械覆盖。最初已有未提交的 `section-editor-header.tsx`、其测试和 `docs/notes/implemented/bug-fix/`，不属于本计划，不能还原或混入提交。

使用 `codex/` 分支和 PR。本计划不要求安装不存在的 superpowers skill，不默认启动子代理，不指定执行模型，不要求公开 GitHub issue。一次执行只领取一个切片或其中一个行为步骤。

## 3. 切片与依赖

| 切片 | 文件 | 依赖 | 可发布成果 |
| --- | --- | --- | --- |
| P01 | [稳定身份与命令契约](2026-09-26-nextjs-agent-01-document-identity.md) | 规格/PoC | 旧数据兼容、新条目身份稳定；新功能先不切流 |
| P02 | [原子提交与修订存储](2026-09-26-nextjs-agent-02-atomic-mutations.md) | P01 | 经真实事务验证的提交接口 |
| P03 | [编辑器写入与冲突保护](2026-09-26-nextjs-agent-03-editor-integration.md) | P02 | 手工/AI/润色/恢复共用可靠写入 |
| P04 | [Next.js Run 与统一工具](2026-09-26-nextjs-agent-04-nextjs-runtime.md) | P03 | 服务端执行与保存闭环、取消、检查点 |
| P05 | [提示词与能力迁移](2026-09-26-nextjs-agent-05-prompts-capabilities.md) | P04 | 所有 AI 入口脱离微服务、建议质量过线 |
| P06 | [工作可视化与完整留痕](2026-09-26-nextjs-agent-06-workspace-history.md) | P05 | 任务、预览、版本联动与条件撤销 |
| P07 | [切流与代码归档](2026-09-26-nextjs-agent-07-cutover-archive.md) | P06 | 线上唯一 Next.js 链路，旧实现完整归档 |
| P08 | [线上服务退役](2026-09-26-nextjs-agent-08-production-retirement.md) | P07 + 生产证据 | Agent 专属容器与部署路线退役 |

必须串行：P02→P03 的文档写入语义、P04→P05 的工具输出、P07→P08 的线上切流。提示词样本整理可提前进行，真实比较须使用同一新运行契约。

每份 plan 的顶层任务不超过 8 项。每项内部遵循一个公开行为的红→绿→必要重构；不是让一次提交改完整张任务表。若某项扩展到多模块且无法独立验收，在原 plan 拆成明确子任务再继续，不自行扩大产品范围。

## 4. 实施硬约束

1. 不把模型结果、前端 `setValue` 或 SSE 结束当保存成功。
2. 不用数组下标作为跨请求提案的最终身份，不忽略 expectedRevision。
3. 不用两个独立 SQL 写入来伪装原子留痕；不对 Neon HTTP 调用交互式 transaction。
4. 不通过 `after`/未 await 的 promise 承担唯一持久化；不承诺无限后台运行。
5. 不把 BYOK key、JWT、简历正文写入 Git、事件日志或归档；模型 key 不进入 prompt。
6. 不因为 fixture 使用 mock provider，就声称真实模型建议质量通过。
7. 不先关服务再发现润色/Helpers 还在调用它；退役前所有能力路径都要验证。
8. 不运行 `docker compose down`/prune/network rm，远端共享网络已经证实。
9. 旧实现必须先有基线清单和校验值，才能从线上目录移出；归档不进入现役构建和依赖发现。
10. 不更新无关 UI，不升级 Next/React/AI SDK major，不新建队列或微服务。

## 5. 质量门禁与命令

运行时对齐 Node 22 / pnpm 10。每个可发布切片：

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm notes:verify
```

验证当前脚本真实存在；不要用根 `pnpm tsc --noEmit` 或 `pnpm agent:dev`。开发时使用 `pnpm dev:web`；P07 前需要旧 Agent 对比时是 `pnpm dev:agent`。P07 之后 Agent build/dev 入口应退出根 scripts。

focused 测试直接调用工作区 Vitest，文件参数放在 `run` 后：

```bash
pnpm --filter @intro-builder/web exec vitest run tests/unit/agent-apply-operation.test.ts
pnpm --filter @intro-builder/agent exec vitest run --config vitest.config.ts tests/loop-runtime.test.ts
```

第二条只用于归档前的现状对比，不能把归档测试继续计为新系统业务验证。计划中标「拟新增」的测试文件必须先创建，不能声称现已存在。

真实事务测试使用单独的本地/临时 PostgreSQL 测试库，环境变量建议 `TEST_DATABASE_URL`；检测它与生产 DATABASE_URL 不同。既要有故障注入，也要通过相同命令公开接口验证并发。没有隔离测试库就停止该切片验收，不能拿 mocked db.update 代替。

必要 UI 冒烟集中在 P03、P06 和生产切流，覆盖改过的流程，不每个小提交都启动全站端到端。单页 PoC 已提供链接，可先由人查看。PDF/预览兼容必须对旧/新条目 ID 简历验证，业务人工验收完成才能勾选。

## 6. 发布矩阵

| 发布时点 | 允许状态 | 禁止状态 |
| --- | --- | --- |
| P01/P02 | additive schema，旧 UI 可正常运行，功能开关默认关闭 | 新 identity 被旧 writer 静默剥离后还生成新提案 |
| P03 | 所有现役 writer 携带 revision；旧标签页返回版本升级提示 | 旧 saveResume 绕过提交模块 |
| P04/P05 | Next 新链路按服务端灰度启用；旧服务仅作为短期回退 | 新旧执行同时处理同一 Run |
| P06/P07 | 新流、历史、所有 AI 能力通过；旧入口返回明确退役响应 | 环境开关可把用户悄悄切回旧服务 |
| P08 | Next 生产全能力证据齐全，旧自动部署已停 | 仅 health 通过就关闭服务 |

开关建议 `AI_RUNTIME_VERSION=legacy|next_v1`：只在迁移期存在于服务端；不允许浏览器直接决定后端版本。P07 完成后移除 legacy 分支和开关。数据库 schema additive 回滚保留；稳定 ID/revision 上线后，不得一键回退到不认识它们的 writer。

## 7. 关键失败场景清单

| 场景 | 必须观察到的结果 |
| --- | --- |
| 提案生成后 A/B 重排 | 仍按 ID 定位 A，或明确冲突；绝不修改 B |
| 提案生成后同字段手动修改 | 拒绝旧提案并保留手动内容 |
| 保存成功但响应丢失 | 重试同 ID 返回原回执，无第二版本 |
| 版本/业务事件插入失败 | 正文回滚，不出现无痕修改 |
| 两个标签页同 revision 保存 | 仅一个成功，另一个保留输入并提示冲突 |
| 文本生成结束但未保存 | 显示待保存/失败，不显示已完成修改 |
| 用户拒绝建议后继续 | 不换 ID 重提相同建议，不把拒绝写成已批准 |
| 用户停止/平台超时 | 已提交保留，后续写入受取消/lease 拦截 |
| 重放事件或刷新 | 无重复消息/修改/版本，恢复任务状态 |
| 撤销后有无关手工编辑 | 只撤销原目标，无关输入保留 |
| 老聊天含旧 operation JSON | 可读；不直接重新执行 |
| Redis/Agent URL 完全不可用 | 新聊天、润色、Helpers、保存都正常 |
| 同机其他服务 | 容器 ID/状态与保留网络不受退役影响 |

## 8. 执行任务模板

```text
阅读 docs/superpowers/specs/2026-09-26-nextjs-agent-consolidation.md，
以及执行入口和本次指定切片。只执行 Pxx 的第 n 项公开行为。
核对 HEAD 与文件是否已变化；保留现有未提交改动。
先说明本项输入、输出、允许修改文件、要证明的失败场景。
写一条失败测试，确认失败原因，再完成最小实现。
不要代替计划重新选择架构；若假设被证伪，写清证据和受影响接口后停下。
报告实际修改、测试命令与结果、未验证事项、下一任务。
本项不能越过切流/生产退役的前置条件。
```

停止条件：发现活跃 writer 无法携带 revision；事务不支持；条目 ID 不稳定；归档会丢失文件；待删除资源被其他业务共享；缺少生产访问或真实评测配置。报告具体缺口，不用关闭验证或添加类型断言绕过。

## 9. 本轮交付记录

只读确认：SSH 目标容器/挂载/网络；GitHub Agent workflow active；环境变量和 secret 仅查询名称。没有读取 secret 值、没有停容器、没有关工作流、没有提交/push。

GitHub secret 名称包含 `AGENT_DATABASE_URL`，虽然当前源码主要使用 Redis，也必须在退役前确认引用；不能把同名配置当成数据库可删除的依据。Vercel CLI 在当前 PATH 不可用，生产套餐/环境未核验。最后以[退役手册](../runbooks/2026-09-26-agent-service-retirement.md)的逐项记录为准。

本轮文档验证：`pnpm notes:verify` 通过；本地 Markdown 链接、8 个切片的步骤数量（均不超过 8）、措辞和空白检查通过；退役手册 4 段 bash 仅执行 `bash -n` 语法检查，没有执行其中变更命令；PoC 的提案隔离、失败不写、提交、重复回执、过期提案、条件撤销及保留无关输入检查通过。`git diff --check` 通过。

本轮没有运行业务 test/typecheck/lint/build、隔离数据库集成测试或真实模型效果评测，也没有浏览器视觉冒烟。上述未验证项归实施切片，不可把本文档完成当成重构已完成。
