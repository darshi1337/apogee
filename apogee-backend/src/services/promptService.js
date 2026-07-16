import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.join(__dirname, "..", "prompts");

const promptCache = new Map();

/** Load a prompt template from disk (cached after first read). */
function loadPrompt(name) {
  if (!promptCache.has(name)) {
    const filePath = path.join(PROMPTS_DIR, `${name}.txt`);
    promptCache.set(name, readFileSync(filePath, "utf-8"));
  }
  return promptCache.get(name);
}

// Mirrors Python's string.Template.safe_substitute: replaces $identifier /
// ${identifier} with values from `substitutions` when present, leaves the
// placeholder untouched otherwise, and treats "$$" as a literal "$".
const PLACEHOLDER = /\$(\$|[_a-zA-Z][_a-zA-Z0-9]*|\{[_a-zA-Z][_a-zA-Z0-9]*\}|)/g;

function safeSubstitute(template, substitutions) {
  return template.replace(PLACEHOLDER, (match, token) => {
    if (token === "$") return "$";
    if (token === "") return match;
    const key = token.startsWith("{") ? token.slice(1, -1) : token;
    return Object.prototype.hasOwnProperty.call(substitutions, key)
      ? String(substitutions[key])
      : match;
  });
}

const SUMMARY_STYLES = {
  bullets: [
    "Return only the final answer.",
    "",
    "Rules:",
    "- Output 8-14 concise bullet points.",
    "- Each bullet must be on its own line.",
    "- Do not write any introduction.",
    "- Do not write any heading.",
    "- Do not write any conclusion.",
    "- Do not explain what you are doing.",
    "- Do not prefix the output with phrases like " +
      "'Here is the summary', 'Summary:', or similar.",
    "- Output only the bullet points.",
  ].join("\n"),

  sentences: [
    "Return only the final answer.",
    "",
    "Rules:",
    "- Output exactly 7-10 concise sentences.",
    "- Put each sentence on a separate line.",
    "- Do not use bullets.",
    "- Do not use numbering.",
    "- Do not write a paragraph.",
    "- Do not write any introduction.",
    "- Do not write any heading.",
    "- Do not write any conclusion.",
    "- Do not prefix the response with phrases like " +
      "'Here is the summary', 'Summary:', " +
      "'Below is a summary', or similar.",
    "- Output only the sentences.",
  ].join("\n"),

  paragraphs: [
    "Return only the final answer.",
    "",
    "Rules:",
    "- Output one concise paragraph containing 10-15 sentences.",
    "- Do not use bullets.",
    "- Do not use numbering.",
    "- Do not add a heading.",
    "- Do not write an introduction.",
    "- Do not write a conclusion.",
    "- Do not prefix the response with phrases like " +
      "'Here is the summary', 'Summary:', or similar.",
    "- Output only the paragraph.",
  ].join("\n"),
};

export function buildSummaryPrompt({ title, url, content, mode }) {
  const template = loadPrompt("summarize");
  const style = SUMMARY_STYLES[mode] ?? SUMMARY_STYLES.bullets;
  return safeSubstitute(template, { title, url, content, style });
}

export function buildAnswerPrompt({ title, url, content, question }) {
  const template = loadPrompt("answer");
  return safeSubstitute(template, { title, url, content, question });
}

export function buildSuggestedQuestionsPrompt({ title, url, summary }) {
  const template = loadPrompt("suggest_questions");
  return safeSubstitute(template, { title, url, summary });
}
