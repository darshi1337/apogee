import { PROVIDERS, isVideoType, isDiscussionType } from "../constants.js";
import {
  providerNeedsKey,
  resolveEngineChain,
  getModelForSettings,
} from "./providers.js";
import { getUsableTokens } from "./modelLimits.js";

export const INPUT_KINDS = {
  SELECTION: "selection",
  ARTICLE: "article",
  DOCUMENT: "document",
  VIDEO: "video",
  DISCUSSION: "discussion",
  ASK: "ask",
};

export const DEFAULT_CANDIDATES = [
  PROVIDERS.WEBLLM,
  PROVIDERS.TRANSFORMERS,
  PROVIDERS.LOCAL,
  PROVIDERS.LLAMACPP,
].filter(Boolean);

// Per-kind candidate lists can be added here when a specific input kind
// requires custom candidate ordering.
export const DEFAULT_KIND_CANDIDATES = {};

const ADDITIONAL_DISCUSSION_TYPES = new Set([
  "discourse",
  "lemmy",
  "lobsters",
  "mastodon",
  "bluesky",
]);

export function detectInputKind({
  type,
  isPdf = false,
  isSelection = false,
  action,
  title,
  url,
} = {}) {
  if (action === "ask") return INPUT_KINDS.ASK;
  if (isSelection || type === "selection") return INPUT_KINDS.SELECTION;

  const lowerTitle = typeof title === "string" ? title.toLowerCase() : "";
  const lowerUrl = typeof url === "string" ? url.toLowerCase() : "";

  if (
    isPdf ||
    lowerTitle.endsWith(".pdf") ||
    lowerTitle.endsWith(".docx") ||
    lowerUrl.endsWith(".pdf")
  ) {
    return INPUT_KINDS.DOCUMENT;
  }

  if (isVideoType(type)) return INPUT_KINDS.VIDEO;
  if (isDiscussionType(type) || ADDITIONAL_DISCUSSION_TYPES.has(type)) {
    return INPUT_KINDS.DISCUSSION;
  }

  return INPUT_KINDS.ARTICLE;
}

function isLocalEngine(type) {
  return type === PROVIDERS.LOCAL || type === PROVIDERS.LLAMACPP;
}

export function resolveCandidateChain({
  kind,
  tokenCount = 0,
  settings = {},
  availableEngines = Object.values(PROVIDERS),
} = {}) {
  if (!settings?.autoEngine) {
    return undefined;
  }

  const base = DEFAULT_KIND_CANDIDATES[kind] || DEFAULT_CANDIDATES;

  let candidates = base.filter((engine) => availableEngines.includes(engine));

  // Local engines (local, llamacpp) never rank above in-browser engines
  // unless settings.provider is explicitly that engine.
  const isPreferredLocal = isLocalEngine(settings?.provider);
  if (isPreferredLocal && candidates.includes(settings.provider)) {
    candidates = [
      settings.provider,
      ...candidates.filter((e) => e !== settings.provider),
    ];
  } else if (!isPreferredLocal) {
    const inBrowser = candidates.filter((e) => !isLocalEngine(e));
    const local = candidates.filter((e) => isLocalEngine(e));
    candidates = [...inBrowser, ...local];
  }

  // Pre-filter with providerNeedsKey
  candidates = candidates.filter((type) => !providerNeedsKey(type, settings));

  // Append remaining available engines after the rule's list
  for (const engine of availableEngines) {
    if (!candidates.includes(engine) && !providerNeedsKey(engine, settings)) {
      candidates.push(engine);
    }
  }

  // Demote candidates whose context window < tokenCount.
  // Look up context via getModelForSettings, compare against usable tokens.
  // If all candidates are demoted, keep the original order.
  if (typeof tokenCount === "number" && tokenCount > 0) {
    const fit = [];
    const demoted = [];
    for (const type of candidates) {
      const model = getModelForSettings({ ...settings, provider: type });
      const override =
        type === PROVIDERS.LLAMACPP ? settings?.llamaContextTokens : undefined;
      const usable = getUsableTokens(model, override);
      if (usable < tokenCount) {
        demoted.push(type);
      } else {
        fit.push(type);
      }
    }
    if (fit.length > 0) {
      candidates = [...fit, ...demoted];
    }
  }

  return resolveEngineChain(settings, candidates);
}
