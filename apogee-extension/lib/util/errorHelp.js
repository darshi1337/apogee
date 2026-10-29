// Every failure links to docs/ERROR.md by heading slug, so anchors must stay
// in sync with that file.
export const ERROR_HELP_URL =
  "https://github.com/darshi1337/apogee/blob/main/docs/ERROR.md";

export const ERROR_HELP_LABEL = "What does this mean?";

// Order matters: internal strings first, then in-browser over Ollama,
// since the WebLLM message names Ollama as the fix.
const SECTIONS = [
  [/streamid|unknown .*(action|model)/i, "internal"],
  // Ahead of the pdf rule: kind and size rejections plus DOCX failures are
  // local-file problems, even when the message names a PDF.
  [
    /\bdocx\b|unsupported file type|exceeds the .*limit|no readable text/i,
    "local-files",
  ],
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
    /read (this|the) page|nothing to summarize|extract enough|no (answer|summary) came back|can't read/i,
    "reading-the-page",
  ],
];

// Unmatched and raw browser strings fall back to the top of the file.
export function errorHelpUrl(message) {
  const text = String(message ?? "");
  for (const [pattern, anchor] of SECTIONS) {
    if (pattern.test(text)) return `${ERROR_HELP_URL}#${anchor}`;
  }
  return ERROR_HELP_URL;
}
