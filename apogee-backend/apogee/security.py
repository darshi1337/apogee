import secrets

from fastapi import Header, HTTPException

from apogee.config import get_api_key


def require_api_key(x_apogee_api_key: str = Header(default="")):
    configured_key = get_api_key()
    if not configured_key:
        return

    if not secrets.compare_digest(x_apogee_api_key, configured_key):
        raise HTTPException(
            status_code=401,
            detail="Missing or invalid Apogee API key.",
        )
