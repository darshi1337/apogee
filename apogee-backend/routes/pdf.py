import tempfile

from fastapi import APIRouter, UploadFile, File
from fastapi.responses import StreamingResponse

from services.pdf_service import extract_pdf_text
from services.chunk_service import chunk_text
from services.prompt_service import build_summary_prompt
from services.llm_service import generate_stream
from utils.cleaner import clean_text

router = APIRouter()

@router.post("/pdf/summarize")
async def summarize_pdf(
    file: UploadFile = File(...)
):
    with tempfile.NamedTemporaryFile(
        delete=False,
        suffix=".pdf"
    ) as tmp:

        tmp.write(
            await file.read()
        )

        pdf_path = tmp.name

    text = extract_pdf_text(pdf_path)

    cleaned_content = clean_text(text)

    chunks = chunk_text(cleaned_content)

    def generate():

        chunk_summaries = []

        for chunk in chunks:

            prompt = build_summary_prompt(
                title=file.filename,
                url="PDF",
                content=chunk,
                mode="bullets"
            )

            partial_summary = ""

            for token in generate_stream(
                prompt,
                "qwen3:8b"
            ):
                partial_summary += token

            chunk_summaries.append(
                partial_summary.strip()
            )

        final_summary = "\n".join(
            chunk_summaries
        )

        yield final_summary

    return StreamingResponse(
        generate(),
        media_type="text/plain"
    )