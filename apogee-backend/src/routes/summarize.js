import { Router } from "express";

import {
  AskRequestSchema,
  SuggestedQuestionsRequestSchema,
  SummaryRequestSchema,
} from "../models/requestSchemas.js";
import {
  buildAnswerPrompt,
  buildSuggestedQuestionsPrompt,
} from "../services/promptService.js";
import { generateStream, generateText, LLMError } from "../services/llmService.js";
import { summarizeText } from "../services/summaryService.js";
import { cleanText } from "../utils/cleaner.js";
import { HttpError, validateBody } from "../utils/httpError.js";

const router = Router();

// Maximum content length accepted (approximately 500 KB of text).
const MAX_CONTENT_LENGTH = 500_000;

router.post("/summarize", validateBody(SummaryRequestSchema), async (req, res) => {
  const { content, title, url, mode, model } = req.body;
  if (content.length > MAX_CONTENT_LENGTH) {
    throw new HttpError(
      413,
      `Content too large (${content.length} chars). Maximum is ${MAX_CONTENT_LENGTH}.`,
    );
  }

  res.type("text/plain");
  for await (const token of summarizeText({ text: content, title, url, mode, model })) {
    res.write(token);
  }
  res.end();
});

router.post("/ask", validateBody(AskRequestSchema), async (req, res) => {
  const { content, title, url, question, model } = req.body;
  if (content.length > MAX_CONTENT_LENGTH) {
    throw new HttpError(
      413,
      `Content too large (${content.length} chars). Maximum is ${MAX_CONTENT_LENGTH}.`,
    );
  }

  const prompt = buildAnswerPrompt({
    title,
    url,
    content: cleanText(content),
    question,
  });

  res.type("text/plain");
  try {
    for await (const token of generateStream(prompt, model)) {
      res.write(token);
    }
  } catch (err) {
    if (!(err instanceof LLMError)) throw err;
    res.write(`\n\n[Error: ${err.message}]`);
  }
  res.end();
});

function parseSuggestedQuestions(text) {
  const questions = [];

  for (const rawLine of text.split("\n")) {
    let cleaned = rawLine.trim().replace(/^[-*•]+/, "").trim();
    for (const prefix of ["1.", "2.", "1)", "2)"]) {
      if (cleaned.startsWith(prefix)) {
        cleaned = cleaned.slice(prefix.length).trim();
      }
    }

    if (cleaned && cleaned.endsWith("?")) {
      questions.push(cleaned);
    }

    if (questions.length === 2) break;
  }

  return questions;
}

router.post(
  "/suggest-questions",
  validateBody(SuggestedQuestionsRequestSchema),
  async (req, res) => {
    const { summary, title, url, model } = req.body;
    if (summary.length > MAX_CONTENT_LENGTH) {
      throw new HttpError(
        413,
        `Summary too large (${summary.length} chars). Maximum is ${MAX_CONTENT_LENGTH}.`,
      );
    }

    const prompt = buildSuggestedQuestionsPrompt({
      title,
      url,
      summary: cleanText(summary),
    });

    let text;
    try {
      text = await generateText(prompt, model);
    } catch (err) {
      if (!(err instanceof LLMError)) throw err;
      throw new HttpError(502, err.message);
    }

    const questions = parseSuggestedQuestions(text);
    if (questions.length < 2) {
      throw new HttpError(502, "Model did not return two suggested questions.");
    }

    res.json({ questions });
  },
);

export default router;
export { parseSuggestedQuestions };
