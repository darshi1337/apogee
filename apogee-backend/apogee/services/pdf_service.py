import fitz


class PdfExtractionError(Exception):
    """Raised when a PDF file can't be opened or parsed."""


def extract_pdf_text(pdf_path: str) -> str:
    """Extract all text from a PDF file."""
    try:
        with fitz.open(pdf_path) as doc:
            return "".join(page.get_text() for page in doc)
    except fitz.FileDataError as exc:
        raise PdfExtractionError("the file is not a valid PDF") from exc
    except RuntimeError as exc:
        raise PdfExtractionError(str(exc)) from exc