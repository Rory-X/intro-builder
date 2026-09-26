# P05：提示词质量与全部 AI 能力迁移

状态：未开始。依赖 P04。依据：[提示词与评测详案](../specs/2026-09-26-nextjs-agent-prompts.md)。

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
