import os
import tempfile
import urllib.parse

import requests
from fastapi import APIRouter, HTTPException

from apogee.models.request_models import PdfUrlRequest
from apogee.services.pdf_service import extract_pdf_text
from apogee.services.summary_service import summarize_text

router = APIRouter()

# Directories that local PDF access is restricted to.
# Users can only open PDFs from standard user-accessible locations.
ALLOWED_PDF_ROOTS = [
    os.path.expanduser("~"),   # user's home directory
    "/tmp",
]


def _validate_local_path(raw_path: str) -> str:
    """Resolve a local path and ensure it is within allowed roots and is a PDF."""
    resolved = os.path.realpath(raw_path)

    if not resolved.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=400,
            detail="Only .pdf files are allowed for local access.",
        )

    if not any(resolved.startswith(root) for root in ALLOWED_PDF_ROOTS):
        raise HTTPException(
            status_code=403,
            detail="Access denied: path is outside allowed directories.",
        )

    if not os.path.isfile(resolved):
        raise HTTPException(
            status_code=404,
            detail="File not found.",
        )

    return resolved


@router.post("/pdf/url")
async def summarize_pdf_url(data: PdfUrlRequest):

    if data.url.startswith("file:///"):
        # Local file — validate the resolved path before reading
        raw_path = urllib.parse.unquote(data.url[len("file://"):])
        pdf_path = _validate_local_path(raw_path)
    else:
        # Remote URL — download to a temp file, process, then clean up
        try:
            response = requests.get(data.url, timeout=30)
            response.raise_for_status()
        except requests.RequestException as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to download PDF: {exc}",
            )

        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")
        try:
            tmp.write(response.content)
            tmp.close()
            pdf_path = tmp.name
        except Exception:
            os.unlink(tmp.name)
            raise

    try:
        text = extract_pdf_text(pdf_path)
    finally:
        # Clean up downloaded temp files (not local user files)
        if not data.url.startswith("file:///"):
            os.unlink(pdf_path)

    if not text.strip():
        raise HTTPException(
            status_code=422,
            detail="Could not extract text from the PDF.",
        )

    return summarize_text(
        text=text,
        title="PDF Document",
        url=data.url,
        mode=data.mode,
        model=data.model,
    )
