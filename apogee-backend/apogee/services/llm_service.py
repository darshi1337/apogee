import ollama


class LLMError(Exception):
    """Raised when the LLM backend is unreachable or returns an error."""
    pass


def generate_stream(prompt: str, model: str = "qwen3:8b"):
    """Yield tokens from Ollama. Raises LLMError on failure."""
    try:
        response = ollama.chat(
            model=model,
            messages=[
                {
                    "role": "user",
                    "content": prompt,
                }
            ],
            stream=True,
        )

        for chunk in response:
            yield chunk["message"]["content"]

    except ollama.ResponseError as exc:
        raise LLMError(
            f"Ollama returned an error for model '{model}': {exc}"
        ) from exc
    except Exception as exc:
        raise LLMError(
            f"Could not connect to Ollama. Is it running? Error: {exc}"
        ) from exc