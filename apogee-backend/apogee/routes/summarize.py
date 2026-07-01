from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from apogee.models.request_models import AskRequest, SummaryRequest
from apogee.services.prompt_service import build_answer_prompt
from apogee.services.llm_service import generate_stream, LLMError
from apogee.services.summary_service import summarize_text
from apogee.utils.cleaner import clean_text

router = APIRouter()

# Maximum content length accepted (approximately 500 KB of text).
MAX_CONTENT_LENGTH = 500_000


@router.post("/summarize")
def summarize(data: SummaryRequest):
    if len(data.content) > MAX_CONTENT_LENGTH:
        raise HTTPException(
            status_code=413,
            detail=f"Content too large ({len(data.content)} chars). Maximum is {MAX_CONTENT_LENGTH}.",
        )

    return StreamingResponse(
        summarize_text(
            text=data.content,
            title=data.title,
            url=data.url,
            mode=data.mode,
            model=data.model,
        ),
        media_type="text/plain",
    )


@router.post("/ask")
def ask(data: AskRequest):
    if len(data.content) > MAX_CONTENT_LENGTH:
        raise HTTPException(
            status_code=413,
            detail=f"Content too large ({len(data.content)} chars). Maximum is {MAX_CONTENT_LENGTH}.",
        )

    cleaned_content = clean_text(data.content)

    prompt = build_answer_prompt(
        title=data.title,
        url=data.url,
        content=cleaned_content,
        question=data.question,
    )

    def safe_stream():
        try:
            yield from generate_stream(prompt, data.model)
        except LLMError as exc:
            yield f"\n\n[Error: {exc}]"

    return StreamingResponse(
        safe_stream(),
        media_type="text/plain",
    )
