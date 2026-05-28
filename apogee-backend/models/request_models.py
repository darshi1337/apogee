from pydantic import BaseModel

class SummaryRequest(BaseModel):
    title: str
    url: str
    content: str
    mode: str = "concise"