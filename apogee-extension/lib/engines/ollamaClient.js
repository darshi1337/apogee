import { UserFacingError } from "../util/userError.js";
import { createConnectionError } from "../util/connectionError.js";
import { ensureLoopbackCorsRule } from "../util/loopbackCors.js";

class OllamaError extends UserFacingError {}

export async function* chatStream(
  host,
  model,
  prompt,
  { signal, keepAlive = "5m", system, onFinalStats } = {},
) {
  // Scope the loopback Origin-strip to this extension's own (non-tab) requests before the first byte goes out.
  await ensureLoopbackCorsRule();
  const messages = system
    ? [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ]
    : [{ role: "user", content: prompt }];
  let response;
  try {
    response = await fetch(`${host.replace(/\/+$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        think: false,
        keep_alive: keepAlive,
      }),
      signal,
    });
  } catch (err) {
    if (err?.name === "AbortError")
      throw new OllamaError("Generation was cancelled.");
    throw createConnectionError(OllamaError, "Ollama", host, err);
  }

  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch {
      // Safe fallback: ignore body read error when inspecting response error detail
    }
    let message = detail;
    try {
      const parsed = JSON.parse(detail);
      if (parsed?.error) message = parsed.error;
    } catch {
      // Safe fallback: ignore JSON parse error if response body is plain text
    }
    throw new OllamaError(
      `Ollama returned an error for model '${model}': ${message || response.status}`,
    );
  }

  if (!response.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line) continue;
        const parsed = JSON.parse(line);
        if (parsed.error) {
          throw new OllamaError(
            `Ollama returned an error for model '${model}': ${parsed.error}`,
          );
        }
        const text = parsed.message?.content;
        if (text) yield text;
        if (parsed.eval_count != null && parsed.eval_duration != null) {
          onFinalStats?.({
            tokens: parsed.eval_count,
            durationMs: parsed.eval_duration / 1e6,
          });
        }
      }
    }
    const trailing = buffer.trim();
    if (trailing) {
      const parsed = JSON.parse(trailing);
      const text = parsed.message?.content;
      if (text) yield text;
      if (parsed.eval_count != null && parsed.eval_duration != null) {
        onFinalStats?.({
          tokens: parsed.eval_count,
          durationMs: parsed.eval_duration / 1e6,
        });
      }
    }
  } catch (err) {
    if (err instanceof OllamaError) throw err;
    if (err?.name === "AbortError" || signal?.aborted) {
      throw new OllamaError("Generation was cancelled.");
    }
    if (err instanceof SyntaxError) {
      throw new OllamaError(
        `Ollama sent a malformed response for model '${model}': ${err.message}`,
      );
    }
    throw createConnectionError(OllamaError, "Ollama", host, err);
  }
}

export async function checkHealth(host, timeoutMs = 3000) {
  await ensureLoopbackCorsRule();
  try {
    const response = await fetch(`${host.replace(/\/+$/, "")}/api/tags`, {
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
