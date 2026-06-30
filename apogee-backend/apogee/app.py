from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from apogee.routes.summarize import router as summarize_router
from apogee.routes.health import router as health_router
from apogee.routes.pdf import router as pdf_router

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    # Only allow requests from browser extensions and localhost
    allow_origin_regex=r"^(chrome-extension://.*|moz-extension://.*|http://127\.0\.0\.1(:\d+)?|http://localhost(:\d+)?)$",
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

app.include_router(summarize_router)
app.include_router(health_router)
app.include_router(pdf_router)

@app.get("/")
async def root():
    return {
        "message": "Apogee backend running"
    }
