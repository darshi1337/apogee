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
    """Return a generator that yields summary tokens.

    The caller (route layer) is responsible for wrapping
    this in a StreamingResponse.
    """
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

            # --- Multiple chunks ---
            if mode == "bullets":
                # Stream each chunk's bullets as soon as that chunk finishes,
                # so long pages start showing output within a couple of seconds
                # instead of blocking until every chunk has been summarized.
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
                    for line in partial.splitlines():
                        line = line.strip()
                        if line.startswith("•"):
                            yield line + "\n"
                return

            # --- sentences / paragraphs: summarize each chunk, then merge ---
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

            # The merge pass itself streams, but it can only start once every
            # chunk has been summarized above.
            combined_text = "\n".join(chunk_summaries)
            merge_prompt = build_summary_prompt(
                title=title,
                url=url,
                content=combined_text,
                mode=mode,
            )
            yield from generate_stream(merge_prompt, model)

        except LLMError as exc:
            # LLMError is raised during iteration, not during the initial
            # call to summarize_text(). Since the StreamingResponse has
            # already been sent with a 200 status at that point, we can't
            # change the HTTP status code — we can only append the error
            # to the stream so the user sees it.
            yield f"\n\n[Error: {exc}]"

    return generate()
