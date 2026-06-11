def chunk_text(text: str, chunk_size: int = 5000):
    text = text.strip()

    if not text:
        return []

    if len(text) <= 15000:
        print(f"Small article ({len(text)} chars) -> 1 chunk")
        return [text]

    chunks = []

    for i in range(0, len(text), chunk_size):
        chunks.append(
            text[i:i + chunk_size]
        )

    print(f"Large article ({len(text)} chars)")
    print(f"Total chunks: {len(chunks)}")
    print(
        "Chunk lengths:",
        [len(chunk) for chunk in chunks]
    )

    return chunks