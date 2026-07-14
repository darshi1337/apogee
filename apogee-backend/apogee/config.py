import os


DEFAULT_API_BASE = "http://127.0.0.1:8000"


def allow_local_pdf_access() -> bool:
    return os.environ.get("APOGEE_ALLOW_LOCAL_PDFS", "1").strip() not in {
        "0",
        "false",
        "False",
    }


def get_cors_origin_regex() -> str:
    # NOTE: this can't be pinned to Apogee's exact extension ID from here —
    # Chrome assigns that ID at Web Store publish time and Firefox randomizes
    # moz-extension:// UUIDs per profile — so it's shaped-matched instead
    # (32 a-p chars for Chrome, a UUID for Firefox) rather than left as a
    # bare wildcard. This still permits *any* installed extension whose
    # origin happens to match that shape, which is why CORS alone isn't
    # relied on for protection — see the X-Apogee-Client header check in
    # apogee.app, and the narrowed local PDF roots in apogee.routes.pdf.
    return os.environ.get(
        "APOGEE_CORS_ORIGIN_REGEX",
        (
            r"^(chrome-extension://[a-p]{32}|"
            r"moz-extension://[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|"
            r"http://127\.0\.0\.1(:\d+)?|http://localhost(:\d+)?)$"
        ),
    )


def get_ollama_health_timeout() -> float:
    try:
        return float(os.environ.get("APOGEE_OLLAMA_HEALTH_TIMEOUT", "3"))
    except ValueError:
        return 3.0
