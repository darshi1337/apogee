export function cleanText(text) {
  // Collapse runs of blank lines into a single newline
  let cleaned = text.replace(/\n{3,}/g, "\n\n");
  // Collapse horizontal whitespace (spaces/tabs) but preserve newlines
  cleaned = cleaned.replace(/[^\S\n]+/g, " ");
  // Strip leading/trailing whitespace from each line
  cleaned = cleaned
    .split("\n")
    .map((line) => line.trim())
    .join("\n");
  return cleaned.trim();
}
