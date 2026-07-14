from typing import Literal

from pydantic import BaseModel, Field

ALLOWED_MODELS = Literal[
    "qwen3:8b",
    "mistral:latest",
    "llama3.1:8b",
    "gemma3:4b",
]

ALLOWED_MODES = Literal["bullets", "sentences", "paragraphs"]

# title/url are display metadata dropped into prompts, not primary content —
# they don't need the same 500KB budget as `content`, and were previously
# unbounded (only `content`/`summary` were checked in the route handlers).
TITLE_MAX_LENGTH = 500
URL_MAX_LENGTH = 2000


class SummaryRequest(BaseModel):
    title: str = Field(..., max_length=TITLE_MAX_LENGTH)
    url: str = Field(..., max_length=URL_MAX_LENGTH)
    content: str = Field(..., min_length=1)
    mode: ALLOWED_MODES
    model: ALLOWED_MODELS = "qwen3:8b"


class AskRequest(BaseModel):
    title: str = Field(..., max_length=TITLE_MAX_LENGTH)
    url: str = Field(..., max_length=URL_MAX_LENGTH)
    content: str = Field(..., min_length=1)
    question: str = Field(..., min_length=1)
    model: ALLOWED_MODELS = "qwen3:8b"


class SuggestedQuestionsRequest(BaseModel):
    title: str = Field(..., max_length=TITLE_MAX_LENGTH)
    url: str = Field(..., max_length=URL_MAX_LENGTH)
    summary: str = Field(..., min_length=1)
    model: ALLOWED_MODELS = "qwen3:8b"


class PdfUrlRequest(BaseModel):
    url: str = Field(..., max_length=URL_MAX_LENGTH)
    mode: ALLOWED_MODES = "bullets"
    model: ALLOWED_MODELS = "qwen3:8b"
