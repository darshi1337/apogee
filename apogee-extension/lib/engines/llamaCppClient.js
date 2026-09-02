import { UserFacingError } from "../util/userError.js";
import { createConnectionError } from "../util/connectionError.js";

class LlamaCppError extends UserFacingError {}

/**
 * llama-server's context window is set by its `-c` launch flag, not by the
 * model, so a model name says nothing about it. When neither `/props` nor
 * `/v1/models` reports the running value, callers fall back to this: low
 * enough to be safe on a modestly configured server.
 */
export const DEFAULT_CONTEXT_TOKENS = 8192;

const SSE_DONE = "[DONE]";

// llama-server started with `--api-key` wants it as a bearer token. On b10603 only `/health` is public; `/props` and `/v1/models` both answer 401 without it. Rather than encode that split, which has moved between versions, the header goes on every request: a server that does not want it ignores it, and model detection cannot silently break if the split changes.
function authHeaders(apiKey) {
  const key = (apiKey || "").trim();
  return key ? { Authorization: `Bearer ${key}` } : {};
}

// Every llama-server failure comes back as {error:{message,type,code}}, but a server_error's message can be a raw C++ exception dump ("[json.exception. parse_error.101] parse error at line 1, column 2..."), which means nothing to the person reading it. Request-shaped errors (400, 404) are written for a caller, so those pass through.
function envelopeMessage(error, model) {
  if (error?.type === "authentication_error") {
    return (
      `llama.cpp rejected the API key. Check the key in Settings against the ` +
      `--api-key llama-server was started with.`
    );
  }
  if (error?.type === "server_error") {
    return (
      `llama.cpp failed while handling the request for model '${model}'. ` +
      `Check the llama-server console for details.`
    );
  }
  const detail = typeof error?.message === "string" ? error.message : null;
  return detail
    ? `llama.cpp returned an error for model '${model}': ${detail}`
    : null;
}

function httpError(body, status, model) {
  let parsed = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    // Safe fallback: ignore JSON parse error for HTTP error body
  }
  const described = envelopeMessage(parsed?.error, model);
  return new LlamaCppError(
    described ||
      `llama.cpp returned an error for model '${model}': ${body || status}`,
  );
}

// An SSE event may carry several lines, of which only `data:` ones are payload. Anything else (a `:` keepalive comment, an `event:` name) is skipped rather than parsed, so a server version that starts emitting them cannot break the stream.
function dataPayloadsOf(block) {
  const payloads = [];
  for (const raw of block.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("data:")) continue;
    payloads.push(line.slice(5).trim());
  }
  return payloads;
}

function readEventBlock(block, model, onFinalStats) {
  const tokens = [];
  for (const payload of dataPayloadsOf(block)) {
    if (payload === SSE_DONE) return { tokens, done: true };
    if (!payload) continue;

    let parsed;
    try {
      parsed = JSON.parse(payload);
    } catch (err) {
      throw new LlamaCppError(
        `llama.cpp sent a malformed response for model '${model}': ${err.message}`,
      );
    }

    // An error can also arrive mid-stream, after a 200. The payload is already parsed here, so this maps it directly rather than going back through httpError and parsing it a second time.
    if (parsed?.error) {
      throw new LlamaCppError(
        envelopeMessage(parsed.error, model) ||
          `llama.cpp returned an error for model '${model}': ${payload}`,
      );
    }

    const content = parsed?.choices?.[0]?.delta?.content;
    // The opening chunk announces the assistant role with `content: null`, and the closing chunk carries finish_reason with an empty delta. Checking the type skips both, while still passing a single-space token through, which a truthiness check would drop.
    if (typeof content === "string" && content !== "") tokens.push(content);

    // llama.cpp's own `timings` (a native extension, not part of the OpenAI schema) rides on the final chunk when the request asks for usage. It is more accurate than our own count: it excludes network transit.
    if (parsed?.timings?.predicted_n != null) {
      onFinalStats?.({
        tokens: parsed.timings.predicted_n,
        durationMs: parsed.timings.predicted_ms,
      });
    }
  }
  return { tokens, done: false };
}

