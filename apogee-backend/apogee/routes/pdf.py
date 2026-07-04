import ipaddress
import os
import socket
import tempfile
import urllib.parse

import requests
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from apogee.models.request_models import PdfUrlRequest
from apogee.services.pdf_service import extract_pdf_text
from apogee.services.summary_service import summarize_text

router = APIRouter()

# Maximum extracted text length accepted (approximately 500 KB).
MAX_CONTENT_LENGTH = 500_000

# realpath() so symlinked roots (e.g. macOS /tmp -> /private/tmp) match.
ALLOWED_PDF_ROOTS = [
    os.path.realpath(os.path.expanduser("~")),
    os.path.realpath(tempfile.gettempdir()),
    os.path.realpath("/tmp"),
]


def _is_within_allowed_roots(resolved: str) -> bool:
    # commonpath (not startswith) so "/tmpfoo" isn't treated as under "/tmp".
    for root in ALLOWED_PDF_ROOTS:
        try:
            if os.path.commonpath([resolved, root]) == root:
                return True
        except ValueError:
            continue
    return False


def _is_safe_remote_url(url: str) -> bool:
    """Reject URLs that target private/loopback addresses (SSRF protection)."""
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return False
    if not parsed.hostname:
        return False
    try:
        resolved_ip = ipaddress.ip_address(
            socket.gethostbyname(parsed.hostname)
        )
        return resolved_ip.is_global
    except (socket.gaierror, ValueError):
        return False


def _validate_local_path(raw_path: str) -> str:
    """Resolve a local path and ensure it is within allowed roots and is a PDF."""
    resolved = os.path.realpath(raw_path)

    if not resolved.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=400,
            detail="Only .pdf files are allowed for local access.",
        )

    if not _is_within_allowed_roots(resolved):
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
def summarize_pdf_url(data: PdfUrlRequest):

    if data.url.startswith("file:///"):
        # Local file — validate the resolved path before reading
        raw_path = urllib.parse.unquote(data.url[len("file://"):])
        pdf_path = _validate_local_path(raw_path)
    else:
        # Remote URL — validate against SSRF, then download to a temp file
        if not _is_safe_remote_url(data.url):
            raise HTTPException(
                status_code=400,
                detail="URL is not allowed: only public http/https URLs are accepted.",
            )

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

    if len(text) > MAX_CONTENT_LENGTH:
        raise HTTPException(
            status_code=413,
            detail=f"Extracted PDF text too large ({len(text)} chars). Maximum is {MAX_CONTENT_LENGTH}.",
        )

    return StreamingResponse(
        summarize_text(
            text=text,
            title="PDF Document",
            url=data.url,
            mode=data.mode,
            model=data.model,
        ),
        media_type="text/plain",
    )
