from typing import Literal

from pydantic import BaseModel, Field

ALLOWED_MODELS = Literal[
    "qwen3:8b",
    "mistral:latest",
    "llama3.1:8b",
    "gemma3:4b",
]

ALLOWED_MODES = Literal["bullets", "sentences", "paragraphs"]


class SummaryRequest(BaseModel):
    title: str
    url: str
    content: str = Field(..., min_length=1)
    mode: ALLOWED_MODES
    model: ALLOWED_MODELS = "qwen3:8b"


class AskRequest(BaseModel):
    title: str
    url: str
    content: str = Field(..., min_length=1)
    question: str = Field(..., min_length=1)
    model: ALLOWED_MODELS = "qwen3:8b"


class SuggestedQuestionsRequest(BaseModel):
    title: str
    url: str
    summary: str = Field(..., min_length=1)
    model: ALLOWED_MODELS = "qwen3:8b"


class PdfUrlRequest(BaseModel):
    url: str
    mode: ALLOWED_MODES = "bullets"
    model: ALLOWED_MODELS = "qwen3:8b"
