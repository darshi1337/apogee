from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from models.request_models import SummaryRequest
from services.prompt_service import build_summary_prompt
from services.mistral_service import stream_summary
from services.chunk_service import chunk_text
from utils.cleaner import clean_text

router = APIRouter()

@router.post("/summarize")
async def summarize(data: SummaryRequest):
    cleaned_content = clean_text(data.content)
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
            for token in stream_summary(prompt):
                partial_summary += token
            print(f"Finished chunk {index + 1}")
            chunk_summaries.append(
                partial_summary.strip()
            )
        print("All chunks summarized")

        combined_summary = "\n\n".join(
            chunk_summaries
        )
        print("Returning combined summary")
        yield combined_summary

    return StreamingResponse(
        generate(),
        media_type="text/plain"
    )
