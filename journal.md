# intro-builder 工作日志

---

## 2026-05-29　v2 渲染器头像图片绑定（feature/v2-avatar-img）

### 本次目标
修复「渲染器没头像」bug：v2 uploaded 模板（如 abbey-blue）无法显示用户上传的头像。根因——v2 SlotRenderer 只能把 binding 渲染成文本，没有图片机制（`html-slot-renderer.tsx` 注释自陈 "no image-content mechanism yet"）。目标是在**引擎层加通用图片绑定能力**，让任意 v2 模板都能放头像（形状/尺寸归模板 CSS，引擎只管注入 src）。

### 已完成并 commit（`91757d0` @ `feature/v2-avatar-img`，5 files +183）
- **引擎** `lib/templates/uploaded/html-slot-renderer.tsx`：replace visitor 识别 `<img data-bind="basics.photo">`，`attributesToProps` 把 class/alt 转 React props 并注入 src；photo 空 → 返回 `<></>`（不渲染，避免裂图/React19 空 src 报错）。
- **binding** `lib/templates/uploaded/slot-bindings.ts`：新增 `IMAGE_BINDINGS` + `isImageBinding`；`basics.photo` 移出 `BASICS_BINDINGS`（文本路径）；`<slot data-bind="basics.photo">` 改成报错引导用 `<img data-bind>`。
- **契约** `template-studio-skill/SKILL.md` :210 + binding 表：头像改用 `<img data-bind="basics.photo">`。
- **迁移** `scripts/apply-avatar-img-migration.ts`：幂等、dry-run 默认，把 abbey-blue 装饰 div → `<img data-bind>` + CSS 加 `object-fit:cover`。
- **测试** `tests/unit/html-slot-renderer.test.tsx`：+5 用例（注入/空值不渲染/属性保留/非法 binding/slot 误用）。

### 验证（DoD 全绿）
- `pnpm test` 297 passed、`tsc --noEmit` 通过、`lint` 0 errors、`build` 成功。
- dev 冒烟（curl 李四 preview，templateId=abbey-blue）：渲染出 `<img class="abbey-blue-avatar" alt="头像" src="https://…blob…/dev-user/…png">`，data-bind 不泄漏 ✅。
- **DB 已改**：abbey-blue 的 `--commit` 已执行（dev 库），div→img + object-fit。

### ⚠️ 当前阻塞 / 重启后从这里接
1. **合并 main 被阻塞**：另一个并行 session 在做「前3内置模板 schema 化」，它在 `slot-bindings.ts` 有**未提交改动**悬在共享 working tree（`resolveSection` basics title="自我介绍"、`derivePresetItems` skills `tags=[]`），挡住 `git checkout main`。
   - **这改动是对方的劳动，勿 stash/reset/checkout 覆盖**（会丢）。
   - 和我的改动不冲突（不同函数，正交）。
   - **解锁步骤**：等对方 commit 它的改动 → working tree 干净 → `git checkout main && git merge --ff-only feature/v2-avatar-img`（fast-forward，秒级）。
2. **不 push**（等用户授权）；用户**尚未浏览器手动测试**头像（一直被并发问题打断）。
3. 待办：合并后清冗余分支 `feature/v2-avatar-image`（与本分支重名易混，对方掺了 ExportButton）、`backup-before-rebase-98ac14e`、`backup/pre-upstream-merge`。

### 给对方 session 的协调提示词（已发，存档备用）
> 1. 你在 `slot-bindings.ts` 的未提交改动（basics title、skills tags）悬在共享工作区挡住了 main 合并，请先 commit 到你自己的分支（别留工作区悬着，共享区未提交的东西会被对方 git 操作覆盖）。
> 2. v2 引擎已加图片绑定：`<img data-bind="basics.photo" alt="头像" class="...">`，引擎注入 src、空值不渲染，即将进 main。
> 3. 三个模板头像统一用 `<img data-bind="basics.photo">`，不要用 `<slot>`，不要自造图片机制，不要改 `html-slot-renderer.tsx` 图片逻辑。commit 后基于最新 main rebase。

### git 状态快照（重启后核对）
- 当前分支 `feature/v2-avatar-img` @ `91757d0`（头像功能，安全）
- `main` @ `2575088`（未含头像，待合并）
- working tree：`M slot-bindings.ts`（对方未提交，勿覆盖）+ `?? app/dev-preview/template/classic-v2/`（对方的）

### 坑（下个 agent 必读）
- **两个 Claude session 共享同一 working tree + HEAD**，互相 stash/切分支会让对方未提交改动消失。本次我的改动一度被对方 `stash -u` 收走（在 stash 里找回，没丢）。**重启第一件事 `git status`，未提交改动可能是对方的活，别擅自 stash/reset/checkout。** 长期解法：两条线各开 `git worktree` 物理隔离。
- 头像左侧编辑器裂图的根因是 vercel blob 海外域名国内加载慢（独立的存储合规问题，不在本次范围）。
- `DATABASE_URL` 是 dev 库（用户确认线上另有库），含真实简历数据，改 DB 谨慎。
