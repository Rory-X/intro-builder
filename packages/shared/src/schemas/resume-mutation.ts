import { z } from "zod";

import { DEFAULT_STYLE_SETTINGS, StyleSettings } from "./resume-schema";
import { TipTapJSON } from "../types/tiptap";
import { hashValue } from "../utils/stable-hash";

/**
 * 文档语义命令契约（P01）。
 *
 * 这里的 schema 是浏览器与服务端共同使用的**唯一**命令契约：Agent 工具、编辑器
 * 手动写入、润色候选、历史恢复都必须产出这些 operation，不允许各自发明协议。
 * 见 docs/superpowers/specs/2026-09-26-nextjs-agent-contracts.md §2。
 *
 * 设计要点：
 * - 不暴露任意 JSONPath。定位一律是白名单 `section + itemId + field`，避免模型
 *   写出 `__proto__` / `constructor` / `a.b.c` 这类越权路径。
 * - 每个 operation 都携带**前置条件哈希**。提案生成与真正提交之间存在时间差，
 *   期间用户可能重排或手改；没有条件校验就会把 A 的建议写进 B（F03）。
 * - 条件哈希只作「预期」；服务端必须用实际存储内容重算后比对。
 */

/** 数组区块。条目身份由创建方生成一次，排序不改变它。 */
export const ARRAY_SECTION_KEYS = ["experience", "projects", "education", "research", "custom"] as const;
/** 单例区块。没有 itemId，字段直接落在简历顶层键上。 */
export const SINGLETON_SECTION_KEYS = ["basics", "summary", "skills", "awards", "portfolio"] as const;
export const RESUME_SECTION_KEYS = [...SINGLETON_SECTION_KEYS, ...ARRAY_SECTION_KEYS] as const;
export type ResumeSectionKey = (typeof RESUME_SECTION_KEYS)[number];
export type ArraySectionKey = (typeof ARRAY_SECTION_KEYS)[number];
export type SingletonSectionKey = (typeof SINGLETON_SECTION_KEYS)[number];

/**
 * 可写字段白名单。
 *
 * 必须与 ResumeContent 的实际字段对齐：写不存在的字段会静默落进 jsonb 却永不渲染，
 * 写 `id` 会破坏稳定身份，写 `ownerId` 一类字段属于越权。
 */
export const SECTION_FIELDS: Record<ResumeSectionKey, readonly string[]> = {
  basics: [
    "name",
    "status",
    "title",
    "email",
    "phone",
    "location",
    "website",
    "summary",
    "photo",
  ],
  summary: ["content"],
  skills: ["content"],
  awards: ["content"],
  portfolio: ["content"],
  experience: ["company", "title", "start", "end", "location", "content"],
  projects: ["name", "role", "location", "start", "end", "stack", "link", "content"],
  education: ["school", "degree", "major", "location", "start", "end", "gpa", "highlights"],
  research: ["name", "role", "location", "start", "end", "paperTitle", "link", "content"],
  custom: ["title", "content"],
};

export function isArraySectionKey(value: string): value is ArraySectionKey {
  return (ARRAY_SECTION_KEYS as readonly string[]).includes(value);
}

export function isSingletonSectionKey(value: string): value is SingletonSectionKey {
  return (SINGLETON_SECTION_KEYS as readonly string[]).includes(value);
}

/** 条目身份不会被任何命令改写：它由创建方生成一次，之后只读。 */
export const IMMUTABLE_ITEM_FIELDS = ["id"] as const;

/** 任何 section 下都不允许的字段（原型链键与授权字段）。 */
const FORBIDDEN_FIELDS = ["__proto__", "constructor", "prototype", "ownerId", "userId"];

const FIELD_NAME = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/, "字段名必须是简单标识符，不能是属性路径")
  .refine((name) => !(IMMUTABLE_ITEM_FIELDS as readonly string[]).includes(name), {
    message: "条目身份不可由命令改写",
  })
  .refine((name) => !FORBIDDEN_FIELDS.includes(name), {
    message: "该字段不属于简历内容契约",
  });

const ITEM_ID = z.string().min(1).max(128);
const VALUE_HASH = z.string().regex(/^[0-9a-f]{64}$/, "必须是规范化 SHA-256 十六进制");

/** 条件：目标当前值的规范化哈希。 */
export const Condition = z.object({ expectedValueHash: VALUE_HASH });
export type Condition = z.infer<typeof Condition>;

/**
 * 目标定位。单例区块无 itemId；数组区块必须有 itemId。
 *
 * 用两个显式对象 + `z.union`（而不是按枚举展开 `discriminatedUnion`）是因为
 * zod v3 的 `discriminatedUnion` 要求字面量元组，展开数组会让类型推断退化成
 * `unknown`，于是 `SECTION_FIELDS[target.section]` 这类白名单校验在编译期就失效。
 */
export const Target = z.union([
  z.object({
    section: z.enum(SINGLETON_SECTION_KEYS),
    itemId: z.undefined().optional(),
    field: FIELD_NAME.optional(),
  }),
  z.object({
    section: z.enum(ARRAY_SECTION_KEYS),
    itemId: ITEM_ID,
    field: FIELD_NAME.optional(),
  }),
]);
export type Target = z.infer<typeof Target>;

