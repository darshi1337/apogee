import re

# Matches sentence-ending punctuation followed by whitespace
_SENTENCE_END = re.compile(r'(?<=[.!?])\s+')


def chunk_text(text: str, chunk_size: int = 5000) -> list[str]:
    """Split text into chunks, breaking at sentence boundaries when possible."""
    text = text.strip()

    if not text:
        return []

    # Use chunk_size to derive the single-chunk threshold so the
    # parameter isn't silently ignored for moderate-length texts.
    if len(text) <= chunk_size * 3:
        return [text]

    # Split into sentences first
    sentences = _SENTENCE_END.split(text)

    chunks: list[str] = []
    current_chunk: list[str] = []
    current_length = 0

    for sentence in sentences:
        sentence_len = len(sentence)

        # If a single sentence exceeds chunk_size, split it by whitespace
        if sentence_len > chunk_size:
            # Flush what we have
            if current_chunk:
                chunks.append(" ".join(current_chunk))
                current_chunk = []
                current_length = 0

            # Hard-split the oversized sentence on word boundaries
            words = sentence.split()
            part: list[str] = []
            part_len = 0
            for word in words:
                if part_len + len(word) + 1 > chunk_size and part:
                    chunks.append(" ".join(part))
                    part = []
                    part_len = 0
                part.append(word)
                part_len += len(word) + 1
            if part:
                chunks.append(" ".join(part))
            continue

        # Would this sentence push us over the limit?
        if current_length + sentence_len + 1 > chunk_size and current_chunk:
            chunks.append(" ".join(current_chunk))
            current_chunk = []
            current_length = 0

        current_chunk.append(sentence)
        current_length += sentence_len + 1

    if current_chunk:
        chunks.append(" ".join(current_chunk))

    return chunks