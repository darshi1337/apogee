from fastapi import APIRouter
import ollama

from apogee.config import get_ollama_health_timeout

router = APIRouter()

@router.get("/health")
def health():
    try:
        client = ollama.Client(timeout=get_ollama_health_timeout())
        models = client.list()

        return {
            "connected": True,
            "models": [
                model["model"]
                for model in models["models"]
            ]
        }

    except Exception:
        return {
            "connected": False,
            "models": []
        }
