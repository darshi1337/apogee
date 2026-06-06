from pydantic import BaseModel
class SummaryRequest(BaseModel):
    title: str
    url: str
    content: str
    mode: str
    model: str = "qwen3:8b"

class AskRequest(BaseModel):
    title: str
    url: str
    content: str
    question: str
    model: str = "qwen3:8b"