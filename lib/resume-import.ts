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
  const { extractText } = await import("unpdf");
  const { text: pages } = await extractText(new Uint8Array(buffer));
  const text = pages.join("\n").trim();
  return { text, isScanned: text.length < 50 };
}

async function extractFromDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value.trim();
}

async function ocrImage(buffer: Buffer, mimeType: string): Promise<{ text: string; confidence: number }> {
  // Use OCR.space free API — fast cloud OCR, works within Vercel Hobby 10s limit
  const apiKey = process.env.OCR_SPACE_API_KEY || "helloworld";
  const base64 = `data:${mimeType};base64,${buffer.toString("base64")}`;

  const formData = new URLSearchParams();
  formData.append("base64Image", base64);
  formData.append("language", "chs"); // Simplified Chinese + English
  formData.append("isOverlayRequired", "false");
  formData.append("OCREngine", "2"); // Engine 2: better for Chinese, auto-detect language
  formData.append("scale", "true"); // Upscale for better recognition
  formData.append("isTable", "true"); // Better table/layout handling

  const response = await fetch("https://api.ocr.space/parse/image", {
    method: "POST",
    headers: {
      apikey: apiKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formData.toString(),
  });

  if (!response.ok) {
    throw new Error(`OCR 服务请求失败 (${response.status})`);
  }

  const result = await response.json() as {
    ParsedResults?: Array<{
      ParsedText: string;
      ErrorMessage?: string;
      TextOverlay?: { HasOverlay: boolean };
    }>;
    IsErroredOnProcessing: boolean;
    ErrorMessage?: string[];
    OCRExitCode: number;
  };

  if (result.IsErroredOnProcessing || result.OCRExitCode !== 1) {
    const errMsg = result.ErrorMessage?.join("; ") || result.ParsedResults?.[0]?.ErrorMessage || "OCR 处理失败";
    // Check for file size limit
    if (errMsg.includes("size") || errMsg.includes("limit")) {
      throw new Error("图片文件过大，OCR 服务限制 1MB。请压缩图片后重试");
    }
    throw new Error(`OCR 识别失败: ${errMsg}`);
  }

  const parsed = result.ParsedResults?.[0];
  if (!parsed || !parsed.ParsedText) {
    return { text: "", confidence: 0 };
  }

  // OCR.space doesn't return a confidence percentage per se,
  // but successful parsing with text means high confidence
  const text = parsed.ParsedText.trim();
  const confidence = text.length > 20 ? 80 : text.length > 5 ? 65 : 30;
  return { text, confidence };
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
        // Scanned PDF — use cloud OCR service which supports PDF
        onProgress?.("ocr");
        const ocr = await ocrImage(buffer, mimeType);
        if (ocr.confidence < 60) {
          return {
            status: "ocr-failed",
            error: "无法从扫描版 PDF 中提取文字，请上传更清晰的文件或图片截图",
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
          error: `图片识别质量过低，请上传更清晰的图片`,
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
