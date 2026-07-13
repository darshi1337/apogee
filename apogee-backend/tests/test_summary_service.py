from unittest.mock import patch
from apogee.services.chunk_service import chunk_text
from apogee.services.summary_service import summarize_text


def test_chunk_text_short():
    text = "Short text."
    chunks = chunk_text(text, chunk_size=5000)
    assert chunks == [text]


def test_chunk_text_long():
    text = "Sentence one. Sentence two. Sentence three."
    chunks = chunk_text(text, chunk_size=5)
    assert len(chunks) > 1
    assert "".join(chunks).replace(" ", "") == text.replace(" ", "")


@patch("apogee.services.summary_service.generate_stream")
def test_summarize_text_bullets_incremental(mock_generate_stream):
    mock_generate_stream.side_effect = [
        iter(["- Bullet 1", "\n- Bullet 2", "\n"]),
        iter(["* Bullet 3", "\n", "This line is not a bullet", "\n* Bullet 4"]),
    ]

    chunks = ["chunk one text", "chunk two text"]
    with patch("apogee.services.summary_service.chunk_text", return_value=chunks):
        generator = summarize_text(
            text="full raw text",
            title="test title",
            url="http://test.com",
            mode="bullets",
            model="qwen3:8b",
        )

        results = list(generator)

        assert results == [
            "- Bullet 1\n",
            "- Bullet 2\n",
            "* Bullet 3\n",
            "* Bullet 4\n",
        ]
