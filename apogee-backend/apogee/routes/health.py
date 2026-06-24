from fastapi import APIRouter
import ollama

router = APIRouter()

@router.get("/health")
async def health():
    try:
        models = ollama.list()

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