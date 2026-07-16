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
import {
  generateStream,
  generateText,
  LLMError,
} from "../services/llmService.js";
import { summarizeText } from "../services/summaryService.js";
import { cleanText } from "../utils/cleaner.js";
import { HttpError, validateBody } from "../utils/httpError.js";

const router = Router();

// Maximum content length accepted (approximately 500 KB of text).
const MAX_CONTENT_LENGTH = 500_000;

// Streams a token generator to the response, stopping as soon as the client
// disconnects. `res` "close" fires when the socket closes (popup dismissed,
// tab navigated, request cancelled); we abort the controller so the model
// stops generating, then break out so we don't write to a dead socket.
async function streamToResponse(res, generator, signal) {
  res.type("text/plain");
  try {
    for await (const token of generator) {
      if (signal.aborted) break;
      res.write(token);
    }
  } finally {
    if (!res.writableEnded) res.end();
  }
}

router.post(
  "/summarize",
  validateBody(SummaryRequestSchema),
  async (req, res) => {
    const { content, title, url, mode, model } = req.body;
    if (content.length > MAX_CONTENT_LENGTH) {
      throw new HttpError(
        413,
        `Content too large (${content.length} chars). Maximum is ${MAX_CONTENT_LENGTH}.`,
      );
    }

    const controller = new AbortController();
    res.on("close", () => controller.abort());

    await streamToResponse(
      res,
      summarizeText({
        text: content,
        title,
        url,
        mode,
        model,
        signal: controller.signal,
      }),
      controller.signal,
    );
  },
);

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

  const controller = new AbortController();
  res.on("close", () => controller.abort());

  res.type("text/plain");
  try {
    for await (const token of generateStream(prompt, model, {
      signal: controller.signal,
    })) {
      if (controller.signal.aborted) break;
      res.write(token);
    }
  } catch (err) {
    if (!(err instanceof LLMError)) throw err;
    // The client is gone, nothing to surface the error to.
    if (!controller.signal.aborted && !res.writableEnded) {
      res.write(`\n\n[Error: ${err.message}]`);
    }
  } finally {
    if (!res.writableEnded) res.end();
  }
});

// Matches one bullet marker (-, *, •) or one numbered-list marker (N. / N))
// at the start of a line, with any amount of digits, not just "1."/"2.",
// which left a model that numbered past 2 (or restarted numbering per
// section, e.g. "3.") leaking the raw marker into the question text.
const LIST_MARKER = /^(?:[-*•]|\d+[.)])\s*/;

/** Strips list markers repeatedly, so a compound prefix like "- 1. " is fully removed. */
function stripListMarkers(line) {
  let cleaned = line.trim();
  let previous;
  do {
    previous = cleaned;
    cleaned = cleaned.replace(LIST_MARKER, "").trim();
  } while (cleaned !== previous);
  return cleaned;
}

function parseSuggestedQuestions(text) {
  const questions = [];

  for (const rawLine of text.split("\n")) {
    const cleaned = stripListMarkers(rawLine);

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
