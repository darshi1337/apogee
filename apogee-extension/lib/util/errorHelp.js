// Every failure the extension shows gets a link to ERROR.md, deep-linked to the section that explains it. Anchors are GitHub's heading slugs, so they have to stay in sync with the headings in that file.
export const ERROR_HELP_URL =
  "https://github.com/darshi1337/apogee/blob/main/ERROR.md";

export const ERROR_HELP_LABEL = "What does this mean?";

// Order matters. Internal strings go first so "Unknown ollama-stream action" does not land in the Ollama section, and the in-browser patterns beat the Ollama ones because the WebLLM offscreen message names Ollama as the fix.
const SECTIONS = [
  [/streamid|unknown .*(action|model)/i, "internal"],
  [/\bpdf\b/i, "pdfs"],
  [
    /webgpu|offscreen|onnx|transformers\.js|model download|highlight-in-page|locate this passage|in-browser model|out of memory|memory limit|allocation/i,
    "in-browser-models",
  ],
  [/ollama/i, "local-ollama"],
  [
    /stream|connection.*(lost|drop|model)|no longer available|was cancelled/i,
    "streaming-cancelling-and-background-jobs",
  ],
  [/logs|clipboard|copy failed|cached data/i, "settings-cache-and-diagnostics"],
  [
    /read (this|the) page|nothing to summarize|extract enough|no answer came back|can't read/i,
    "reading-the-page",
  ],
];

// Falls back to the top of the file when nothing matches, which is also what happens for raw browser or library strings that were never written for a user.
export function errorHelpUrl(message) {
  const text = String(message ?? "");
  for (const [pattern, anchor] of SECTIONS) {
    if (pattern.test(text)) return `${ERROR_HELP_URL}#${anchor}`;
  }
  return ERROR_HELP_URL;
}
