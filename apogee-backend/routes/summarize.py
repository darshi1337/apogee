from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from models.request_models import AskRequest, SummaryRequest
from services.prompt_service import build_answer_prompt, build_summary_prompt
from services.llm_service import generate_stream
from services.chunk_service import chunk_text
from utils.cleaner import clean_text

router = APIRouter()

@router.post("/summarize")
async def summarize(data: SummaryRequest):
    cleaned_content = clean_text(data.content)
    print("SUMMARY FORMAT =", data.mode)
    print("Original length:", len(data.content))
    print("Cleaned length:", len(cleaned_content))
    chunks = chunk_text(cleaned_content)
    print("Total chunks:", len(chunks))

    def generate():
        chunk_summaries = []
        for index, chunk in enumerate(chunks):
            print(f"Processing chunk {index + 1}/{len(chunks)}")
            prompt = build_summary_prompt(
                title=data.title,
                url=data.url,
                content=chunk,
                mode=data.mode
            )
            partial_summary = ""
            for token in generate_stream(prompt, data.model):
                partial_summary += token
            print(f"Finished chunk {index + 1}")
            chunk_summaries.append(
                partial_summary.strip()
            )
        print("All chunks summarized")

        # BULLET MODE
        if data.mode == "bullets":
            all_bullets = []

            for summary in chunk_summaries:
                for line in summary.splitlines():
                    line = line.strip()

                    if line.startswith("•"):
                        all_bullets.append(line)

            final_summary = "\n".join(all_bullets)

        # SENTENCE MODE
        elif data.mode == "sentences":
            combined_text = "\n".join(chunk_summaries)

            final_prompt = build_summary_prompt(
                title=data.title,
                url=data.url,
                content=combined_text,
                mode="sentences"
            )

            final_summary = ""

            for token in generate_stream(final_prompt, data.model):
                final_summary += token

        # PARAGRAPH MODE
        elif data.mode == "paragraphs":
            combined_text = "\n".join(chunk_summaries)

            final_prompt = build_summary_prompt(
                title=data.title,
                url=data.url,
                content=combined_text,
                mode="paragraphs"
            )

            final_summary = ""

            for token in generate_stream(final_prompt, data.model):
                final_summary += token

        # FALLBACK
        else:
            final_summary = "\n\n".join(chunk_summaries)

        print("Returning combined summary")
        yield final_summary

    return StreamingResponse(
        generate(),
        media_type="text/plain"
    )

@router.post("/ask")
async def ask(data: AskRequest):
    cleaned_content = clean_text(data.content)
    prompt = build_answer_prompt(
        title=data.title,
        url=data.url,
        content=cleaned_content,
        question=data.question
    )

    return StreamingResponse(
        generate_stream(
            prompt,
            data.model
        ),
        media_type="text/plain"
    )
