import { UserFacingError } from "../util/userError.js";
import { ensureLoopbackCorsRuleSoon } from "../util/loopbackCors.js";
import { stripTrailingSlashes } from "../util/ollamaHost.js";
import {
  buildChatMessages,
  postChatRequest,
  pumpChatBody,
} from "./httpChatStream.js";

class OllamaError extends UserFacingError {}

function parseHttpError(detail, status, model) {
  let message = detail;
  try {
    const parsed = JSON.parse(detail);
    if (parsed?.error) message = parsed.error;
  } catch {
    // Safe fallback: ignore JSON parse error if response body is plain text
  }
  return new OllamaError(
    `Ollama returned an error for model '${model}': ${message || status}`,
  );
}

export async function* chatStream(
  host,
  model,
  prompt,
  { signal, keepAlive = "5m", system, onFinalStats } = {},
) {
  const messages = buildChatMessages(system, prompt);
  const response = await postChatRequest({
    url: `${stripTrailingSlashes(host)}/api/chat`,
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      think: false,
      keep_alive: keepAlive,
    }),
    headers: { "Content-Type": "application/json" },
    signal,
    ErrorClass: OllamaError,
    label: "Ollama",
    errorHost: host,
    parseHttpError: (detail, status) => parseHttpError(detail, status, model),
  });

  const onBlock = (block) => {
    const line = block.trim();
    if (!line) return { texts: [] };
    const parsed = JSON.parse(line);
    if (parsed.error) {
      throw new OllamaError(
        `Ollama returned an error for model '${model}': ${parsed.error}`,
      );
    }
    const texts = [];
    const text = parsed.message?.content;
    if (text) texts.push(text);
    if (parsed.eval_count != null && parsed.eval_duration != null) {
      onFinalStats?.({
        tokens: parsed.eval_count,
        durationMs: parsed.eval_duration / 1e6,
      });
    }
    return { texts };
  };

  yield* pumpChatBody(response, {
    delimiter: "\n",
    onBlock,
    signal,
    ErrorClass: OllamaError,
    label: "Ollama",
    errorHost: host,
    mapSyntaxError: (err) =>
      new OllamaError(
        `Ollama sent a malformed response for model '${model}': ${err.message}`,
      ),
  });
}

export async function checkHealth(host, timeoutMs = 3000) {
  await ensureLoopbackCorsRuleSoon();
  try {
    const response = await fetch(`${stripTrailingSlashes(host)}/api/tags`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return { connected: false, models: [] };
    const data = await response.json();
    const models = Array.isArray(data.models)
      ? data.models.map((m) => m.model || m.name).filter(Boolean)
      : [];
    return { connected: true, models };
  } catch {
    // Safe fallback: health check probe failed or timed out, report disconnected
    return { connected: false, models: [] };
  }
}
