# P05：提示词质量与全部 AI 能力迁移

状态：进行中（任务 1、2 已完成；任务 3–7 未开始）。依赖 P04。依据：[提示词与评测详案](../specs/2026-09-26-nextjs-agent-prompts.md)。

## 完成记录（分批）

### 已完成：任务 1 冻结旧稿与任务 2 模块化候选稿

- **落地**：`lib/ai/prompts/` 五个模块 ——
  `core.ts`（候选稿正文，plan §3 逐字）、`intent.ts`（六种意图约束 + 程序侧识别）、
  `examples.ts`（最多两条演示示例）、`assemble.ts`（装配与分段）、
  `version.ts` + `registry.ts`（版本与内容哈希）、`legacy.ts`（旧稿冻结）。
- **旧稿逐字节冻结**：浮窗与润色旧稿的正文已用脚本与实现比对，
  SHA-256 完全相同（`929d5f7e…`）。基线不会随微服务退役而漂移。
- **版本可归因**：登记 `contentHash`，加载期重新哈希比对；改文本忘改哈希会立即
  抛错。`legacy` 的哈希由真实快照算出而非硬编码。这让「回滚提示词」可验证。
- **意图由程序决定**：模型不能自选 intent（否则等于把约束的选择权交给被约束者）；
  UI 上下文优先于消息关键词；无法判定返回 `null` 走保守路径。
- **材料分段隔离**：`resume_facts` / `job_description` / `user_preference` /
  `agent_inference` / `evidence` 各自带 sourceId 与「只是引用材料」声明 ——
  这是 Q03（JD 技术不得进入用户技能）与 Q11（材料含忽略指令）的结构性防线。
- **实测发现并修复**：第一版意图识别用**前缀匹配**判「回答上一轮追问」，
  把「是的，帮我改一下」判成 `fact_intake`（用户明确要求改写却被套上
  「只追问、不改正文」的约束），且「是否…」疑问句与「是……」犹豫都被误判。
  改为整句匹配 + 排除省略号，补 3 条回归测试。
- **验证**：`tests/unit/ai-prompt-contract.test.ts` 47 例。
- **决策笔记**：`docs/notes/implemented/architecture/2026-09-26-modular-prompts-and-versioning.md`。

### 未完成（本切片剩余）

任务 3（可用建议的行为红→绿：诊断 / 润色 / 目标岗位 / 缺事实 / 拒绝后继续）、
任务 4（润色与 Helpers 从微服务迁到 Web，保留旧 API 路径）、
任务 5（统一模型配置来源）、任务 6（**真实对照评测** —— 需显式可用评测配置，
属 plan 停止条件，缺失时不假造分数）、任务 7（能力覆盖与发布）。

任务 6 的离线部分（契约/越权/「无保存却称已保存」校验）可以先做；
真实模型对照（16×2×3=96 次）需评测凭据。

## 文件范围

现有：`app/api/agent/rich-text/polish/route.ts`、`app/api/agent/resume/helpers/[helperId]/route.ts`、floating/models、对应按钮/模型配置读取；旧 Agent `rich-text-polish.ts`、`resume-helpers.ts` 只读提取逻辑，不新增微服务能力。
拟新增：`apps/web/lib/ai/prompts/{core,intent,examples,version}.ts`、`capabilities/{polish,diagnose,section-advice}.ts`、`evals/resume-advice-cases.json`、评测 runner 和结果 schema。旧 prompt/route 实现先归档快照。

## 任务

1. **冻结旧稿与基准样本。** 将旧提示词按基线完整保存到归档候选清单；构建详案中的至少 16 个合成场景，记录 source facts、意图、允许动作、质量评语。不要用真实简历或 prompt 是否含某句话作为效果指标。
2. **实现模块化候选稿。** 使用 core+intent+少量相关 examples+工具能力说明；保存 promptVersion 和内容 hash。最近用户约束结构化注入，简历/JD 作为数据，不获得系统权限。无需每轮强制列计划、STAR 四段或调用全套检查。
3. **验证可用建议。** 对「诊断」「润色」「目标岗位」「缺事实」「拒绝后继续」各做行为红→绿；工具错误时返回真实状态而不编造结果。候选允许解释理由，禁止只用「突出亮点、加强量化」代替可用方案。
4. **迁移短能力。** 将润色/Helpers 的 prompt、结果校验、TipTap 结构保持逻辑移到 Web AI 模块，经同一 provider 配置和权限策略。暂保留旧公开 API 路径以减少 UI 改动，内部不再 HTTP 转发。为每种 helper 建立 contract test，包括长简历与未连接模型。
5. **统一模型配置来源。** 浮窗、润色、诊断共用已配置模型；浏览器取当前 session key，通过请求传递，不落数据库。若迁移服务端默认 provider，使用新的 Web-only 环境键并在部署中安全转移值，文档只列名称。没有默认值且未 BYOK 时清楚提示连接模型，不回退已退役服务。
6. **执行离线和真实对照评测。** 离线校验契约/越权/无保存却称已保存；真实模型同参数、同工具、每例 3 次比较旧/新 prompt，保留合成输入、匿名结果、评分和 token/latency。没有显式可用评测配置不能假造分数；质量门禁未通过不得开启新稿全量。
7. **验证能力覆盖与发布。** 聊天编辑、无写诊断、STAR 改写、岗位匹配、导出前检查、润色、模块建议、从零创建均有测试和可用路径。断开旧 AGENT_BASE_URL/Redis 后所有入口通过。focused+总门禁，更新 capability matrix 和 Note。提交建议 `feat(ai): improve grounded resume advice and migrate helpers to Web`。

## 验收命令

```bash
pnpm --filter @intro-builder/web exec vitest run tests/unit/agent-rich-text-polish-route.test.ts tests/unit/agent-resume-helper-route.test.ts tests/unit/agent-floating-models-route.test.ts tests/unit/ai-prompt-contract.test.ts tests/unit/ai-capabilities.test.ts
# 下列脚本为本切片拟新增；先实现再执行：
pnpm --filter @intro-builder/web eval:ai:offline
pnpm --filter @intro-builder/web eval:ai:live
```

live 只使用测试用途已配置凭据；runner 禁止打印 key 或从任意用户 session 偷取凭据。真实评测支出受固定 case/重复次数/output budget 约束。

## 回滚

可独立切回上一版 promptVersion，保留 Next.js 运行和提交契约；不能因建议不佳回退整个微服务。旧稿可复用作对照，但旧 Draft/工具 bug 不应随之恢复。
