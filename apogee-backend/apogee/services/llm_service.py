import ollama

def generate_stream(prompt, model="qwen3:8b"):
    print(f"Using model: {model}")

    response = ollama.chat(
        model=model,
        messages=[
            {
                "role": "user",
                "content": prompt,
            }
        ],
        stream=True,
    )

    for chunk in response:
        yield chunk["message"]["content"]