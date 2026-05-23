import type { ResumeContent } from "@/lib/resume-schema";
import { bulletsToDoc, emptyDoc } from "@/lib/tiptap-types";
import { DEFAULT_SECTION_ORDER } from "@/lib/resume-schema";
import OpenAI from "openai";

function getDeepSeekClient() {
  return new OpenAI({
    baseURL: "https://api.deepseek.com",
    apiKey: process.env.DEEPSEEK_API_KEY ?? "",
  });
}

function getVisionClient() {
  // Use a dedicated vision API if configured, otherwise fall back to DeepSeek
  const baseURL = process.env.VISION_API_BASE_URL || "https://api.deepseek.com";
  const apiKey = process.env.VISION_API_KEY || process.env.DEEPSEEK_API_KEY || "";
  return new OpenAI({ baseURL, apiKey });
}

function getVisionModel(): string {
  return process.env.VISION_MODEL || "deepseek-chat";
}

export type ImportResult =
  | { status: "success"; data: ResumeContent; warnings?: string[] }
  | { status: "ocr-failed"; error: string }
  | { status: "parse-failed"; error: string };

const SUPPORTED_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
]);

export function isSupportedType(mimeType: string): boolean {
  return SUPPORTED_TYPES.has(mimeType);
}

// ─── Text Extraction ────────────────────────────────────────

async function extractFromPdf(buffer: Buffer): Promise<{ text: string; isScanned: boolean }> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const text = result.text.trim();
    return { text, isScanned: text.length < 50 };
  } finally {
    await parser.destroy();
  }
}

async function extractFromDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value.trim();
}

async function ocrImage(buffer: Buffer, mimeType: string): Promise<{ text: string; confidence: number }> {
  // Use vision-capable LLM to extract text from images.
  // This is faster and more accurate than Tesseract.js on serverless.
  const base64 = buffer.toString("base64");
  const dataUrl = `data:${mimeType};base64,${base64}`;

  const client = getVisionClient();
  const model = getVisionModel();

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: dataUrl },
            },
            {
              type: "text",
              text: "请将这张图片中的所有文字内容完整提取出来，保持原始格式和段落结构。只输出提取的文字，不要加任何说明或标注。",
            },
          ],
        },
      ],
      temperature: 0.1,
      max_tokens: 4000,
    });

    const text = response.choices[0]?.message?.content?.trim() || "";
    if (!text || text.length < 10) {
      return { text: "", confidence: 0 };
    }
    // Vision LLM extraction is generally high confidence
    return { text, confidence: 85 };
  } catch (err) {
    console.error("[ocrImage] Vision API failed:", err);
    // If the model doesn't support vision, throw a clear error
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("vision") || msg.includes("image") || msg.includes("multimodal") || msg.includes("content type")) {
      throw new Error("当前 AI 模型不支持图片识别，请配置支持视觉的模型（VISION_MODEL / VISION_API_KEY）或上传文本型 PDF / Word 文件");
    }
    throw new Error(`图片识别失败: ${msg}`);
  }
}

// ─── LLM Structuring ────────────────────────────────────────

const SYSTEM_PROMPT = `你是一个简历解析助手。将用户提供的简历文本精确转换为结构化 JSON。

严格按以下格式输出 JSON（不要输出任何其他内容）：
{
  "basics": {
    "name": "",
    "title": "",
    "email": "",
    "phone": "",
    "location": "",
    "website": "",
    "summary": ""
  },
  "experience": [
    { "company": "", "title": "", "start": "", "end": "", "location": "", "contentText": "" }
  ],
  "education": [
    { "school": "", "degree": "", "major": "", "start": "", "end": "", "gpa": "" }
  ],
  "projects": [
    { "name": "", "role": "", "start": "", "end": "", "stack": [], "link": "", "contentText": "" }
  ],
  "skills": [
    { "category": "", "items": [] }
  ]
}

规则：
- 日期格式统一为 YYYY-MM（如 2023-06）
- contentText 保留原始的工作/项目描述文字，每个要点用换行分隔
- 如果某字段在简历中不存在，留空字符串或空数组
- skills 按类别分组（如：编程语言、框架、工具等）
- 从文本中提取尽可能多的信息，不要遗漏
- 只输出 JSON，不要加 markdown 代码块标记`;

interface LLMResumeData {
  basics: {
    name: string;
    title: string;
    email: string;
    phone: string;
    location: string;
    website: string;
    summary: string;
  };
  experience: Array<{
    company: string;
    title: string;
    start: string;
    end: string;
    location: string;
    contentText: string;
  }>;
  education: Array<{
    school: string;
    degree: string;
    major: string;
    start: string;
    end: string;
    gpa: string;
  }>;
  projects: Array<{
    name: string;
    role: string;
    start: string;
    end: string;
    stack: string[];
    link: string;
    contentText: string;
  }>;
  skills: Array<{
    category: string;
    items: string[];
  }>;
}

