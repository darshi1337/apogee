from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from apogee.routes.summarize import router as summarize_router
from apogee.routes.health import router as health_router
from apogee.routes.pdf import router as pdf_router

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(summarize_router)
app.include_router(health_router)
app.include_router(pdf_router)

@app.get("/")
async def root():
    return {
        "message": "Apogee backend running"
    }
