import { z } from "zod";

const nonEmpty = z.string().min(1, "必填");

export const Basics = z.object({
  name: nonEmpty,
  title: z.string().default(""),
  email: z.string().email(),
  phone: z.string().default(""),
  location: z.string().default(""),
  website: z.string().url().optional().or(z.literal("")).default(""),
  summary: z.string().default(""),
});

export const Education = z.object({
  school: z.string().default(""),
  degree: z.string().default(""),
  major: z.string().default(""),
  start: z.string().default(""),
  end: z.string().default(""),
  gpa: z.string().optional().default(""),
  highlights: z.array(z.string()).default([]),
});

export const Experience = z.object({
  company: z.string().default(""),
  title: z.string().default(""),
  start: z.string().default(""),
  end: z.string().default(""),
  location: z.string().optional().default(""),
  bullets: z.array(z.string()).default([]),
});

export const Project = z.object({
  name: z.string().default(""),
  stack: z.array(z.string()).default([]),
  link: z.string().optional().default(""),
  bullets: z.array(z.string()).default([]),
});

export const SkillGroup = z.object({
  category: z.string().default(""),
  items: z.array(z.string()).default([]),
});

export const CustomSection = z.object({
  title: z.string().default(""),
  content: z.string().default(""),
});

export const ResumeContent = z.object({
  basics: Basics,
  education: z.array(Education).default([]),
  experience: z.array(Experience).default([]),
  projects: z.array(Project).default([]),
  skills: z.array(SkillGroup).default([]),
  custom: z.array(CustomSection).default([]),
});

export type ResumeContent = z.infer<typeof ResumeContent>;

export const emptyResumeContent = (): ResumeContent => ({
  basics: {
    name: "你的姓名",
    title: "目标岗位",
    email: "you@example.com",
    phone: "",
    location: "",
    website: "",
    summary: "",
  },
  education: [],
  experience: [],
  projects: [],
  skills: [],
  custom: [],
});
