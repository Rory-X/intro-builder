import { ZodError } from "zod";

/** Turn zod / server save errors into a short user-facing message. */
export function formatSaveError(error: unknown): string {
  if (error instanceof ZodError) {
    const first = error.issues[0];
    if (first) {
      const path = first.path.length > 0 ? first.path.join(".") : "表单";
      return `保存失败：${path} — ${first.message}`;
    }
    return "保存失败：表单数据校验未通过";
  }
  if (error instanceof Error) {
    if (error.message.startsWith("invalid:")) {
      return `保存失败：${error.message.replace(/^invalid:\s*/, "")}`;
    }
    return `保存失败：${error.message}`;
  }
  return `保存失败：${String(error)}`;
}