export async function* chatStream(
  host,
  model,
  prompt,
  { signal, system, apiKey, onFinalStats } = {},
) {
  const messages = system
    ? [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ]
    : [{ role: "user", content: prompt }];

  const base = host.replace(/\/+$/, "");

  let response;
  try {
    response = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(apiKey),
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal,
    });
  } catch (err) {
    if (err?.name === "AbortError")
      throw new LlamaCppError("Generation was cancelled.");
    throw createConnectionError(LlamaCppError, "llama.cpp", base, err);
  }

  if (!response.ok) {
    let body = "";
    try {
      body = await response.text();
    } catch {
      // Safe fallback: ignore body text read error
    }
    throw httpError(body, response.status, model);
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

      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const { tokens, done: finished } = readEventBlock(
          block,
          model,
          onFinalStats,
        );
        yield* tokens;
        if (finished) return;
      }
    }

    // `data: [DONE]` arrives with no trailing blank line, so the final event is still sitting in the buffer once the reader finishes. Without this flush the sentinel is never read. ollamaClient.js flushes its last NDJSON line for the same reason.
    const trailing = buffer.trim();
    if (trailing) {
      const { tokens } = readEventBlock(trailing, model, onFinalStats);
      yield* tokens;
    }
  } catch (err) {
    if (err instanceof LlamaCppError) throw err;
    if (err?.name === "AbortError" || signal?.aborted) {
      throw new LlamaCppError("Generation was cancelled.");
    }
    throw createConnectionError(LlamaCppError, "llama.cpp", base, err);
  } finally {
    // Breaking out of the loop early, which is what cancelling a summary does, resumes this generator with a return completion: that skips the catch but still runs this. cancel() is what tells the body to stop and lets the connection go; releaseLock() then leaves no locked stream behind.
    try {
      await reader.cancel();
    } catch {
      // Safe fallback: best-effort reader cancellation
    }
    try {
      reader.releaseLock();
    } catch {
      // Safe fallback: best-effort release of reader lock
    }
  }
}

async function getJson(url, timeoutMs, apiKey) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: authHeaders(apiKey),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    // Safe fallback: endpoint call failed or timed out
    return null;
  }
}

function positiveInt(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

/**
 * Whether llama-server is reachable, which model(s) it is serving, and the
 * context window it is actually running with.
 *
 * `/health` answering is the whole of "is it up". The two lookups after it
 * only enrich that answer, so a server with `/props` disabled
 * (`endpoint_props: false`) or an unfamiliar `/v1/models` shape still reports
 * as connected. `contextTokens` is null when neither reported one, leaving the
 * caller to apply DEFAULT_CONTEXT_TOKENS rather than having a guess handed to
 * it as though it were detected.
 *
 * A wrong `apiKey` still reports connected, because `/health` is public, but
 * both enrichment lookups answer 401 and it comes back with no models and no
 * contextTokens. Connected with an empty model list is therefore the signature
 * of a bad key rather than of a server that has nothing loaded.
 */
export async function checkHealth(host, timeoutMs = 3000, apiKey = "") {
  const base = host.replace(/\/+$/, "");
  const disconnected = { connected: false, models: [], contextTokens: null };

  let health;
  try {
    health = await fetch(`${base}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: authHeaders(apiKey),
    });
  } catch {
    return disconnected;
  }
  if (!health.ok) return disconnected;

  const [props, modelList] = await Promise.all([
    getJson(`${base}/props`, timeoutMs, apiKey),
    getJson(`${base}/v1/models`, timeoutMs, apiKey),
  ]);

  const entries = Array.isArray(modelList?.data) ? modelList.data : [];
  const models = entries
    .map((entry) => entry?.id)
    .filter((id) => typeof id === "string" && id);

  const contextTokens =
    positiveInt(props?.default_generation_settings?.n_ctx) ??
    positiveInt(entries[0]?.meta?.n_ctx);

  return { connected: true, models, contextTokens };
}
