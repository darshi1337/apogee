import os
import socket
import tempfile
import pytest
from fastapi import HTTPException

from apogee.routes.pdf import (
    _is_safe_remote_url,
    _validate_local_path,
    _pinned_dns,
    ALLOWED_PDF_ROOTS
)


def test_is_safe_remote_url():
    assert _is_safe_remote_url("http://127.0.0.1/test.pdf")[0] is False
    assert _is_safe_remote_url("https://localhost/test.pdf")[0] is False
    assert _is_safe_remote_url("http://192.168.1.1/test.pdf")[0] is False

    is_safe, resolved_ip = _is_safe_remote_url("https://8.8.8.8/test.pdf")
    assert is_safe is True
    assert resolved_ip == "8.8.8.8"

    assert _is_safe_remote_url("ftp://8.8.8.8/test.pdf")[0] is False
    assert _is_safe_remote_url("file:///etc/passwd")[0] is False


def test_pinned_dns():
    host = "test-domain.local"
    ip = "9.9.9.9"

    with pytest.raises(socket.gaierror):
        socket.getaddrinfo(host, 80)

    with _pinned_dns(host, ip):
        results = socket.getaddrinfo(host, 80)
        resolved_ips = [r[4][0] for r in results]
        assert ip in resolved_ips

    with pytest.raises(socket.gaierror):
        socket.getaddrinfo(host, 80)


def test_validate_local_path():
    with tempfile.TemporaryDirectory() as tmp_dir:
        ALLOWED_PDF_ROOTS.append(os.path.realpath(tmp_dir))
        
        try:
            valid_pdf = os.path.join(tmp_dir, "test.pdf")
            with open(valid_pdf, "w") as f:
                f.write("%PDF-1.4 mock")

            assert _validate_local_path(valid_pdf) == os.path.realpath(valid_pdf)

            invalid_file = os.path.join(tmp_dir, "test.txt")
            with open(invalid_file, "w") as f:
                f.write("text content")
            with pytest.raises(HTTPException) as exc:
                _validate_local_path(invalid_file)
            assert exc.value.status_code == 400

            outside_file = "/etc/hosts.pdf"
            with pytest.raises(HTTPException) as exc:
                _validate_local_path(outside_file)
            assert exc.value.status_code == 403
            
        finally:
            ALLOWED_PDF_ROOTS.remove(os.path.realpath(tmp_dir))
