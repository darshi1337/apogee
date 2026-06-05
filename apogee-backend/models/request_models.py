from pydantic import BaseModel

class SummaryRequest(BaseModel):
    title: str
    url: str
    content: str
    mode: str = "concise"

class AskRequest(BaseModel):
    title: str
    url: str
    content: str
    question: str
