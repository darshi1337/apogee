import { createConnectionError } from "../util/connectionError.js";
import { ensureLoopbackCorsRuleSoon } from "../util/loopbackCors.js";

// Shared chat-completions scaffolding for the loopback HTTP engines (Ollama,
// llama.cpp): same messages shape, same POST + abort mapping, same
// delimiter-split read loop with trailing flush, same reader cancel +
// releaseLock cleanup. Each engine supplies only what differs: request shape,
// block framing, and error text. Error classes stay per-engine so failures
// keep their UserFacingError marker and are never remapped to the wrong
// backend.

export function buildChatMessages(system, prompt) {
  return system
    ? [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ]
    : [{ role: "user", content: prompt }];
}

export async function postChatRequest({
  url,
  body,
  headers,
  signal,
  ErrorClass,
  label,
  errorHost,
  parseHttpError,
}) {
  // Scope the loopback Origin-strip to this extension's own (non-tab) requests before the first byte goes out.
  // Time-boxed so a slow declarativeNetRequest handshake cannot stall the first request into a fake connection failure.
  await ensureLoopbackCorsRuleSoon();
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal,
    });
  } catch (err) {
    if (err?.name === "AbortError")
      throw new ErrorClass("Generation was cancelled.");
    throw createConnectionError(ErrorClass, label, errorHost, err);
  }
  if (!response.ok) {
    let raw = "";
    try {
      raw = await response.text();
    } catch {
      // Safe fallback: ignore body read error when inspecting response error detail
    }
    throw parseHttpError(raw, response.status);
  }
  return response;
}

// onBlock(block) returns { texts, finished }: the yielded chunks plus whether
// the stream ends here (llama.cpp's [DONE] sentinel). The trailing flush
// reuses onBlock but ignores `finished`, matching both engines' current
// behavior. A SyntaxError from an engine's block parser is mapped through
// mapSyntaxError when provided (Ollama's malformed-response error);
// engines that throw their own error class for malformed payloads
// (llama.cpp) omit it and let the instanceof check rethrow.
export async function* pumpChatBody(
  response,
  { delimiter, onBlock, signal, ErrorClass, label, errorHost, mapSyntaxError },
) {
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
      while ((boundary = buffer.indexOf(delimiter)) !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + delimiter.length);
        const { texts, finished } = onBlock(block);
        yield* texts;
        if (finished) return;
      }
    }

    const trailing = buffer.trim();
    if (trailing) {
      const { texts } = onBlock(trailing);
      yield* texts;
    }
  } catch (err) {
    if (err instanceof ErrorClass) throw err;
    if (err?.name === "AbortError" || signal?.aborted) {
      throw new ErrorClass("Generation was cancelled.");
    }
    if (err instanceof SyntaxError && mapSyntaxError) {
      throw mapSyntaxError(err);
    }
    throw createConnectionError(ErrorClass, label, errorHost, err);
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
