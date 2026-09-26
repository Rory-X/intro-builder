import type { ArraySectionKey, ResumeContent } from "@intro-builder/shared/schemas";
import { ARRAY_SECTION_KEYS, ResumeContent as ResumeContentSchema } from "@intro-builder/shared/schemas";
import { hashValue } from "@intro-builder/shared/utils";

/**
 * 条目稳定身份的**纯计算**部分。
 *
 * 本文件只回答「补齐后应该长什么样」，不碰数据库。真正的 CAS 持久化在 P02 的
 * 提交模块里完成 —— 这样身份计算可以先被确定性测试覆盖，也不会让公开只读页
 * 意外产生写入。
 *
 * 为什么需要它：experience/projects/education/research 以前靠**数组下标**定位
 * （`experience.0.content`）。提案生成后用户重排，A 的建议就会落到 B 上（F03，
 * 已在内存复现）。持久 ID 是把这个地址修成稳定引用的前提。
 */

/** 需要条目身份的数组区块。custom 已有 ID（`custom_0` 形式），不参与补齐。 */
export const IDENTITY_SECTIONS = ["experience", "projects", "education", "research"] as const;
export type IdentitySection = (typeof IDENTITY_SECTIONS)[number];

export type IdentityAssignment = {
  section: IdentitySection;
  index: number;
  itemId: string;
  /** 用于生成确定性 ID 的内容指纹，便于事后核对该 ID 属于哪一条目。 */
  contentHash: string;
};

export type InitializeIdentityInput = {
  resumeId: string;
  content: ResumeContent;
};

export type InitializeIdentityResult =
  | {
      ok: true;
      content: ResumeContent;
      changed: boolean;
      assigned: IdentityAssignment[];
    }
  | {
      ok: false;
      reason: "duplicate_item_id";
      section: IdentitySection;
      itemId: string;
      /** 出现重复的条目下标，便于服务端日志与用户提示定位。 */
      indexes: number[];
    };

/**
 * 确定性 ID 生成。
 *
 * 用 `resumeId + section + index + contentHash` 派生，保证：
 * - 同一份输入**重复调用得到完全相同的 ID**（幂等）。持久 CAS 失败重试时不会
 *   每次算出不同身份，否则重试就变成「又改了文档」。
 * - `contentHash` 里含下标，所以「同一条内容被复制成两份」会得到不同 ID。
 * - 不同简历不会撞号。
 *
 * 不能用 `Math.random()` / `randomUUID()`：那会让失败重试产生第二套身份。
 */
function deriveItemId(
  seed: { resumeId: string; section: IdentitySection; index: number; contentHash: string },
): string {
  const digest = hashValue({
    v: 1,
    resumeId: seed.resumeId,
    section: seed.section,
    index: seed.index,
    contentHash: seed.contentHash,
  });
  return `itm_${seed.section.slice(0, 2)}_${digest.slice(0, 24)}`;
}

/**
 * 条目内容指纹。`id` 不参与，否则未补齐的条目与补齐后的条目算出的指纹不同，
 * 无法验证「补齐没有改动内容」。
 */
function itemContentHash(item: Record<string, unknown>, index: number): string {
  const rest: Record<string, unknown> = {};
  for (const key of Object.keys(item)) {
    if (key === "id") continue;
    rest[key] = item[key];
  }
  return hashValue({ index, item: rest });
}

/**
 * 为缺失 ID 的条目补齐身份。
 *
 * 行为约定：
 * - 已有 ID 的条目**原样保留**（包括 custom 的既有 ID）。
 * - 文案、顺序、sectionOrder 一律不动。
 * - 已全部具备 ID 时返回 `changed=false`，不产生写入。
 * - 同一数组内出现重复 ID 时**拒绝**整个请求，而不是悄悄改名 —— 重复 ID 意味着
 *   历史数据已经损坏，继续操作只会让定位进一步失准。
 */
/**
 * 按动态 section 名读写 `ResumeContent` 的**唯一**转换点。
 *
 * `ResumeContent` 的每个区块字段类型都不同，用变量名索引在 TS 里必然不兼容。
 * 与其散落 `as unknown as` 断言，不如集中到一处，并在写回时用 `ResumeContent.parse`
 * 重新校验 —— 这样「补齐 ID」不可能悄悄破坏内容契约。
 */
type ContentRecord = Record<string, unknown>;

function asRecord(content: ResumeContent): ContentRecord {
  return content as unknown as ContentRecord;
}

function rawSection(content: ResumeContent, section: string): ContentRecord[] {
  const raw = asRecord(content)[section];
  return Array.isArray(raw) ? (raw as ContentRecord[]) : [];
}

/** 用校验过的对象重建 ResumeContent；失败时报错，而不是静默产出坏内容。 */
function rebuild(content: ResumeContent, section: string, items: ContentRecord[]): ResumeContent {
  const merged = { ...asRecord(content), [section]: items };
  const parsed = ResumeContentSchema.safeParse(merged);
  if (!parsed.success) {
    throw new Error(
      `补齐条目身份后内容不再符合契约：${parsed.error.issues[0]?.message ?? "未知原因"}`,
    );
  }
  return parsed.data;
}

export function initializeItemIdentities(input: InitializeIdentityInput): InitializeIdentityResult {
  const { resumeId, content } = input;
  const assigned: IdentityAssignment[] = [];
  let next = content;
  let changed = false;

  for (const section of IDENTITY_SECTIONS) {
    const items = rawSection(content, section);
    if (items.length === 0) continue;

    // 先做一次重复检测：重复 ID 是硬错误，不能被后续补齐掩盖。
    const seen = new Map<string, number[]>();
    items.forEach((item, index) => {
      const id = item?.id;
      if (typeof id !== "string" || id.length === 0) return;
      const hits = seen.get(id) ?? [];
      hits.push(index);
      seen.set(id, hits);
    });
    for (const [itemId, indexes] of seen) {
      if (indexes.length > 1) {
        return { ok: false, reason: "duplicate_item_id", section, itemId, indexes };
      }
    }

    let sectionChanged = false;
    const nextItems = items.map((item, index) => {
      const existingId = item?.id;
      if (typeof existingId === "string" && existingId.length > 0) return item;

      const contentHash = itemContentHash(item, index);
      const itemId = deriveItemId({ resumeId, section, index, contentHash });
      assigned.push({ section, index, itemId, contentHash });
      sectionChanged = true;
      return { ...item, id: itemId };
    });

    if (sectionChanged) {
      next = rebuild(next, section, nextItems);
      changed = true;
    }
  }

  return { ok: true, content: next, changed, assigned };
}

/** 取某条目数组里全部已有 ID，按当前顺序返回（缺失的记为 null）。 */
export function readItemIds(
  content: ResumeContent,
  section: ArraySectionKey,
): Array<string | null> {
  return rawSection(content, section).map((item) =>
    typeof item?.id === "string" && item.id.length > 0 ? item.id : null,
  );
}

/** 按稳定 ID 定位条目下标；找不到返回 -1。绝不回退到下标猜测。 */
export function findItemIndexById(
  content: ResumeContent,
  section: ArraySectionKey,
  itemId: string,
): number {
  return rawSection(content, section).findIndex((item) => item?.id === itemId);
}

/** 所有数组区块的 ID 集合，用于「集合一致」类校验。 */
export function collectItemIds(content: ResumeContent): Record<ArraySectionKey, string[]> {
  const out = {} as Record<ArraySectionKey, string[]>;
  for (const section of ARRAY_SECTION_KEYS) {
    const ids = readItemIds(content, section);
    out[section] = ids.filter((id): id is string => id !== null);
  }
  return out;
}
