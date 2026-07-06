from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from apogee.config import get_cors_origin_regex
from apogee.routes.summarize import router as summarize_router
from apogee.routes.health import router as health_router
from apogee.routes.pdf import router as pdf_router
from apogee.security import require_api_key

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=get_cors_origin_regex(),
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-Apogee-API-Key"],
)

protected = [Depends(require_api_key)]

app.include_router(summarize_router, dependencies=protected)
app.include_router(health_router, dependencies=protected)
app.include_router(pdf_router, dependencies=protected)

@app.get("/")
def root():
    return RedirectResponse(url="/health")
