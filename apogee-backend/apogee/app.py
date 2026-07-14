from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse

from apogee.config import get_cors_origin_regex
from apogee.routes.summarize import router as summarize_router
from apogee.routes.health import router as health_router
from apogee.routes.pdf import router as pdf_router

app = FastAPI()

# Custom header required on state-changing requests. This isn't a secret —
# the extension is open source — but a plain <form> POST or a "simple"
# (non-preflighted) cross-origin fetch can't set custom headers, so this
# forces even same-shaped-origin requests through a CORS preflight that the
# origin regex must approve first. It's defense-in-depth alongside the CORS
# check, not a replacement for it.
REQUIRED_CLIENT_HEADER = "x-apogee-client"


@app.middleware("http")
async def require_client_header(request: Request, call_next):
    if request.method == "POST" and REQUIRED_CLIENT_HEADER not in request.headers:
        return JSONResponse(
            status_code=403,
            content={"detail": "Missing required client header."},
        )
    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=get_cors_origin_regex(),
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", REQUIRED_CLIENT_HEADER],
)

app.include_router(summarize_router)
app.include_router(health_router)
app.include_router(pdf_router)

@app.get("/")
def root():
    return RedirectResponse(url="/health")
