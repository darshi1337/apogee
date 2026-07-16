import { Ollama } from "ollama";

import { getKeepAlive, getOllamaHost } from "../config.js";

// A single shared client (not the package's default singleton) so it picks
// up OLLAMA_HOST, the default export always points at 127.0.0.1:11434 and
// ignores the env var, unlike Python's ollama client.
const ollama = new Ollama({ host: getOllamaHost() });

export class LLMError extends Error {}

// The `ollama` package doesn't export its ResponseError class (only the
// client and its default instance), so API errors are distinguished by
// name/status_code duck-typing instead of `instanceof`.
function isOllamaResponseError(err) {
  return err?.name === "ResponseError" && "status_code" in err;
}

/**
 * Async-generator yielding tokens from Ollama. Throws LLMError on failure.
 *
 * Pass an AbortSignal to cancel an in-flight generation (e.g. when the HTTP
 * client disconnects). Aborting stops Ollama from burning CPU on a response
 * nobody is reading anymore, which matters most on CPU-only backends where a
 * single generation can run for minutes.
 */
export async function* generateStream(
  prompt,
  model = "gemma3:4b",
  { signal } = {},
) {
  if (signal?.aborted) throw new LLMError("Generation was cancelled.");

  let stream;
  try {
    stream = await ollama.chat({
      model,
      messages: [{ role: "user", content: prompt }],
      stream: true,
      think: false,
      keep_alive: getKeepAlive(),
    });
  } catch (err) {
    throw wrapError(err, model);
  }

  // The stream Ollama returns is an AbortableAsyncIterator; forward an
  // external abort to it so a client disconnect actually stops generation.
  const onAbort = () => stream.abort();
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    for await (const chunk of stream) {
      yield chunk.message.content;
    }
  } catch (err) {
    if (signal?.aborted) throw new LLMError("Generation was cancelled.");
    throw wrapError(err, model);
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

function wrapError(err, model) {
  if (isOllamaResponseError(err)) {
    return new LLMError(
      `Ollama returned an error for model '${model}': ${err.message}`,
    );
  }
  return new LLMError(
    `Could not connect to Ollama. Is it running? Error: ${err?.message ?? err}`,
  );
}

export async function generateText(
  prompt,
  model = "gemma3:4b",
  { signal } = {},
) {
  let text = "";
  for await (const token of generateStream(prompt, model, { signal })) {
    text += token;
  }
  return text;
}
