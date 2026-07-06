import os


DEFAULT_API_BASE = "http://127.0.0.1:8000"


def get_api_key() -> str:
    return os.environ.get("APOGEE_API_KEY", "").strip()


def allow_local_pdf_access() -> bool:
    return os.environ.get("APOGEE_ALLOW_LOCAL_PDFS", "1").strip() not in {
        "0",
        "false",
        "False",
    }


def get_cors_origin_regex() -> str:
    return os.environ.get(
        "APOGEE_CORS_ORIGIN_REGEX",
        (
            r"^(chrome-extension://.*|moz-extension://.*|"
            r"http://127\.0\.0\.1(:\d+)?|http://localhost(:\d+)?)$"
        ),
    )


def get_ollama_health_timeout() -> float:
    try:
        return float(os.environ.get("APOGEE_OLLAMA_HEALTH_TIMEOUT", "3"))
    except ValueError:
        return 3.0
