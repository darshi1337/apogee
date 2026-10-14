import { UserFacingError } from "../lib/util/userError.js";
import { chatStream } from "../lib/engines/ollamaClient.js";
import {
  chatStream as llamaChatStream,
  checkHealth as llamaCheckHealth,
  DEFAULT_CONTEXT_TOKENS as LLAMACPP_DEFAULT_CONTEXT_TOKENS,
} from "../lib/engines/llamaCppClient.js";
import {
  ALLOWED_OLLAMA_HOSTS,
  DEFAULT_OLLAMA_PORT,
  validateLoopbackUrl,
} from "../lib/util/ollamaHost.js";
import {
  DEFAULT_LLAMACPP_HOST,
  LLM_HEALTH_CHECK_TIMEOUT_MS,
} from "../lib/constants.js";

// Loopback HTTP providers (Ollama, llama.cpp): host validation plus what
// each provider contributes to a generation job. The service worker keeps
// the engine-running code; suggest-questions imports the same descriptors
// so both paths validate hosts and name errors the same way.
export const ALLOWED_LOOPBACK_HOSTS = ALLOWED_OLLAMA_HOSTS;

// The rejected value stays in the console line only. The user-facing message states the rule instead, so a mistyped host reads as guidance rather than an internal assertion. ERROR.md documents this message word for word.
export function rejectLoopbackHost(label, host, reason) {
  console.error(`${label} host rejected (${reason}): ${host}`);
  const allowed = [...ALLOWED_LOOPBACK_HOSTS].join(" or ");
  return new UserFacingError(
    `Apogee can only reach ${label} over http on ${allowed}. Check the host in Settings.`,
  );
}

export function loopbackDefaultPort(label) {
  // One shared validator (see lib/util/ollamaHost.js): the port rule and the
  // 127.0.0.1/localhost-only stance come from there for every provider. The
  // only per-provider part is the default port, since llama.cpp listens on
  // 8080 while Ollama listens on 11434. (LLAMACPP_PROVIDER is declared below;
  // this lookup runs at call time, after module init.)
  if (label === LLAMACPP_PROVIDER.label) {
    try {
      return new URL(DEFAULT_LLAMACPP_HOST).port || "8080";
    } catch {
      return "8080";
    }
  }
  return DEFAULT_OLLAMA_PORT;
}

export function validateLoopbackHost(host, label = "Ollama") {
  try {
    return validateLoopbackUrl(host, {
      label,
      defaultPort: loopbackDefaultPort(label),
    });
  } catch (err) {
    // Map the shared validator's plain errors onto the console-only reason;
    // the user-facing message stays generic (see rejectLoopbackHost).
    const message = err instanceof Error ? err.message : String(err);
    const reason = message
      .replace(`Invalid ${label} host`, "unparseable URL")
      .replace(`Disallowed ${label} `, "")
      .replace(`Invalid ${label} `, "");
    throw rejectLoopbackHost(label, host, reason);
  }
}

// What a loopback HTTP provider contributes to a generation job: the client that talks to it, the name its errors are written in, and the message action its stream arrives on. The engine-running code lives in the service worker; it stays the same whichever server is answering. Ollama is the default, so its call sites pass nothing and behave exactly as before.
export const OLLAMA_PROVIDER = {
  label: "Ollama",
  streamKind: "ollama-stream",
  chatStream,
};

// llama-server reports the context window it is actually running, which comes from its own -c launch flag and so cannot be read off the model name. Ollama has no equivalent, which is why only this provider supplies the hook.
export const LLAMACPP_PROVIDER = {
  label: "llama.cpp",
  streamKind: "llamacpp-stream",
  chatStream: llamaChatStream,
  async getContextTokens(host, apiKey) {
    const health = await llamaCheckHealth(
      host,
      LLM_HEALTH_CHECK_TIMEOUT_MS,
      apiKey,
    );
    return health.contextTokens ?? LLAMACPP_DEFAULT_CONTEXT_TOKENS;
  },
};