async function structureWithLLM(text: string): Promise<LLMResumeData> {
  const deepseek = getDeepSeekClient();

  let response;
  try {
    response = await deepseek.chat.completions.create({
      model: "deepseek-chat",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
      temperature: 0.1,
      max_tokens: 4000,
    });
  } catch (apiErr) {
    console.error("[structureWithLLM] API call failed:", apiErr);
    throw new Error("AI 解析服务暂时不可用，请稍后重试");
  }

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("AI 返回空结果，请稍后重试");

  try {
    return JSON.parse(content) as LLMResumeData;
  } catch {
    console.error("[structureWithLLM] Invalid JSON:", content.substring(0, 200));
    throw new Error("AI 返回格式异常，请重试");
  }
}

// ─── Convert to ResumeContent ────────────────────────────────

function textToTipTapContent(text: string) {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return emptyDoc();
  return bulletsToDoc(lines);
}

function llmDataToResumeContent(data: LLMResumeData): ResumeContent {
  const sectionOrder = [...DEFAULT_SECTION_ORDER];

  return {
    basics: {
      name: data.basics.name || "",
      status: "",
      title: data.basics.title || "",
      email: data.basics.email || "",
      phone: data.basics.phone || "",
      location: data.basics.location || "",
      website: data.basics.website || "",
      summary: data.basics.summary || "",
      photo: "",
    },
    experience: (data.experience || []).map((e) => ({
      company: e.company || "",
      title: e.title || "",
      start: e.start || "",
      end: e.end || "",
      location: e.location || "",
      content: textToTipTapContent(e.contentText || ""),
    })),
    education: (data.education || []).map((e) => ({
      school: e.school || "",
      degree: e.degree || "",
      major: e.major || "",
      location: "",
      start: e.start || "",
      end: e.end || "",
      gpa: e.gpa || "",
      highlights: emptyDoc(),
    })),
    projects: (data.projects || []).map((p) => ({
      name: p.name || "",
      role: p.role || "",
      location: "",
      start: p.start || "",
      end: p.end || "",
      stack: p.stack || [],
      link: p.link || "",
      content: textToTipTapContent(p.contentText || ""),
    })),
    skills: (data.skills || []).map((s) => ({
      category: s.category || "",
      items: s.items || [],
    })),
    custom: [],
    sectionOrder,
  };
}

// ─── Main Entry Point ────────────────────────────────────────

export type ProgressCallback = (step: "extracting" | "ocr" | "structuring") => void;

export async function importResume(
  buffer: Buffer,
  mimeType: string,
  onProgress?: ProgressCallback,
): Promise<ImportResult> {
  const warnings: string[] = [];
  let text: string;

  try {
    // Step 1: Extract text based on file type
    onProgress?.("extracting");

    if (mimeType === "application/pdf") {
      const { text: pdfText, isScanned } = await extractFromPdf(buffer);
      if (isScanned) {
        // Scanned PDF — use vision API to extract text
        onProgress?.("ocr");
        const ocr = await ocrImage(buffer, "application/pdf");
        if (ocr.confidence < 60) {
          return {
            status: "ocr-failed",
            error: "无法从扫描版 PDF 中提取文字，请上传文本型 PDF、Word 文件或清晰的图片截图",
          };
        }
        if (ocr.confidence < 75) {
          warnings.push("部分内容可能识别不准确，导入后请仔细检查");
        }
        text = ocr.text;
      } else {
        text = pdfText;
      }
    } else if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      text = await extractFromDocx(buffer);
    } else if (mimeType === "image/jpeg" || mimeType === "image/png") {
      onProgress?.("ocr");
      const ocr = await ocrImage(buffer, mimeType);
      if (ocr.confidence < 60) {
        return {
          status: "ocr-failed",
          error: "无法从图片中提取文字，请上传更清晰的图片或文本型 PDF",
        };
      }
      if (ocr.confidence < 75) {
        warnings.push("部分内容可能识别不准确，导入后请仔细检查");
      }
      text = ocr.text;
    } else {
      return { status: "parse-failed", error: "不支持的文件格式" };
    }

    if (!text || text.length < 20) {
      return { status: "parse-failed", error: "未能从文件中提取到有效内容" };
    }

    // Step 2: Structure with LLM
    onProgress?.("structuring");
    const llmData = await structureWithLLM(text);

    // Step 3: Convert to ResumeContent
    const resumeContent = llmDataToResumeContent(llmData);

    return { status: "success", data: resumeContent, warnings: warnings.length > 0 ? warnings : undefined };
  } catch (error) {
    console.error("[importResume] failed:", error);
    return {
      status: "parse-failed",
      error: error instanceof Error ? error.message : "解析失败，请稍后重试",
    };
  }
}
