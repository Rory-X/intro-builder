# P03：编辑器统一写入、来源与冲突保护

状态：**已完成**（2026-09-26）。依赖 P02。保持现有 RHF、预览与普通输入的即时响应。

## 完成记录

- **落地**：`lib/resume-mutations/editor-adapter.ts`（差量 → 语义命令）、
  `hooks/use-resume-mutation-session.ts`（基准 + dirty generation + 幂等重试）、
  `actions.ts` 的 `submitResumeMutation` / `getResumeMutationBaseline` /
  `submitResumeVersionRestore`、`commit.ts` 的 `commitResumeRestore`；
  编辑页接入身份初始化与统一写入。
- **关键决定与取舍**：见
  [决策笔记](../../notes/implemented/architecture/2026-09-26-editor-writes-through-revisioned-commit.md)。
- **验证**：`pnpm test`（120 文件 / 779 测试）、`pnpm typecheck`、`pnpm lint`
  （0 error，12 warning = 改动前基线）、`pnpm build`、`pnpm notes:verify`、
  `test:integration` 29/29 全部通过。

### 三条写入路径已收敛

| 路径 | 旧行为 | 现在 |
|---|---|---|
| 手动输入 | `saveResume` 整份覆盖写，无 revision | 差量 → 语义命令 → 原子提交 |
| 模板切换 | `setTemplate` 只改行、无留痕 | `set_template` 操作，与正文同一条 SQL |
| 恢复历史版本 | 两条独立 SQL（备份 + 正文） | `commitResumeRestore` 全量还原，同一 CTE |
| Agent 应用 | `form.setValue` + 额外 `createResumeVersion`（**两次写入**） | 只经统一提交；差异视图由回执 `versionId` 驱动 |
| 润色应用 | 直接 `setContent`，用户后续输入会被旧候选覆盖 | `polish-guard.ts` 先校验原文未变，冲突则保留用户输入 |
| 协作同步 | 远端改动被记成 `source: manual`（错误归因） | `setNextSource("collab")` 标注，只生效一次 |

### 实测发现（下一位不要重踩）

1. **不能用 `window` 判断「是否服务端」**：jsdom 也提供 `window`，会误杀 `actions.ts`
   的单测。判据用 `process.versions.node`。
2. **`form.getValues()` 返回活引用**：直接当基准会让基准随输入漂移，差量恒为空
   （表现为「一直保存中但永不落盘」）。基准与快照必须深拷贝。
3. **重试要复用逐字节相同的 payload**，不只是同一个 `mutationId`；否则 requestHash
   变化会让幂等判定失效。
4. **await 之后要读的关键值不能用 React state**（重渲染发生在 await 之后，读到旧值）。
   用 ref 同步读取 —— 这正是「查看差异」入口此前静默失效的原因。
5. **模板是独立 state，不在表单里**：只 `flush()` 会因「无待保存改动」直接返回，
   必须先 `schedule()`。
6. **`status === "idle"` ≠ 「刚保存成功」**：页面刚挂载也是 idle，据此更新保存时间会
   凭空显示「刚刚保存」。用 `committedCount > 0` 区分。

### 遗留（归 P04）

`use-resume-autosave.ts` / `saveResume` / `setTemplate` / `createResumeVersion` 仍在导出，
但**零编辑器调用点**。P04 之后若确认无其他调用方应一并删除。

## 独立模型复核记录

复核人：`deepseek-v4-flash-ioa`（tt 提供方），2026-09-26。只读复核，未修改仓库。

> **覆盖度说明**：本切片原本计划请两个不同模型各跑一次独立复核；
> `cursor-local` 提供方两次启动均失败且无产出，因此两份已交付的报告同源于一个模型。
> 各条发现均已由我独立复现确认，但「两个独立视角」这一目标未达成。

**判定：不成立** —— 复核者原文：「旧入口确实零调用点，但单例富文本完全存不进去、
styleSettings 首次改动直接崩溃并毒化整份文档、新增多条/新增+重排被误判冲突、
标题重命名不再落盘」。

复核确认成立的部分：
- 旧的无 revision 写入口（`saveResume` / `setTemplate` / `createResumeVersion`）
  在编辑器内确实**零调用点**。
- 回执到达前用户继续输入会被保留（`useResumeMutationSession` 从不 `form.reset()`）。
- 「已保存」假状态守卫正确（用 `committedCount > 0` 区分「从未保存」与「刚保存完」）。

复核发现并已修复的缺陷：
1. **单例富文本一个字都存不进去（阻断）**：adapter 产出
   `target:{section:"summary",field:"content"}` 且哈希整个 doc，而 prepare 去读 doc
   内层的 `content` 数组 —— 永不相等，summary/skills/awards/portfolio **全废**。
   修法：单例区块的值就是 doc，目标是整个 section（不带 field）。
2. **首次改样式崩溃并毒化整份文档（阻断）**：`emptyResumeContent()` 不含
   `styleSettings`，`hashValue(undefined)` 抛错且**不在 try/catch 内** →
   状态永久卡 `pending`，之后连正文也存不上。修法三处：
   `differs()` 防御 undefined；样式改用「存在性 + 值」两层判断；
   prepare 逐键校验并拒绝「patch 有键但 before 未给前置值」。
3. **`set_style` 的 `before: {}` 完全跳过条件校验**：可静默覆盖任意样式 → 已修。
4. **同一去抖窗口内的顺序推演**：连点两次「+ 添加」、新增后立刻拖拽、新增+删除
   全部 `order_mismatch`。修法：adapter 维护顺序推演，且**必须与 `orderOperations`
   的真实执行顺序一致**（插入优先级 0 先于删除 2 执行）。
   注意：曾试图放宽 `prepare` 的顺序校验，那削弱了并发增删检测并让两条正确测试失败，
   **已回退** —— 正确方向是让 adapter 算对，而不是让校验变松。