/** field 缺省表示「整块」（例如 basics 一次给多个字段）。 */
export function isFieldAllowed(section: ResumeSectionKey, field: string | undefined): boolean {
  if (field === undefined) return true;
  return SECTION_FIELDS[section].includes(field);
}

const TIPTAP_FIELDS = new Set(["content", "highlights"]);
const STRING_ARRAY_FIELDS = new Set(["stack"]);

/**
 * 按 section+field 决定期望类型。刻意不使用 `z.any`：契约 §2 明确禁止直接放行。
 */
function valueSchemaFor(section: ResumeSectionKey, field: string | undefined): z.ZodTypeAny {
  if (field && TIPTAP_FIELDS.has(field)) return TipTapJSON;
  if (field && STRING_ARRAY_FIELDS.has(field)) return z.array(z.string().max(2000)).max(200);
  if (section === "basics" || field !== undefined) return z.string().max(20000);
  return z.record(z.unknown());
}

const opId = z.object({ id: z.string().min(1).max(128) });
const sectionIdList = z.array(ITEM_ID).min(1).max(500);
const sectionKeyList = z.array(z.string().min(1).max(128)).min(1).max(200);

/** 样式 patch 只接受 StyleSettings 已声明的键；数值域交给 StyleSettings 本身校验。 */
const STYLE_KEYS = Object.keys(DEFAULT_STYLE_SETTINGS);

/**
 * 封闭判别联合：每个分支都是纯 ZodObject（zod v3 的 discriminatedUnion 不接受
 * ZodEffects）。跨字段校验统一放在下面的外层 superRefine 里。
 */
export const SemanticOperationShape = z.discriminatedUnion("kind", [
  opId.extend({
    kind: z.literal("set_field"),
    target: Target,
    condition: Condition,
    value: z.unknown(),
  }),
  opId.extend({
    kind: z.literal("insert_item"),
    section: z.enum(ARRAY_SECTION_KEYS),
    itemId: ITEM_ID,
    /** null 表示插到最前。必须显式给出，避免用数组下标定位。 */
    afterItemId: ITEM_ID.nullable(),
    expectedOrderHash: VALUE_HASH,
    value: z.record(z.unknown()),
  }),
  opId.extend({
    kind: z.literal("delete_item"),
    target: Target,
    condition: Condition,
  }),
  opId.extend({
    kind: z.literal("reorder_items"),
    section: z.enum(ARRAY_SECTION_KEYS),
    beforeIds: sectionIdList,
    afterIds: sectionIdList,
  }),
  opId.extend({
    kind: z.literal("set_section_order"),
    before: sectionKeyList,
    after: sectionKeyList,
  }),
  opId.extend({
    kind: z.literal("set_style"),
    before: z.record(z.unknown()),
    patch: z.record(z.unknown()),
  }),
  opId.extend({
    kind: z.literal("set_title"),
    before: z.string().max(200),
    after: z.string().max(200),
  }),
  opId.extend({
    kind: z.literal("set_template"),
    before: z.string().max(200),
    after: z.string().max(200),
    /**
     * 本次换模板是否**意图**重置排版，必须显式表态（不能靠默认值猜）。
     *
     * 注意：这个字段只是**意图记录**（写入回执供追溯），它本身不改变文档 ——
     * 排版存在 `content.styleSettings` 里，而 `set_template` 只改 resume 行。
     * 真正的重置由调用方额外产出一条 `set_style` 操作表达（见 editor-adapter 的
     * `templateStyleReset`），因为只有调用方知道模板注册表里的默认排版。
     */
    resetStyle: z.boolean(),
  }),
]);

export type SemanticOperationShape = z.infer<typeof SemanticOperationShape>;

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const left = [...a].sort();
  const right = [...b].sort();
  return left.length === right.length && left.every((v, i) => v === right[i]);
}

/**
 * 带跨字段校验的操作 schema。顺序依赖（插入→更新）由 prepare 阶段按有向依赖排序，
 * 这里只保证单条命令自身自洽。
 */
