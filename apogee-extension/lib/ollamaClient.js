// Direct fetch-based Ollama HTTP client, replaces apogee-backend's
// services/llmService.js (which used the `ollama` npm package) now that
// there's no Node process to install that package into. Talks straight to
// Ollama's own HTTP API (POST /api/chat, GET /api/tags).

export class OllamaError extends Error {}

function connectError(host, err) {
  return new OllamaError(
    `Could not connect to Ollama at ${host}. Is it running, and is OLLAMA_ORIGINS ` +
      `set to allow this extension? Error: ${err?.message ?? err}`,
  );
}

/**
 * Async-generator yielding response tokens from Ollama's streaming
 * /api/chat endpoint (newline-delimited JSON). Throws OllamaError on failure.
 */
export async function* chatStream(
  host,
  model,
  prompt,
  { signal, keepAlive = "5m" } = {},
) {
  let response;
  try {
    response = await fetch(`${host.replace(/\/+$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        stream: true,
        think: false,
        keep_alive: keepAlive,
      }),
      signal,
    });
  } catch (err) {
    if (err?.name === "AbortError")
      throw new OllamaError("Generation was cancelled.");
    throw connectError(host, err);
  }

  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch {
      // ignore
    }
    let message = detail;
    try {
      const parsed = JSON.parse(detail);
      if (parsed?.error) message = parsed.error;
    } catch {
      // not JSON, use raw text
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
      }
    }
    const trailing = buffer.trim();
    if (trailing) {
      const parsed = JSON.parse(trailing);
      const text = parsed.message?.content;
      if (text) yield text;
    }
  } catch (err) {
    if (err instanceof OllamaError) throw err;
    if (err?.name === "AbortError" || signal?.aborted) {
      throw new OllamaError("Generation was cancelled.");
    }
    throw connectError(host, err);
  }
}

/** Buffers chatStream into a single string. */
export async function chatOnce(host, model, prompt, options = {}) {
  let text = "";
  for await (const token of chatStream(host, model, prompt, options)) {
    text += token;
  }
  return text;
}

/** Mirrors apogee-backend/src/routes/health.js's GET /health. */
export async function checkHealth(host, timeoutMs = 3000) {
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
    return { connected: false, models: [] };
  }
}
