from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from apogee.models.request_models import AskRequest, SummaryRequest
from apogee.services.prompt_service import build_answer_prompt
from apogee.services.llm_service import generate_stream
from apogee.services.summary_service import summarize_text
from apogee.utils.cleaner import clean_text

router = APIRouter()

@router.post("/summarize")
async def summarize(data: SummaryRequest):

    return summarize_text(
        text=data.content,
        title=data.title,
        url=data.url,
        mode=data.mode,
        model=data.model
    )


@router.post("/ask")
async def ask(data: AskRequest):

    cleaned_content = clean_text(
        data.content
    )

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
