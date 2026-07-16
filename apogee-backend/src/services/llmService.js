import ollama from "ollama";

export class LLMError extends Error {}

// The `ollama` package doesn't export its ResponseError class (only the
// client and its default instance), so API errors are distinguished by
// name/status_code duck-typing instead of `instanceof`.
function isOllamaResponseError(err) {
  return err?.name === "ResponseError" && "status_code" in err;
}

/** Async-generator yielding tokens from Ollama. Throws LLMError on failure. */
export async function* generateStream(prompt, model = "gemma3:4b") {
  let stream;
  try {
    stream = await ollama.chat({
      model,
      messages: [{ role: "user", content: prompt }],
      stream: true,
      think: false,
    });
  } catch (err) {
    throw wrapError(err, model);
  }

  try {
    for await (const chunk of stream) {
      yield chunk.message.content;
    }
  } catch (err) {
    throw wrapError(err, model);
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

export async function generateText(prompt, model = "gemma3:4b") {
  let text = "";
  for await (const token of generateStream(prompt, model)) {
    text += token;
  }
  return text;
}