export const SemanticOperation = SemanticOperationShape.superRefine((op, ctx) => {
  switch (op.kind) {
    case "set_field": {
      const { section, field } = op.target;
      if (!isFieldAllowed(section, field)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["target", "field"],
          message: `字段 ${field} 不属于 ${section}`,
        });
        return;
      }
      const parsed = valueSchemaFor(section, field).safeParse(op.value);
      if (!parsed.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["value"],
          message: `值不符合 ${section}${field ? "." + field : ""} 的类型契约`,
        });
      }
      return;
    }
    case "insert_item": {
      if (op.afterItemId === op.itemId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["afterItemId"],
          message: "新条目不能以自身为相邻锚点",
        });
      }
      const unknownKeys = Object.keys(op.value).filter(
        (key) =>
          !SECTION_FIELDS[op.section].includes(key) &&
          !(IMMUTABLE_ITEM_FIELDS as readonly string[]).includes(key),
      );
      if (unknownKeys.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["value"],
          message: `新条目含非法字段：${unknownKeys.join("、")}`,
        });
      }
      return;
    }
    case "reorder_items": {
      if (new Set(op.beforeIds).size !== op.beforeIds.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["beforeIds"], message: "beforeIds 含重复 ID" });
      }
      if (new Set(op.afterIds).size !== op.afterIds.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["afterIds"], message: "afterIds 含重复 ID" });
      }
      if (!sameSet(op.beforeIds, op.afterIds)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["afterIds"],
          message: "排序前集合与排序后集合必须一致",
        });
      }
      return;
    }
    case "set_section_order": {
      /*
       * 允许**增删成员**，只禁止重复。
       *
       * 契约明确规定「section 隐藏通过 sectionOrder 表达，不等同于删除正文」：
       * 隐藏 = 从 sectionOrder 移除，显示 = 加回。若强制前后集合一致，
       * hide/show 这两个必需能力将无法表达 —— P04 的工具移植正是因此被挡住。
       *
       * 这仍然是安全的：本操作**碰不到 content**，所以「隐藏」永远不会删掉
       * 用户的正文，只是不渲染。真正的破坏性操作（清空正文、删除条目）
       * 由 `delete_item` / `set_field` 显式表达。
       *
       * （此前要求集合一致是 P01 的实现疏漏，与契约冲突。）
       */
      if (new Set(op.after).size !== op.after.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["after"],
          message: "模块顺序不能含重复模块",
        });
      }
      if (new Set(op.before).size !== op.before.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["before"],
          message: "before 不能含重复模块",
        });
      }
      return;
    }
    case "set_style": {
      const keys = Object.keys(op.patch);
      if (keys.length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["patch"], message: "样式 patch 不能为空" });
        return;
      }
      const unknown = keys.filter((key) => !STYLE_KEYS.includes(key));
      if (unknown.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["patch"],
          message: `样式 patch 含未知字段：${unknown.join("、")}`,
        });
        return;
      }
      if (!StyleSettings.safeParse({ ...DEFAULT_STYLE_SETTINGS, ...op.patch }).success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["patch"],
          message: "样式取值超出允许范围",
        });
      }
      return;
    }
    default:
      return;
  }
});

export type SemanticOperation = z.infer<typeof SemanticOperation>;

/**
 * 操作种类。用具名导出是因为工具能力矩阵需要引用它 ——
 * 否则每个引用点都要写 `SemanticOperation["kind"]`，读起来也更难对照契约。
 */
export type SemanticOperationKind = SemanticOperation["kind"];

export const OPERATION_KINDS = [
  "set_field",
  "insert_item",
  "delete_item",
  "reorder_items",
  "set_section_order",
  "set_style",
  "set_title",
  "set_template",
] as const satisfies readonly SemanticOperation["kind"][];

export const MUTATION_ID_MAX_LENGTH = 128;

/**
 * 一次逻辑提交固定一个 mutationId：超时重试必须复用同一个 ID 和同一份 payload，
 * 服务端才能把重试识别为幂等重放，而不是第二次修改。新的编辑必须换 ID。
 */
export const MutationCommand = z.object({
  mutationId: z.string().min(1).max(MUTATION_ID_MAX_LENGTH),
  resumeId: z.string().min(1).max(128),
  expectedRevision: z.number().int().min(0),
  operations: z.array(SemanticOperation).min(1).max(200),
  changeSetId: z.string().min(1).max(128).optional(),
  changeSetVersion: z.number().int().min(1).optional(),
  decisionId: z.string().min(1).max(128).optional(),
});
export type MutationCommand = z.infer<typeof MutationCommand>;

/** 提交结果。只有 committed 才代表服务端回执已经落盘。 */
export const CommitResult = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("committed"),
    mutationId: z.string(),
    revision: z.number().int().min(1),
    versionId: z.string(),
    eventId: z.string(),
    operationIds: z.array(z.string()),
    changeSetId: z.string().nullable(),
    committedAt: z.string(),
  }),
  z.object({
    status: z.literal("conflict"),
    currentRevision: z.number().int().min(0),
    targets: z.array(Target),
  }),
  z.object({ status: z.literal("no_change"), currentRevision: z.number().int().min(0) }),
  z.object({ status: z.literal("rejected"), code: z.string() }),
]);
export type CommitResult = z.infer<typeof CommitResult>;

/** HTTP 状态映射（契约 §3）。UI 不得把失败包装成 200 + success。 */
export const COMMIT_HTTP_STATUS: Record<CommitResult["status"], number> = {
  committed: 200,
  conflict: 409,
  no_change: 200,
  rejected: 422,
};

/** 目标当前值的规范化哈希。客户端算的只是**预期**，服务端必须重算。 */
export function hashTargetValue(value: unknown): string {
  return hashValue(value);
}

/** 请求规范化哈希，用于幂等键的「同 ID 同 payload」判定。 */
export function hashMutationPayload(
  command: Pick<MutationCommand, "resumeId" | "expectedRevision" | "operations">,
): string {
  return hashValue({
    resumeId: command.resumeId,
    expectedRevision: command.expectedRevision,
    operations: command.operations,
  });
}
