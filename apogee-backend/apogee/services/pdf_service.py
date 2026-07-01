import fitz


def extract_pdf_text(pdf_path: str) -> str:
    """Extract all text from a PDF file."""
    with fitz.open(pdf_path) as doc:
        return "".join(page.get_text() for page in doc)