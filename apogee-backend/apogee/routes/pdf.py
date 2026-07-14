import ipaddress
import os
import socket
import tempfile
import threading
import urllib.parse
from contextlib import contextmanager

import requests
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from apogee.config import allow_local_pdf_access
from apogee.models.request_models import PdfUrlRequest
from apogee.services.pdf_service import PdfExtractionError, extract_pdf_text
from apogee.services.summary_service import summarize_text

router = APIRouter()

# Maximum extracted text length accepted (approximately 500 KB).
MAX_CONTENT_LENGTH = 500_000

# Maximum number of HTTP redirects to follow when downloading a remote PDF.
# Each hop is re-validated against the SSRF allow-list — unlike
# `requests`' built-in redirect handling, which would otherwise follow a
# redirect to a private/loopback address without rechecking it.
MAX_REDIRECTS = 5

# realpath() so symlinked roots (e.g. macOS /tmp -> /private/tmp) match.
# Deliberately narrow: the whole home directory used to be in-scope, which
# meant any origin allowed by CORS could read *any* PDF the user owns. Only
# the common "I just downloaded/saved a PDF" locations are trusted by
# default; extend via APOGEE_PDF_ALLOWED_DIRS (colon-separated) if needed.
def _default_pdf_roots() -> list[str]:
    roots = [
        os.path.realpath(tempfile.gettempdir()),
        os.path.realpath("/tmp"),
        os.path.realpath(os.path.join(os.path.expanduser("~"), "Downloads")),
    ]
    extra = os.environ.get("APOGEE_PDF_ALLOWED_DIRS", "")
    for entry in extra.split(os.pathsep):
        entry = entry.strip()
        if entry:
            roots.append(os.path.realpath(os.path.expanduser(entry)))
    return roots


ALLOWED_PDF_ROOTS = _default_pdf_roots()


def _is_within_allowed_roots(resolved: str) -> bool:
    # commonpath (not startswith) so "/tmpfoo" isn't treated as under "/tmp".
    for root in ALLOWED_PDF_ROOTS:
        try:
            if os.path.commonpath([resolved, root]) == root:
                return True
        except ValueError:
            continue
    return False


# `socket.getaddrinfo` is a process-global; FastAPI runs sync `def` routes
# in a thread pool, so two concurrent /pdf/url requests could otherwise
# clobber each other's pin mid-request. Serialize access to it.
_dns_pin_lock = threading.Lock()


@contextmanager
def _pinned_dns(host: str, ip: str):
    with _dns_pin_lock:
        original_getaddrinfo = socket.getaddrinfo

        def patched_getaddrinfo(h, *args, **kwargs):
            if h == host:
                return original_getaddrinfo(ip, *args, **kwargs)
            return original_getaddrinfo(h, *args, **kwargs)

        socket.getaddrinfo = patched_getaddrinfo
        try:
            yield
        finally:
            socket.getaddrinfo = original_getaddrinfo


def _is_safe_remote_url(url: str) -> tuple[bool, str]:
    """Reject URLs that target private/loopback addresses (SSRF protection)."""
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return False, ""
    if not parsed.hostname:
        return False, ""
    try:
        ip = socket.gethostbyname(parsed.hostname)
        resolved_ip = ipaddress.ip_address(ip)
        return resolved_ip.is_global, ip
    except (socket.gaierror, ValueError):
        return False, ""


def _fetch_pdf_with_validated_redirects(url: str) -> bytes:
    """Download a PDF, re-validating the SSRF allow-list on every redirect hop.

    `requests` follows redirects by default and only the *original* host was
    DNS-pinned/validated, so a public URL that passes the initial check could
    302 to a private/loopback address and reach internal services. Each hop
    is validated and pinned independently instead.
    """
    current_url = url
    for _ in range(MAX_REDIRECTS + 1):
        is_safe, resolved_ip = _is_safe_remote_url(current_url)
        if not is_safe:
            raise HTTPException(
                status_code=400,
                detail="URL is not allowed: only public http/https URLs are accepted.",
            )

        parsed = urllib.parse.urlparse(current_url)
        try:
            with _pinned_dns(parsed.hostname, resolved_ip):
                response = requests.get(
                    current_url, timeout=30, allow_redirects=False
                )
        except requests.RequestException as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to download PDF: {exc}",
            )

        if response.is_redirect or response.is_permanent_redirect:
            location = response.headers.get("Location")
            if not location:
                raise HTTPException(
                    status_code=502,
                    detail="Failed to download PDF: redirect with no Location header.",
                )
            current_url = urllib.parse.urljoin(current_url, location)
            continue

        try:
            response.raise_for_status()
        except requests.RequestException as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to download PDF: {exc}",
            )
        return response.content

    raise HTTPException(
        status_code=502,
        detail="Failed to download PDF: too many redirects.",
    )


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
        if not allow_local_pdf_access():
            raise HTTPException(
                status_code=403,
                detail="Local PDF access is disabled on this Apogee server.",
            )

        # Local file — validate the resolved path before reading
        raw_path = urllib.parse.unquote(data.url[len("file://"):])
        pdf_path = _validate_local_path(raw_path)
    else:
        # Remote URL — validate against SSRF (including on every redirect
        # hop) and download to a temp file.
        content = _fetch_pdf_with_validated_redirects(data.url)

        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")
        try:
            tmp.write(content)
            tmp.close()
            pdf_path = tmp.name
        except Exception:
            os.unlink(tmp.name)
            raise

    try:
        text = extract_pdf_text(pdf_path)
    except PdfExtractionError as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Could not read PDF: {exc}",
        ) from exc
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