5. **标题重命名不再落盘（相对旧实现的回归）**：标题是独立 state 不在表单里，
   `form.watch` 不触发；旧 `use-resume-autosave` 有等价 title effect，迁移时漏掉 → 已修。
6. **`resetStyle` 被记录但从未生效**：`set_template` 的该字段被提交层丢弃，
   「切模板 = 切排版」的心智模型静默失效。修法：排版属于 content，由调用方
   额外产出一条 `set_style`（模板默认排版来自注册表），分层保持清晰。

复核发现但**未修**（已交接）：模板库「应用到已有简历」
（`app/(app)/templates/template-library-client.tsx`）仍走无 revision 的旧 `setTemplate`，
且默认整体覆盖 `styleSettings` —— P03 的统一写入只覆盖了编辑器，漏了这条路径。

复核者指出的**测试取样偏差**（本切片的主要教训）：
- `resume-mutation-prepare.test.ts` 对单例区块 `set_field` **零覆盖** → 漏掉「单例富文本全废」。
- adapter 样式测试用 `as never` 造假数据，且两边都有 `styleSettings`
  → 永远碰不到「首次改样式」的崩溃路径。
- 没有任何用例覆盖「一次去抖窗口内的多次增删排」→ 漏掉顺序推演缺陷。

结论：**门禁全绿只说明「已写下的断言成立」，不说明「没有未被想到的缺陷」。**
补测试时应按「输入维度」（区块类型 × 字段类型 × 批量场景）取样，而不是按代码路径取样。

完整发现与未修项：
[复核发现笔记](../../notes/implemented/bug-fix/2026-09-26-independent-review-findings-p01-p04.md)。

## 文件范围

现有：`apps/web/app/(app)/resume/[id]/edit/{actions,editor-client,page}.tsx/ts`（按实际扩展名）、`hooks/use-resume-autosave.ts`、`hooks/use-resume-history.ts`、`components/agent/agent-operation-apply.ts`、`components/editor/rich-text-editor.tsx`、`hooks/use-collab-form-sync.ts`、导入和复制 actions。
拟新增：`hooks/use-resume-mutation-session.ts`、`lib/resume-mutations/editor-adapter.ts` 与对应测试。页面文件改动前读本地 Next 指南。

## 任务

1. **接入 baseline 与 dirty generations。** 页面加载获得持久 ID/revision；hook 维护已确认基准和本地待提交操作，RHF 仍是输入状态。测试输入期间收到旧回执不擦除新字符、标题或模板选择。禁止每次回执全量 reset。
2. **改造 autosave。** 2 秒去抖保留，队列发送稳定 mutationId、expectedRevision、真实语义变化；重试同次请求固定 payload/ID，新编辑进入下一条。冲突保持 dirty 内容并暂停覆盖式重试；flush 必须等对应请求得到真实回执。
3. **收敛手动、模板、恢复。** saveResume、setTemplate、restore、Undo/Redo 调用统一模块；任意旧签名无法提供必要 revision 时返回升级/冲突提示，不允许忽略校验。普通 undo 用本地编辑命令，已保存 undo 使用反向 mutation。
4. **替换 Agent 前端保存职责。** 迁移期旧入口仍在时用统一提交 adapter；P04 后前端仅应用 commit receipt 到投影，不再对 server 已提交的 Agent 内容跑第二次 autosave。不允许同时 createResumeVersion；一次操作只产生一次提交。
5. **润色与来源。** 用户应用润色候选时走 source=polish 的同一提交契约，保留候选生成时目标和 revision；文本已变化返回冲突。取消候选不写。手动编辑、模板/样式、restore 有明确 server-derived 来源。
6. **协作保护。** 现有远端 Y.Map 更新不得绕过 revision 或被标记成个人本地输入。保留快照冲突分支；没有可靠签名来源时用「协作同步」而不编造导师身份。Agent 与活动协作的提交限制依规格实现，并在 UI 说明具体原因。
7. **验证与发布。** focused + 全套 DoD；手工冒烟输入/富文本/排序/模板/恢复/双标签页/协作同步。部署时提示旧标签页刷新，不能让旧 writer 剥离 ID。提交建议 `refactor(editor): route resume writes through revisioned mutations`。

## 必须的失败用例

- 修改请求保存中用户再输入；回执只确认旧 generation。
- 网络超时重试一次，内容和版本仍只提交一次。
- A/B 排序后旧 Agent 提案不能误改 B。
- 保存失败再 rollback 不能将失败期间新增的用户内容抹掉；优先不应用未确认远端结果。
- 模板和内容恢复来自同一修订，不出现模板已换正文未换。
- 两个 Agent 入口收到同一 receipt，不再次自动保存。

## 验收命令

```bash
pnpm --filter @intro-builder/web exec vitest run tests/unit/use-resume-autosave.test.ts tests/unit/use-resume-history.test.ts tests/unit/editor-client-version-history.test.tsx tests/unit/agent-apply-operation.test.ts tests/unit/resume-version-actions.test.ts tests/unit/use-resume-mutation-session.test.ts
```

增加润色/协作相关 focused 测试后记录准确文件名，再跑总门禁。需要统一 Note 说明 local dirty、已保存正文和协作投影三者如何协调。

## 回滚边界

允许关闭新的 Agent 入口或只读降级；不能恢复不带 revision 的旧 saveResume。数据库回滚保留历史；UI回退必须继续携带稳定 ID 和并发保护。
