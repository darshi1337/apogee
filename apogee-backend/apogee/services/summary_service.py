from apogee.services.chunk_service import chunk_text
from apogee.services.prompt_service import build_summary_prompt
from apogee.services.llm_service import generate_stream, LLMError
from apogee.utils.cleaner import clean_text


def summarize_text(
    text: str,
    title: str,
    url: str,
    mode: str,
    model: str,
):
    """Yield summary tokens; the route wraps this in a StreamingResponse."""
    cleaned_content = clean_text(text)
    chunks = chunk_text(cleaned_content)

    def generate():
        try:
            # --- Single chunk: stream tokens directly ---
            if len(chunks) == 1:
                prompt = build_summary_prompt(
                    title=title,
                    url=url,
                    content=chunks[0],
                    mode=mode,
                )
                yield from generate_stream(prompt, model)
                return

            # Bullets: emit each chunk's bullets as it finishes so output
            # starts flowing immediately instead of after every chunk.
            if mode == "bullets":
                for chunk in chunks:
                    prompt = build_summary_prompt(
                        title=title,
                        url=url,
                        content=chunk,
                        mode=mode,
                    )
                    line_buffer = ""
                    for token in generate_stream(prompt, model):
                        line_buffer += token
                        while "\n" in line_buffer:
                            line, line_buffer = line_buffer.split("\n", 1)
                            line_stripped = line.strip()
                            if line_stripped[:1] in ("•", "-", "*"):
                                yield line_stripped + "\n"
                    if line_buffer:
                        line_stripped = line_buffer.strip()
                        if line_stripped[:1] in ("•", "-", "*"):
                            yield line_stripped + "\n"
                return

            # Sentences/paragraphs: summarize every chunk, then merge.
            chunk_summaries = []
            for chunk in chunks:
                prompt = build_summary_prompt(
                    title=title,
                    url=url,
                    content=chunk,
                    mode=mode,
                )
                partial = ""
                for token in generate_stream(prompt, model):
                    partial += token
                chunk_summaries.append(partial.strip())

            combined_text = "\n".join(chunk_summaries)
            merge_prompt = build_summary_prompt(
                title=title,
                url=url,
                content=combined_text,
                mode=mode,
            )
            yield from generate_stream(merge_prompt, model)

        except LLMError as exc:
            # Raised mid-stream, after the 200 response headers are sent, so
            # we can't set an error status — surface it in the body instead.
            yield f"\n\n[Error: {exc}]"

    return generate()
