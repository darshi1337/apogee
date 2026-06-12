from fastapi.responses import StreamingResponse

from services.chunk_service import chunk_text
from services.prompt_service import build_summary_prompt
from services.llm_service import generate_stream

from utils.cleaner import clean_text


def summarize_text(
    text: str,
    title: str,
    url: str,
    mode: str,
    model: str
):

    cleaned_content = clean_text(text)

    chunks = chunk_text(cleaned_content)

    print("Total chunks:", len(chunks))

    def generate():

        chunk_summaries = []

        for index, chunk in enumerate(chunks):

            print(
                f"Processing chunk {index + 1}/{len(chunks)}"
            )

            prompt = build_summary_prompt(
                title=title,
                url=url,
                content=chunk,
                mode=mode
            )

            partial_summary = ""

            for token in generate_stream(
                prompt,
                model
            ):
                partial_summary += token

            chunk_summaries.append(
                partial_summary.strip()
            )

        print("All chunks summarized")

        if mode == "bullets":

            all_bullets = []

            for summary in chunk_summaries:

                for line in summary.splitlines():

                    line = line.strip()

                    if line.startswith("•"):
                        all_bullets.append(line)

            final_summary = "\n".join(
                all_bullets
            )

        elif mode == "sentences":

            combined_text = "\n".join(
                chunk_summaries
            )

            final_prompt = build_summary_prompt(
                title=title,
                url=url,
                content=combined_text,
                mode="sentences"
            )

            final_summary = ""

            for token in generate_stream(
                final_prompt,
                model
            ):
                final_summary += token

        elif mode == "paragraphs":

            combined_text = "\n".join(
                chunk_summaries
            )

            final_prompt = build_summary_prompt(
                title=title,
                url=url,
                content=combined_text,
                mode="paragraphs"
            )

            final_summary = ""

            for token in generate_stream(
                final_prompt,
                model
            ):
                final_summary += token

        else:

            final_summary = "\n\n".join(
                chunk_summaries
            )

        print("Returning combined summary")

        yield final_summary

    return StreamingResponse(
        generate(),
        media_type="text/plain"
    )