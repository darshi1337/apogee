from fastapi import APIRouter
from apogee.models.request_models import PdfUrlRequest
from apogee.services.pdf_service import extract_pdf_text
from apogee.services.summary_service import summarize_text

import requests
import tempfile
import urllib.parse

router = APIRouter()


@router.post("/pdf/url")
async def summarize_pdf_url(data: PdfUrlRequest):

    print("PDF URL RECEIVED:")
    print(data.url)

    if data.url.startswith("file:///"):

        pdf_path = urllib.parse.unquote(
            data.url.replace(
                "file:///",
                ""
            )
        )

        print("LOCAL PDF:")
        print(pdf_path)

    else:

        response = requests.get(data.url)

        with tempfile.NamedTemporaryFile(
            delete=False,
            suffix=".pdf"
        ) as tmp:

            tmp.write(response.content)

            pdf_path = tmp.name

        print("DOWNLOADED PDF:")
        print(pdf_path)

    text = extract_pdf_text(pdf_path)

    print("PDF LENGTH:")
    print(len(text))

    return summarize_text(
        text=text,
        title="PDF Document",
        url=data.url,
        mode=data.mode,
        model=data.model
    )
