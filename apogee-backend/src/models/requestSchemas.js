import { z } from "zod";

const ALLOWED_MODELS = [
  "qwen3:8b",
  "mistral:latest",
  "llama3.1:8b",
  "gemma3:4b",
];
const ALLOWED_MODES = ["bullets", "sentences", "paragraphs"];

// title/url are display metadata dropped into prompts, not primary content,
// they don't need the same 500KB budget as `content`, and were previously
// unbounded (only `content`/`summary` were checked in the route handlers).
const TITLE_MAX_LENGTH = 500;
const URL_MAX_LENGTH = 2000;

const modelField = z.enum(ALLOWED_MODELS).default("gemma3:4b");

export const SummaryRequestSchema = z.object({
  title: z.string().max(TITLE_MAX_LENGTH),
  url: z.string().max(URL_MAX_LENGTH),
  content: z.string().min(1),
  mode: z.enum(ALLOWED_MODES),
  model: modelField,
});

export const AskRequestSchema = z.object({
  title: z.string().max(TITLE_MAX_LENGTH),
  url: z.string().max(URL_MAX_LENGTH),
  content: z.string().min(1),
  question: z.string().min(1),
  model: modelField,
});

export const SuggestedQuestionsRequestSchema = z.object({
  title: z.string().max(TITLE_MAX_LENGTH),
  url: z.string().max(URL_MAX_LENGTH),
  summary: z.string().min(1),
  model: modelField,
});

export const PdfUrlRequestSchema = z.object({
  url: z.string().max(URL_MAX_LENGTH),
  mode: z.enum(ALLOWED_MODES).default("bullets"),
  model: modelField,
});
